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
