"""Central configuration for the Wherehouse Geo API.

Reads environment variables (via ``.env`` when present) and fails fast
with a clear message when required values are missing.
"""

import os
from dotenv import load_dotenv

load_dotenv()

GEO_SERVICE_TOKEN = os.getenv("GEO_SERVICE_TOKEN")
if not GEO_SERVICE_TOKEN:
    raise RuntimeError(
        "GEO_SERVICE_TOKEN is missing. Set it in the environment "
        "or in apps/fastapi/.env (see .env.example)."
    )

# No wildcard default: origins must be listed explicitly.
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()
]

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
