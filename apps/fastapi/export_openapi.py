"""Export FastAPI's OpenAPI document for the TypeScript client generator."""

import json
from pathlib import Path

from main import app


output_path = Path(__file__).with_name("openapi.json")
output_path.write_text(
    json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)
print(f"Wrote {output_path}")
