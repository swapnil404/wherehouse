# Wherehouse task runner (https://just.systems).
# Run parts singularly, one terminal each:
#   just setup     - install all deps once (bun + python)
#   just web-dev   - TanStack Start frontend
#   just geo-dev   - FastAPI geo sidecar

set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

default:
    @just --list

# Install everything once: JS workspaces + Python sidecar (editable).
setup:
    bun install
    python -m pip install -e ./apps/fastapi

# Frontend only (web has no `dev` script yet, so call its real one directly).
web-dev:
    cd apps/web; bun run dev:bare

# Geo sidecar only. Runs from apps/fastapi so .env + project.csv resolve.
geo-dev:
    cd apps/fastapi; python -m uvicorn main:app --reload
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
