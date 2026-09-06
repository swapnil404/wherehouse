set shell := ["bash", "-cu"]

# List available commands.
default:
    @just --list

# Install both JavaScript and Python dependencies.
setup: web-install geo-setup

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
    bun run dev

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
