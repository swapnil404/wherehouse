set shell := ["bash", "-cu"]

# List available commands.
default:
    @just --list

# Install both JavaScript and Python dependencies.
setup: web-install geo-setup ingest-setup

# Start the web application and FastAPI sidecar together.
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    pids=()
    cleanup() {
        for pid in "${pids[@]}"; do
            kill "$pid" 2>/dev/null || true
        done
    }
    trap cleanup EXIT INT TERM
    just web-dev &
    pids+=("$!")
    just geo-dev &
    pids+=("$!")
    wait -n "${pids[@]}"

# Install JavaScript dependencies from the lockfile.
web-install:
    bun install --frozen-lockfile

# Start the Cloudflare web application on port 3001.
web-dev:
    bun run dev:web

# Create the FastAPI virtual environment and install its dependencies.
geo-setup:
    python -m venv apps/fastapi/.venv
    apps/fastapi/.venv/bin/python -m pip install -r apps/fastapi/requirements.txt
    @if [ ! -f apps/fastapi/.env ]; then cp apps/fastapi/.env.example apps/fastapi/.env; echo "Created apps/fastapi/.env; replace its placeholder values before starting the API."; else echo "Keeping existing apps/fastapi/.env."; fi

# Start the FastAPI sidecar on port 8000.
geo-dev:
    @test -f apps/fastapi/.env || { echo "Run 'just geo-setup' first, then configure apps/fastapi/.env."; exit 1; }
    cd apps/fastapi && .venv/bin/python -m uvicorn main:app --reload --port 8000

# Check whether the FastAPI sidecar is healthy.
geo-health:
    @curl --fail --silent --show-error http://localhost:8000/health
    @echo

# Run FastAPI scoring and heatmap contract tests.
geo-test:
    cd apps/fastapi && .venv/bin/python -m unittest discover -s tests -v

# Create the offline ingestion environment and install it.
ingest-setup:
    python -m venv pipeline/.venv
    pipeline/.venv/bin/python -m pip install --upgrade pip
    pipeline/.venv/bin/python -m pip install --editable pipeline
    @if [ ! -f pipeline/.env ]; then cp pipeline/.env.example pipeline/.env; echo "Created pipeline/.env; add CENSUS_API_KEY. DATABASE_URL falls back to apps/web/.env."; else echo "Keeping existing pipeline/.env."; fi

# Show the pinned ingestion sources without downloading or changing Neon.
ingest-plan:
    pipeline/.venv/bin/wherehouse-ingest plan

# Download any source snapshots not already cached in pipeline/data/raw.
ingest-download *ARGS:
    pipeline/.venv/bin/wherehouse-ingest download {{ARGS}}

# Build and validate H3 facts without changing Neon.
ingest-build:
    pipeline/.venv/bin/wherehouse-ingest build
    pipeline/.venv/bin/wherehouse-ingest validate

# Validate the built facts and atomically activate them in Neon.
ingest-load:
    pipeline/.venv/bin/wherehouse-ingest load

# Run the complete manual refresh: download, build, validate, and promote.
ingest *ARGS:
    pipeline/.venv/bin/wherehouse-ingest run {{ARGS}}

# Prepare one OSRM graph from the cached Texas PBF. MODE is car or foot.
osrm-prepare MODE:
    #!/usr/bin/env bash
    set -euo pipefail
    mode="{{MODE}}"
    case "$mode" in
        car|foot) ;;
        *) echo "MODE must be car or foot"; exit 2 ;;
    esac
    image="${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:v26.7.3-debian}"
    data_dir="$(pwd)/pipeline/data"
    pbf="$data_dir/raw/texas-latest.osm.pbf"
    test -f "$pbf" || { echo "Missing $pbf; run 'just ingest-download' first."; exit 1; }
    mkdir -p "$data_dir/processed/osrm/$mode"
    uid="$(id -u)"
    gid="$(id -g)"
    docker run --rm --user "$uid:$gid" --volume "$data_dir:/data" "$image" osrm-extract --profile "/opt/$mode.lua" --output "/data/processed/osrm/$mode/texas.osrm" /data/raw/texas-latest.osm.pbf
    docker run --rm --user "$uid:$gid" --volume "$data_dir:/data" "$image" osrm-partition "/data/processed/osrm/$mode/texas.osrm"
    docker run --rm --user "$uid:$gid" --volume "$data_dir:/data" "$image" osrm-customize "/data/processed/osrm/$mode/texas.osrm"

# Start the prepared car and foot OSRM table services.
osrm-start:
    #!/usr/bin/env bash
    set -euo pipefail
    docker compose --file pipeline/osrm.compose.yml up --detach
    for port in 5000 5001; do
        ready=false
        for _ in $(seq 1 150); do
            if curl --fail --silent "http://127.0.0.1:$port/nearest/v1/driving/-97.7431,30.2672?number=1" >/dev/null; then
                ready=true
                break
            fi
            sleep 2
        done
        if [ "$ready" != true ]; then
            echo "OSRM on port $port did not become ready within five minutes."
            docker compose --file pipeline/osrm.compose.yml logs
            exit 1
        fi
    done
    echo "OSRM car and foot table services are ready."

# Stop the local OSRM table services.
osrm-stop:
    docker compose --file pipeline/osrm.compose.yml down

# Build and checkpoint the full car/foot duration matrices.
reach-build *ARGS:
    pipeline/.venv/bin/wherehouse-ingest reach-build {{ARGS}}

# Validate the packed reachability output without changing Neon.
reach-validate:
    pipeline/.venv/bin/wherehouse-ingest reach-validate

# Validate and atomically load reachability into the active Neon dataset.
reach-load:
    pipeline/.venv/bin/wherehouse-ingest reach-load

# Prepare lightweight Austin display geometry for vector tiling.
tiles-prepare *LAYERS:
    pipeline/.venv/bin/wherehouse-ingest tiles-prepare {{LAYERS}}

# Build PMTiles. Requires tippecanoe 2.17 or newer.
tiles-build *LAYERS:
    pipeline/.venv/bin/wherehouse-ingest tiles-build {{LAYERS}}

# Check PMTiles headers and output sizes.
tiles-validate *LAYERS:
    pipeline/.venv/bin/wherehouse-ingest tiles-validate {{LAYERS}}

# Preview the Neon Object Storage changes without applying them.
tiles-storage-plan:
    bunx neon config plan

# Provision the public Neon bucket and pull its branch-scoped credentials to .env.local.
tiles-storage-deploy:
    bunx neon deploy

# Upload generated PMTiles to Neon Object Storage.
tiles-upload *LAYERS:
    #!/usr/bin/env bash
    set -euo pipefail
    bucket="${NEON_STORAGE_BUCKET:-wherehouse-map-data}"
    layers=({{LAYERS}})
    if [ "${#layers[@]}" -eq 0 ]; then layers=(roads zoning flood buildings poi); fi
    for layer in "${layers[@]}"; do
        file="pipeline/data/processed/tiles/output/${layer}.pmtiles"
        test -f "$file" || { echo "Missing $file; run 'just tiles-build' first."; exit 1; }
        bunx neon buckets object put "$bucket/${layer}.pmtiles" --file "$file" --content-type application/vnd.pmtiles
    done
