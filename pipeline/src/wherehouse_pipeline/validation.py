from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

import geopandas as gpd
import h3
import numpy as np

from .config import H3_RESOLUTION, PROCESSED_DIR


@dataclass(frozen=True)
class Check:
    name: str
    passed: bool
    detail: str


REQUIRED_COLUMNS = {
    "h3_index",
    "geometry",
    "centroid_lat",
    "centroid_lon",
    "cell_area_km2",
    "population",
    "population_density",
    "median_income",
    "median_age",
    "road_length_km",
    "road_density",
    "highway_distance_km",
    "poi_count",
    "competitor_count_500m",
    "competitor_count_1km",
    "competitor_count_2km",
    "competitor_count_5km",
    "complementary_count_500m",
    "complementary_count_1km",
    "complementary_count_2km",
    "complementary_count_5km",
    "anchor_count_500m",
    "anchor_count_1km",
    "anchor_count_2km",
    "anchor_count_5km",
    "dominant_zone_class",
    "commercial_area_pct",
    "industrial_area_pct",
    "residential_area_pct",
    "flood_zone",
    "in_sfha",
    "sfha_area_pct",
    "pm25",
    "aqi",
}


def validate_facts(path: Path) -> list[Check]:
    frame = gpd.read_parquet(path)
    missing = sorted(REQUIRED_COLUMNS - set(frame.columns))
    checks = [Check("required_columns", not missing, f"missing={missing}")]
    if missing:
        return checks

    duplicate_count = int(frame["h3_index"].duplicated().sum())
    checks.append(Check("unique_h3", duplicate_count == 0, f"duplicates={duplicate_count}"))
    checks.append(Check("cell_count", 500 <= len(frame) <= 2500, f"cells={len(frame)}"))

    invalid_h3 = sum(
        not h3.is_valid_cell(str(cell)) or h3.get_resolution(str(cell)) != H3_RESOLUTION
        for cell in frame["h3_index"]
    )
    checks.append(Check("h3_resolution", invalid_h3 == 0, f"invalid={invalid_h3}"))
    checks.append(Check("valid_geometry", bool(frame.geometry.notna().all() and frame.is_valid.all()), ""))

    checks.append(
        Check(
            "austin_coordinates",
            bool(frame["centroid_lat"].between(30.0, 30.7).all())
            and bool(frame["centroid_lon"].between(-98.1, -97.4).all()),
            "expected Austin-area centroids",
        )
    )
    nonnegative_columns = [
        "population",
        "population_density",
        "cell_area_km2",
        "road_length_km",
        "road_density",
        "highway_distance_km",
        "poi_count",
        *[column for column in frame.columns if "_count_" in column],
    ]
    for column in nonnegative_columns:
        valid = np.isfinite(frame[column]).all() and (frame[column] >= 0).all()
        checks.append(Check(f"nonnegative_{column}", bool(valid), ""))

    competitor_total = int(frame["competitor_count_5km"].sum())
    checks.append(
        Check(
            "competitor_coverage",
            competitor_total > 0,
            f"total_5km_count={competitor_total}",
        )
    )
    for column in (
        "commercial_area_pct",
        "industrial_area_pct",
        "residential_area_pct",
        "sfha_area_pct",
    ):
        checks.append(Check(f"range_{column}", bool(frame[column].between(0, 100).all()), "0..100"))

    zone_sum = frame[
        ["commercial_area_pct", "industrial_area_pct", "residential_area_pct"]
    ].sum(axis=1)
    checks.append(Check("zoning_area_total", bool((zone_sum <= 100.5).all()), "known classes <=100%"))

    for column in ("median_income", "median_age", "highway_distance_km", "pm25"):
        coverage = float(frame[column].notna().mean())
        checks.append(Check(f"coverage_{column}", coverage >= 0.95, f"coverage={coverage:.1%}"))

    report_path = PROCESSED_DIR / "validation-report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps({"passed": all(item.passed for item in checks), "checks": [asdict(c) for c in checks]}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    return checks


def require_valid(path: Path) -> list[Check]:
    checks = validate_facts(path)
    failed = [check for check in checks if not check.passed]
    if failed:
        details = "; ".join(f"{check.name}: {check.detail}" for check in failed)
        raise RuntimeError(f"Validation failed; Neon was not changed. {details}")
    return checks
