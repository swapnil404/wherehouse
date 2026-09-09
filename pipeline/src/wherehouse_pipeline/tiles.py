from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd
import pandas as pd

from .build import (
    _boundary,
    _normalize_polygons,
    _poi_kind,
    _read_osm_layer,
    _read_osm_roads,
    _tags,
    _zone_class,
)
from .config import RAW_DIR, TILE_OUTPUT_DIR, TILE_SOURCE_DIR, WGS84


@dataclass(frozen=True)
class TileLayer:
    name: str
    min_zoom: int
    max_zoom: int
    attributes: tuple[str, ...]
    attribution: str

    @property
    def source_path(self) -> Path:
        return TILE_SOURCE_DIR / f"{self.name}.fgb"

    @property
    def output_path(self) -> Path:
        return TILE_OUTPUT_DIR / f"{self.name}.pmtiles"


LAYERS = {
    "roads": TileLayer(
        name="roads",
        min_zoom=8,
        max_zoom=16,
        attributes=("road_class", "name"),
        attribution="OpenStreetMap contributors / Geofabrik",
    ),
    "zoning": TileLayer(
        name="zoning",
        min_zoom=9,
        max_zoom=16,
        attributes=("zone_code", "zone_class"),
        attribution="City of Austin Geospatial Services",
    ),
    "flood": TileLayer(
        name="flood",
        min_zoom=9,
        max_zoom=16,
        attributes=("flood_zone", "in_sfha"),
        attribution="FEMA / City of Austin",
    ),
    "buildings": TileLayer(
        name="buildings",
        min_zoom=13,
        max_zoom=17,
        attributes=("building_type",),
        attribution="OpenStreetMap contributors / Geofabrik",
    ),
    "poi": TileLayer(
        name="poi",
        min_zoom=10,
        max_zoom=17,
        attributes=("name", "poi_kind", "poi_type"),
        attribution="OpenStreetMap contributors / Geofabrik",
    ),
}


def _clean(frame: gpd.GeoDataFrame, geometry_types: set[str]) -> gpd.GeoDataFrame:
    result = frame.to_crs(WGS84).copy()
    result = result.loc[result.geometry.notna() & ~result.geometry.is_empty].copy()
    result["geometry"] = result.geometry.make_valid()
    result = result.explode(index_parts=False, ignore_index=True)
    return result.loc[result.geom_type.isin(geometry_types)].reset_index(drop=True)


def _tag_value(row, key: str) -> str | None:
    value = row.get(key)
    if pd.notna(value) and str(value):
        return str(value)
    return _tags(row).get(key)


