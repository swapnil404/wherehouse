from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Any

import geopandas as gpd
import psycopg

from .config import H3_RESOLUTION, MANIFEST_PATH, PIPELINE_DIR, PIPELINE_VERSION
from .manifest import read_manifest


FACT_COLUMNS = [
    "h3_index",
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
]


def _value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if hasattr(value, "item"):
        return value.item()
    return value


def _apply_schema(connection: psycopg.Connection[Any]) -> None:
    for path in sorted((PIPELINE_DIR / "sql").glob("*.sql")):
        connection.execute(path.read_text(encoding="utf-8"))


def load_and_promote(path: Path) -> str:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is required to load facts into Neon")

    frame = gpd.read_parquet(path).to_crs("EPSG:4326")
    manifest = read_manifest(MANIFEST_PATH)
    placeholders = ", ".join(["%s"] * len(FACT_COLUMNS))
    insert_columns = ", ".join(FACT_COLUMNS)
    statement = f"""
        INSERT INTO h3_cell_fact (
            dataset_id, geometry, {insert_columns}
        ) VALUES (
            %s, ST_GeomFromText(%s, 4326), {placeholders}
        )
    """

    with psycopg.connect(database_url) as connection:
        # Only one manual ingestion can build/promote a dataset at a time.
        connection.execute("SELECT pg_advisory_xact_lock(82460317)")
        _apply_schema(connection)
        dataset_id = connection.execute(
            """
            INSERT INTO geo_dataset (status, coverage_area, h3_resolution, pipeline_version)
            VALUES ('building', 'Austin city limits', %s, %s)
            RETURNING id
            """,
            (H3_RESOLUTION, PIPELINE_VERSION),
        ).fetchone()[0]

        source_rows = []
        for source in manifest["sources"]:
            source_rows.append(
                (
                    dataset_id,
                    source["name"],
                    source["url"],
                    source.get("year"),
                    source["downloaded_at"],
                    source["sha256"],
                    source["bytes"],
                )
            )
        with connection.cursor() as cursor:
            cursor.executemany(
                """
                INSERT INTO geo_source_snapshot (
                    dataset_id, source_name, source_url, source_year,
                    downloaded_at, sha256, byte_count
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                source_rows,
            )

        rows = []
        for _, row in frame.iterrows():
            values = [_value(row[column]) for column in FACT_COLUMNS]
            rows.append((dataset_id, row.geometry.wkt, *values))
        with connection.cursor() as cursor:
            cursor.executemany(statement, rows)

        stored_count = connection.execute(
            "SELECT count(*) FROM h3_cell_fact WHERE dataset_id = %s", (dataset_id,)
        ).fetchone()[0]
        if stored_count != len(frame):
            raise RuntimeError(f"Neon row-count check failed: expected {len(frame)}, got {stored_count}")

        # The pointer changes only after every row and source snapshot is present.
        connection.execute(
            "UPDATE geo_dataset SET status = 'archived' WHERE status = 'active'"
        )
        connection.execute(
            "UPDATE geo_dataset SET status = 'active', cell_count = %s, activated_at = now() WHERE id = %s",
            (stored_count, dataset_id),
        )
        connection.execute(
            """
            INSERT INTO geo_active_dataset (singleton, dataset_id)
            VALUES (true, %s)
            ON CONFLICT (singleton) DO UPDATE SET dataset_id = EXCLUDED.dataset_id
            """,
            (dataset_id,),
        )
    return str(dataset_id)
