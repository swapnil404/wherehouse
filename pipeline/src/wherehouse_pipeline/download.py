from __future__ import annotations

import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import geopandas as gpd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .config import (
    ACS_VARIABLES,
    ACS_YEAR,
    AUSTIN_PLACE_FIPS,
    FEMA_FEATURE_URL,
    MANIFEST_PATH,
    PIPELINE_VERSION,
    RAW_DIR,
    STATIC_SOURCES,
    TEXAS_FIPS,
    WGS84,
    ZONING_FEATURE_URL,
)
from .manifest import sha256, write_manifest

USER_AGENT = "wherehouse-ingestion/0.1 (offline research pipeline)"


def _http_session() -> requests.Session:
    retries = Retry(
        total=5,
        connect=5,
        read=5,
        status=5,
        backoff_factor=1,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
    )
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    session.mount("https://", HTTPAdapter(max_retries=retries))
    return session


HTTP = _http_session()


def _temporary_path(destination: Path) -> Path:
    descriptor, name = tempfile.mkstemp(
        dir=destination.parent,
        prefix=f"{destination.name}.",
        suffix=".part",
    )
    os.close(descriptor)
    return Path(name)


def _download_file(url: str, destination: Path, refresh: bool) -> None:
    if destination.exists() and not refresh:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = _temporary_path(destination)
    try:
        with HTTP.get(url, stream=True, timeout=(30, 300)) as response:
            response.raise_for_status()
            with partial.open("wb") as output:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        output.write(chunk)
        partial.replace(destination)
    finally:
        partial.unlink(missing_ok=True)


def _austin_boundary() -> gpd.GeoDataFrame:
    places = gpd.read_file(f"zip://{RAW_DIR / 'tiger_places_2024.zip'}")
    boundary = places.loc[
        (places["STATEFP"] == TEXAS_FIPS) & (places["PLACEFP"] == AUSTIN_PLACE_FIPS)
    ].copy()
    if len(boundary) != 1:
        raise RuntimeError(f"Expected one Austin boundary, found {len(boundary)}")
    return boundary.to_crs(WGS84)


def _download_arcgis(
    *, name: str, url: str, destination: Path, bbox: tuple[float, float, float, float]
) -> dict[str, Any]:
    xmin, ymin, xmax, ymax = bbox
    spatial_params = {
        "where": "1=1",
        "geometry": f"{xmin},{ymin},{xmax},{ymax}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
    }
    id_response = HTTP.get(
        url,
        params={"f": "json", "returnIdsOnly": "true", **spatial_params},
        timeout=(30, 300),
    )
    id_response.raise_for_status()
    id_payload = id_response.json()
    if "error" in id_payload:
        raise RuntimeError(f"{name} ArcGIS ID query error: {id_payload['error']}")
    object_ids = sorted(id_payload.get("objectIds") or [])
    if not object_ids:
        raise RuntimeError(f"{name} ArcGIS query returned no features inside the Austin boundary")

    features: list[dict[str, Any]] = []
    page_size = 100
    for offset in range(0, len(object_ids), page_size):
        page_ids = object_ids[offset : offset + page_size]
        params = {
            "f": "geojson",
            "objectIds": ",".join(map(str, page_ids)),
            "outFields": "*",
            "outSR": 4326,
            "geometryPrecision": 7,
        }
        response = HTTP.get(url, params=params, timeout=(30, 300))
        response.raise_for_status()
        page = response.json()
        if "error" in page:
            raise RuntimeError(f"{name} ArcGIS error: {page['error']}")
        batch = page.get("features", [])
        if len(batch) != len(page_ids):
            raise RuntimeError(
                f"{name} ArcGIS page was incomplete: expected {len(page_ids)}, got {len(batch)}"
            )
        features.extend(batch)

    partial = _temporary_path(destination)
    try:
        partial.write_text(
            json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8"
        )
        partial.replace(destination)
    finally:
        partial.unlink(missing_ok=True)
    return {"feature_count": len(features)}


def _download_acs(destination: Path, census_api_key: str, refresh: bool) -> None:
    if destination.exists() and not refresh:
        return
    params = {
        "get": ",".join(ACS_VARIABLES),
        "for": "tract:*",
        "in": f"state:{TEXAS_FIPS} county:*",
        "key": census_api_key,
    }
    response = HTTP.get(
        f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5",
        params=params,
        timeout=(30, 300),
    )
    response.raise_for_status()
    partial = _temporary_path(destination)
    try:
        partial.write_text(json.dumps(response.json()), encoding="utf-8")
        partial.replace(destination)
    finally:
        partial.unlink(missing_ok=True)


def download_sources(*, refresh: bool = False) -> Path:
    census_api_key = os.getenv("CENSUS_API_KEY", "").strip()
    if not census_api_key:
        raise RuntimeError("CENSUS_API_KEY is required to download ACS data")

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, Any]] = []
    for source in STATIC_SOURCES:
        destination = RAW_DIR / source.filename
        _download_file(source.url, destination, refresh)
        records.append(
            {
                "name": source.name,
                "url": source.url,
                "year": source.year,
                "downloaded_at": datetime.fromtimestamp(destination.stat().st_mtime, UTC).isoformat(),
                "path": str(destination.relative_to(RAW_DIR.parent)),
                "bytes": destination.stat().st_size,
                "sha256": sha256(destination),
            }
        )

    acs_path = RAW_DIR / "acs5_2024_texas_tracts.json"
    _download_acs(acs_path, census_api_key, refresh)
    records.append(
        {
            "name": "acs5_tracts",
            "url": f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5",
            "year": ACS_YEAR,
            "downloaded_at": datetime.fromtimestamp(acs_path.stat().st_mtime, UTC).isoformat(),
            "path": str(acs_path.relative_to(RAW_DIR.parent)),
            "bytes": acs_path.stat().st_size,
            "sha256": sha256(acs_path),
        }
    )

    bbox = tuple(_austin_boundary().total_bounds)
    dynamic_sources = (
        ("austin_zoning", ZONING_FEATURE_URL, RAW_DIR / "austin_zoning.geojson"),
        ("fema_nfhl", FEMA_FEATURE_URL, RAW_DIR / "fema_flood_zones.geojson"),
    )
    for name, url, destination in dynamic_sources:
        if refresh or not destination.exists():
            extra = _download_arcgis(name=name, url=url, destination=destination, bbox=bbox)
        else:
            extra = {}
        records.append(
            {
                "name": name,
                "url": url,
                "year": None,
                "downloaded_at": datetime.fromtimestamp(destination.stat().st_mtime, UTC).isoformat(),
                "path": str(destination.relative_to(RAW_DIR.parent)),
                "bytes": destination.stat().st_size,
                "sha256": sha256(destination),
                **extra,
            }
        )

    write_manifest(MANIFEST_PATH, records, PIPELINE_VERSION)
    return MANIFEST_PATH