def _roads(boundary: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    roads = _read_osm_roads(boundary)
    return _clean(roads, {"LineString", "MultiLineString"})


def _zoning(boundary: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    zoning = _normalize_polygons(
        gpd.read_file(RAW_DIR / "austin_zoning.geojson").to_crs(WGS84)
    )
    zoning = gpd.clip(zoning, boundary, keep_geom_type=True)
    zone_field = next((name for name in ("ZONING_BASE", "zoning_base") if name in zoning), None)
    if zone_field is None:
        raise RuntimeError("Austin zoning data has no ZONING_BASE field")
    zoning["zone_code"] = zoning[zone_field].fillna("UNKNOWN").astype(str)
    zoning["zone_class"] = zoning["zone_code"].map(_zone_class)
    return _clean(zoning[["zone_code", "zone_class", "geometry"]], {"Polygon", "MultiPolygon"})


def _flood(boundary: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    flood = _normalize_polygons(
        gpd.read_file(RAW_DIR / "fema_flood_zones.geojson").to_crs(WGS84)
    )
    flood = gpd.clip(flood, boundary, keep_geom_type=True)
    zone_field = next(
        (name for name in ("FLD_ZONE", "fld_zone", "FLOOD_ZONE", "flood_zone") if name in flood),
        None,
    )
    if zone_field is None:
        raise RuntimeError("FEMA data is missing a flood-zone field")
    sfha_field = next((name for name in ("SFHA_TF", "sfha_tf") if name in flood), None)
    flood["flood_zone"] = flood[zone_field].fillna("UNKNOWN").astype(str)
    if sfha_field:
        flood["in_sfha"] = flood[sfha_field].astype(str).str.upper().isin(
            {"T", "TRUE", "Y", "YES"}
        )
    else:
        flood["in_sfha"] = flood["flood_zone"].str.upper().str.match(r"^(A|V)")
    return _clean(flood[["flood_zone", "in_sfha", "geometry"]], {"Polygon", "MultiPolygon"})


def _buildings(boundary: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    buildings = _read_osm_layer("multipolygons", boundary)
    buildings["building_type"] = buildings.apply(
        lambda row: _tag_value(row, "building"), axis=1
    )
    buildings = buildings.loc[
        buildings["building_type"].notna(), ["building_type", "geometry"]
    ]
    return _clean(buildings, {"Polygon", "MultiPolygon"})


def _poi_type(row) -> str:
    for key in ("amenity", "shop", "building", "landuse", "tourism", "office"):
        value = _tag_value(row, key)
        if value:
            return value
    return "unknown"


def _pois(boundary: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    collections = []
    visible_kinds = {"competitor", "complementary", "anchor"}
    for osm_layer in ("points", "multipolygons"):
        pois = _read_osm_layer(osm_layer, boundary)
        if pois.empty:
            continue
        pois["poi_kind"] = pois.apply(lambda row: _poi_kind(_tags(row)), axis=1)
        pois = pois.loc[pois["poi_kind"].isin(visible_kinds)].copy()
        if pois.empty:
            continue
        pois["name"] = pois.apply(lambda row: _tag_value(row, "name") or "", axis=1)
        pois["poi_type"] = pois.apply(_poi_type, axis=1)
        pois["geometry"] = pois.geometry.representative_point()
        collections.append(pois[["name", "poi_kind", "poi_type", "geometry"]])
    if not collections:
        raise RuntimeError("No classified OSM POIs found inside the Austin boundary")
    combined = gpd.GeoDataFrame(pd.concat(collections, ignore_index=True), crs=WGS84)
    return _clean(combined, {"Point"})


BUILDERS = {
    "roads": _roads,
    "zoning": _zoning,
    "flood": _flood,
    "buildings": _buildings,
    "poi": _pois,
}


def resolve_layers(names: list[str] | None) -> list[TileLayer]:
    requested = names or list(LAYERS)
    unknown = sorted(set(requested) - LAYERS.keys())
    if unknown:
        raise ValueError(f"Unknown tile layer(s): {', '.join(unknown)}")
    return [LAYERS[name] for name in requested]


def prepare_tile_sources(names: list[str] | None = None) -> list[Path]:
    boundary = _boundary()
    TILE_SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    outputs = []
    for layer in resolve_layers(names):
        print(f"Preparing {layer.name} geometry...", flush=True)
        frame = BUILDERS[layer.name](boundary)
        if frame.empty:
            raise RuntimeError(f"No features found for {layer.name}")
        layer.source_path.unlink(missing_ok=True)
        frame.to_file(layer.source_path, driver="FlatGeobuf", engine="pyogrio")
        print(f"Wrote {len(frame):,} features to {layer.source_path}", flush=True)
        outputs.append(layer.source_path)
    return outputs


def build_pmtiles(names: list[str] | None = None) -> list[Path]:
    executable = shutil.which("tippecanoe")
    if not executable:
        raise RuntimeError(
            "tippecanoe 2.17+ is required. Install it, then run the tiles-build command again."
        )
    TILE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    outputs = []
    for layer in resolve_layers(names):
        if not layer.source_path.exists():
            raise RuntimeError(f"Missing {layer.source_path}; run tiles-prepare first")
        command = [
            executable,
            "--force",
            "--output",
            str(layer.output_path),
            "--layer",
            layer.name,
            "--minimum-zoom",
            str(layer.min_zoom),
            "--maximum-zoom",
            str(layer.max_zoom),
            "--drop-densest-as-needed",
            "--name",
            f"Wherehouse Austin {layer.name}",
            "--attribution",
            layer.attribution,
        ]
        for attribute in layer.attributes:
            command.extend(("--include", attribute))
        command.append(str(layer.source_path))
        print(f"Building {layer.output_path}...", flush=True)
        subprocess.run(command, check=True)
        outputs.append(layer.output_path)
    return outputs


def validate_pmtiles(names: list[str] | None = None) -> list[Path]:
    outputs = []
    for layer in resolve_layers(names):
        path = layer.output_path
        if not path.is_file():
            raise RuntimeError(f"Missing {path}; run tiles-build first")
        with path.open("rb") as source:
            if source.read(7) != b"PMTiles":
                raise RuntimeError(f"{path} does not have a PMTiles header")
            version = source.read(1)
        if version != b"\x03":
            raise RuntimeError(f"{path} is not PMTiles version 3")
        if path.stat().st_size <= 127:
            raise RuntimeError(f"{path} is too small to contain tiles")
        print(f"PASS {layer.name}: {path.stat().st_size:,} bytes", flush=True)
        outputs.append(path)
    return outputs
