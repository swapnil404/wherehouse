from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


PIPELINE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = PIPELINE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
MANIFEST_PATH = DATA_DIR / "source-manifest.json"
FACTS_PATH = PROCESSED_DIR / "h3_cell_facts.parquet"
AIR_QUALITY_RASTER_PATH = PROCESSED_DIR / "air_quality.tif"
TILE_SOURCE_DIR = PROCESSED_DIR / "tiles" / "source"
TILE_OUTPUT_DIR = PROCESSED_DIR / "tiles" / "output"

H3_RESOLUTION = 8
PIPELINE_VERSION = "0.1.0"
WORKING_CRS = "EPSG:32614"  # WGS 84 / UTM zone 14N; metres around Austin.
WGS84 = "EPSG:4326"

# Matching 2024 ACS/TIGER vintages make tract GEOID joins deterministic.
ACS_YEAR = 2024
EPA_YEAR = 2025  # Most recent complete calendar year.
TEXAS_FIPS = "48"
AUSTIN_PLACE_FIPS = "05000"


@dataclass(frozen=True)
class DownloadSource:
    name: str
    url: str
    filename: str
    year: int | None


STATIC_SOURCES = (
    DownloadSource(
        name="tiger_places",
        url="https://www2.census.gov/geo/tiger/TIGER2024/PLACE/tl_2024_48_place.zip",
        filename="tiger_places_2024.zip",
        year=2024,
    ),
    DownloadSource(
        name="tiger_tracts",
        url="https://www2.census.gov/geo/tiger/TIGER2024/TRACT/tl_2024_48_tract.zip",
        filename="tiger_tracts_2024.zip",
        year=2024,
    ),
    DownloadSource(
        name="osm_texas",
        url="https://download.geofabrik.de/north-america/us/texas-latest.osm.pbf",
        filename="texas-latest.osm.pbf",
        year=None,
    ),
    DownloadSource(
        name="epa_pm25",
        url="https://aqs.epa.gov/aqsweb/airdata/daily_88101_2025.zip",
        filename="epa_daily_pm25_2025.zip",
        year=2025,
    ),
)

ZONING_FEATURE_URL = (
    "https://maps.austintexas.gov/gis/rest/Shared/Zoning_1/MapServer/0/query"
)
FEMA_FEATURE_URL = (
    "https://maps.austintexas.gov/ArcGIS/rest/services/Shared/Floodplain/MapServer/1/query"
)

ACS_VARIABLES = {
    "NAME": "name",
    "B01003_001E": "population",
    "B19013_001E": "median_income",
    "B01002_001E": "median_age",
}
