"""Load the atomically selected geospatial dataset from Neon."""

import h3
import pandas as pd
import psycopg

from config import DATABASE_URL


FACT_COLUMNS = (
    "h3_index", "centroid_lat", "centroid_lon", "population", "population_density",
    "median_income", "median_age", "road_density", "highway_distance_km", "poi_count",
    "competitor_count_500m", "competitor_count_1km", "competitor_count_2km",
    "competitor_count_5km", "complementary_count_500m", "complementary_count_1km",
    "complementary_count_2km", "complementary_count_5km", "anchor_count_500m",
    "anchor_count_1km", "anchor_count_2km", "anchor_count_5km", "dominant_zone_class",
    "commercial_area_pct", "industrial_area_pct", "residential_area_pct", "flood_zone",
    "in_sfha", "sfha_area_pct", "pm25", "aqi",
)

_df: pd.DataFrame | None = None
_cell_index: dict[str, int] | None = None
_dataset_id: str | None = None
_h3_resolution: int | None = None


def load_data(database_url: str | None = None) -> pd.DataFrame:
    """Load all non-geometry facts belonging to the active dataset."""
    global _df, _cell_index, _dataset_id, _h3_resolution
    if _df is not None:
        return _df

    url = database_url or DATABASE_URL
    if not url:
        raise RuntimeError("DATABASE_URL is required to load the active geospatial dataset")

    with psycopg.connect(url) as connection:
        active = connection.execute(
            """
            SELECT d.id::text, d.h3_resolution
            FROM geo_active_dataset AS active
            JOIN geo_dataset AS d ON d.id = active.dataset_id
            WHERE active.singleton = true AND d.status = 'active'
            """
        ).fetchone()
        if active is None:
            raise RuntimeError("No active geospatial dataset is configured")

        _dataset_id, _h3_resolution = str(active[0]), int(active[1])
        selected_columns = ", ".join(f"fact.{column}" for column in FACT_COLUMNS)
        rows = connection.execute(
            f"""
            SELECT {selected_columns}
            FROM h3_cell_fact AS fact
            WHERE fact.dataset_id = %s
            ORDER BY fact.h3_index
            """,
            (_dataset_id,),
        ).fetchall()

    if not rows:
        raise RuntimeError(f"Active geospatial dataset {_dataset_id} contains no cells")

    _df = pd.DataFrame(rows, columns=FACT_COLUMNS)
    _cell_index = None
    return _df


def get_df() -> pd.DataFrame:
    if _df is None:
        raise RuntimeError("Data not loaded. Call load_data() first.")
    return _df


def get_dataset_id() -> str:
    if _dataset_id is None:
        raise RuntimeError("Data not loaded. Call load_data() first.")
    return _dataset_id


def get_h3_resolution() -> int:
    if _h3_resolution is not None:
        return _h3_resolution
    return h3.get_resolution(str(get_df()["h3_index"].iloc[0]))


def get_cell_index() -> dict[str, int]:
    """Return the exact H3-index-to-row-position lookup, built once."""
    global _cell_index
    if _cell_index is None:
        frame = get_df()
        _cell_index = {str(cell): position for position, cell in enumerate(frame["h3_index"])}
    return _cell_index
