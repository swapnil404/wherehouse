from __future__ import annotations

import argparse
import os

from dotenv import dotenv_values

from .build import build_facts
from .config import FACTS_PATH, MANIFEST_PATH, PIPELINE_DIR, STATIC_SOURCES
from .database import load_and_promote
from .download import download_sources
from .reachability import (
    build_reachability,
    load_reachability,
    require_valid_reachability,
    validate_reachability,
)
from .tiles import build_pmtiles, prepare_tile_sources, validate_pmtiles
from .validation import require_valid, validate_facts


def _print_checks(checks) -> None:
    for check in checks:
        marker = "PASS" if check.passed else "FAIL"
        detail = f" — {check.detail}" if check.detail else ""
        print(f"[{marker}] {check.name}{detail}")


def _plan() -> None:
    print("Coverage: City of Austin municipal boundary")
    print("H3 resolution: 8")
    print("Static downloads:")
    for source in STATIC_SOURCES:
        print(f"  - {source.name}: {source.url}")
    print("Dynamic downloads: Census ACS API, Austin zoning ArcGIS, FEMA NFHL ArcGIS")
    print(f"Raw cache: {PIPELINE_DIR / 'data/raw'}")
    print(f"Facts output: {FACTS_PATH}")
    print("Neon is changed only by the load/run command after validation passes.")


def main() -> None:
    # Pipeline-specific values win; the existing web DATABASE_URL is a convenient fallback.
    web_env = dotenv_values(PIPELINE_DIR.parent / "apps" / "web" / ".env")
    pipeline_env = dotenv_values(PIPELINE_DIR / ".env")
    for key in ("DATABASE_URL", "CENSUS_API_KEY", "OSRM_CAR_URL", "OSRM_FOOT_URL"):
        value = pipeline_env.get(key) or web_env.get(key)
        if value:
            os.environ.setdefault(key, value)
    parser = argparse.ArgumentParser(prog="wherehouse-ingest")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("plan", help="show sources and outputs without changing anything")
    download_parser = subparsers.add_parser("download", help="download source snapshots")
    download_parser.add_argument("--refresh", action="store_true", help="replace cached downloads")
    subparsers.add_parser("build", help="build H3 facts from cached sources")
    subparsers.add_parser("validate", help="validate the generated H3 facts")
    subparsers.add_parser("load", help="load and atomically activate validated facts in Neon")
    run_parser = subparsers.add_parser("run", help="download, build, validate, and load")
    run_parser.add_argument("--refresh", action="store_true", help="replace cached downloads")
    for command, help_text in (
        ("tiles-prepare", "prepare display geometry as FlatGeobuf"),
        ("tiles-build", "build PMTiles from prepared display geometry"),
        ("tiles-validate", "validate generated PMTiles files"),
    ):
        tile_parser = subparsers.add_parser(command, help=help_text)
        tile_parser.add_argument(
            "layers",
            nargs="*",
            choices=("roads", "zoning", "flood", "buildings", "poi"),
            help="layers to process; defaults to all five",
        )
    reach_build = subparsers.add_parser(
        "reach-build", help="build checkpointed car and foot OSRM reachability"
    )
    reach_build.add_argument(
        "--refresh", action="store_true", help="replace existing duration checkpoints"
    )
    reach_build.add_argument("--source-chunk-size", type=int, default=40)
    reach_build.add_argument("--destination-chunk-size", type=int, default=160)
    subparsers.add_parser("reach-validate", help="validate packed reachability output")
    subparsers.add_parser("reach-load", help="load validated reachability into Neon")
    args = parser.parse_args()

    if args.command == "plan":
        _plan()
    elif args.command == "download":
        print(f"Wrote {download_sources(refresh=args.refresh)}")
    elif args.command == "build":
        if not MANIFEST_PATH.exists():
            raise RuntimeError("No source manifest. Run download first.")
        print(f"Wrote {build_facts()}")
    elif args.command == "validate":
        checks = validate_facts(FACTS_PATH)
        _print_checks(checks)
        if not all(check.passed for check in checks):
            raise SystemExit(1)
    elif args.command == "load":
        _print_checks(require_valid(FACTS_PATH))
        print(f"Activated Neon dataset {load_and_promote(FACTS_PATH)}")
    elif args.command == "run":
        print(f"Wrote {download_sources(refresh=args.refresh)}")
        print(f"Wrote {build_facts()}")
        _print_checks(require_valid(FACTS_PATH))
        print(f"Activated Neon dataset {load_and_promote(FACTS_PATH)}")
    elif args.command == "tiles-prepare":
        prepare_tile_sources(args.layers)
    elif args.command == "tiles-build":
        build_pmtiles(args.layers)
    elif args.command == "tiles-validate":
        validate_pmtiles(args.layers)
    elif args.command == "reach-build":
        output = build_reachability(
            refresh=args.refresh,
            source_chunk_size=args.source_chunk_size,
            destination_chunk_size=args.destination_chunk_size,
        )
        print(f"Wrote {output}")
    elif args.command == "reach-validate":
        checks = validate_reachability()
        _print_checks(checks)
        if not all(check.passed for check in checks):
            raise SystemExit(1)
    elif args.command == "reach-load":
        _print_checks(require_valid_reachability())
        dataset_id, row_count = load_reachability()
        print(f"Loaded {row_count:,} reachability rows for Neon dataset {dataset_id}")


if __name__ == "__main__":
    main()
