from __future__ import annotations

import json
import math
import re
import zipfile
from pathlib import Path

import geopandas as gpd
import h3
import numpy as np
import osmium
import pandas as pd
import pyogrio
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import LineString, Polygon

from .config import (
    ACS_VARIABLES,
    AIR_QUALITY_RASTER_PATH,
    AUSTIN_PLACE_FIPS,
    FACTS_PATH,
    H3_RESOLUTION,
    PROCESSED_DIR,
    RAW_DIR,
    TEXAS_FIPS,
    WGS84,
    WORKING_CRS,
)


def _boundary() -> gpd.GeoDataFrame:
    places = gpd.read_file(f"zip://{RAW_DIR / 'tiger_places_2024.zip'}")
    result = places.loc[
        (places["STATEFP"] == TEXAS_FIPS) & (places["PLACEFP"] == AUSTIN_PLACE_FIPS),
        ["geometry"],
    ].copy()
    if len(result) != 1:
        raise RuntimeError(f"Expected one Austin boundary, found {len(result)}")
    return result.to_crs(WGS84)


def _h3_grid(boundary: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    cells = sorted(h3.geo_to_cells(boundary.geometry.iloc[0].__geo_interface__, H3_RESOLUTION))
    records = []
    for cell in cells:
        lat, lon = h3.cell_to_latlng(cell)
        polygon = Polygon([(lng, latitude) for latitude, lng in h3.cell_to_boundary(cell)])
        records.append(
            {"h3_index": cell, "centroid_lat": lat, "centroid_lon": lon, "geometry": polygon}
        )
    return gpd.GeoDataFrame(records, geometry="geometry", crs=WGS84)


def _read_acs() -> pd.DataFrame:
    payload = json.loads((RAW_DIR / "acs5_2024_texas_tracts.json").read_text(encoding="utf-8"))
    frame = pd.DataFrame(payload[1:], columns=payload[0])
    frame = frame.rename(columns=ACS_VARIABLES)
    frame["GEOID"] = frame["state"] + frame["county"] + frame["tract"]
    for column in ("population", "median_income", "median_age"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
        frame.loc[frame[column] < 0, column] = np.nan
    return frame[["GEOID", "population", "median_income", "median_age"]]


def _aggregate_demographics(grid: gpd.GeoDataFrame, boundary: gpd.GeoDataFrame) -> pd.DataFrame:
    tracts = gpd.read_file(f"zip://{RAW_DIR / 'tiger_tracts_2024.zip'}")
    tracts = tracts.to_crs(WGS84)
    tracts = tracts.loc[tracts.intersects(boundary.geometry.iloc[0]), ["GEOID", "geometry"]]
    tracts = tracts.merge(_read_acs(), on="GEOID", how="left").to_crs(WORKING_CRS)
    tracts["tract_area_m2"] = tracts.area

    projected = grid[["h3_index", "geometry"]].to_crs(WORKING_CRS)
    pieces = gpd.overlay(projected, tracts, how="intersection", keep_geom_type=False)
    pieces["overlap_m2"] = pieces.area
    pieces["area_weight"] = pieces["overlap_m2"] / pieces["tract_area_m2"]
    pieces["population_part"] = pieces["population"] * pieces["area_weight"]

    def weighted(group: pd.DataFrame, column: str) -> float:
        valid = group[column].notna() & (group["population_part"] > 0)
        if not valid.any():
            return math.nan
        return float(np.average(group.loc[valid, column], weights=group.loc[valid, "population_part"]))

    rows = []
    for h3_index, group in pieces.groupby("h3_index"):
        rows.append(
            {
                "h3_index": h3_index,
                "population": float(group["population_part"].sum()),
                "median_income": weighted(group, "median_income"),
                "median_age": weighted(group, "median_age"),
            }
        )
    return pd.DataFrame(rows)


TAG_PATTERN = re.compile(r'"([^"\\]+)"=>"([^"\\]*)"')


def _tags(row: pd.Series) -> dict[str, str]:
    result: dict[str, str] = {}
    for key in ("highway", "amenity", "shop", "tourism", "office", "building", "landuse"):
        value = row.get(key)
        if pd.notna(value) and str(value):
            result[key] = str(value)
    other = row.get("other_tags")
    if pd.notna(other):
        result.update(dict(TAG_PATTERN.findall(str(other))))
    return result


def _read_osm_layer(layer: str, boundary: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    path = RAW_DIR / "texas-latest.osm.pbf"
    if layer == "multipolygons":
        gdal_temp_dir = PROCESSED_DIR / ".gdal-tmp"
        gdal_temp_dir.mkdir(parents=True, exist_ok=True)
        pyogrio.set_gdal_config_options({"CPL_TMPDIR": str(gdal_temp_dir)})
    data = gpd.read_file(
        path,
        layer=layer,
        bbox=tuple(boundary.total_bounds),
        engine="pyogrio",
        # GDAL's OSM driver can return an empty multipolygons layer through
        # the Arrow read path even when the PBF contains polygon features.
        use_arrow=layer != "multipolygons",
    )
    if data.crs is None:
        data = data.set_crs(WGS84)
    return gpd.clip(data.to_crs(WGS84), boundary)


def _read_osm_roads(boundary: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Read highway ways natively because GDAL can silently truncate OSM line reads."""
    boundary_geometry = boundary.geometry.iloc[0]
    xmin, ymin, xmax, ymax = boundary_geometry.bounds
    records: list[dict[str, object]] = []

    class RoadHandler(osmium.SimpleHandler):
        def way(self, way) -> None:
            highway = way.tags.get("highway")
            if not highway:
                return
            try:
                coordinates = [(node.lon, node.lat) for node in way.nodes]
            except osmium.InvalidLocationError:
                return
            if len(coordinates) < 2:
                return
            xs, ys = zip(*coordinates, strict=True)
            if max(xs) < xmin or min(xs) > xmax or max(ys) < ymin or min(ys) > ymax:
                return
            geometry = LineString(coordinates).intersection(boundary_geometry)
            if geometry.is_empty:
                return
            records.append(
                {
                    "road_class": str(highway),
                    "name": str(way.tags.get("name")) if way.tags.get("name") else None,
                    "geometry": geometry,
                }
            )

    RoadHandler().apply_file(RAW_DIR / "texas-latest.osm.pbf", locations=True, idx="flex_mem")
    return gpd.GeoDataFrame(records, geometry="geometry", crs=WGS84)


def _aggregate_roads(grid: gpd.GeoDataFrame, boundary: gpd.GeoDataFrame) -> pd.DataFrame:
    roads = _read_osm_roads(boundary).rename(columns={"road_class": "highway"})
    roads = roads[["highway", "geometry"]].to_crs(WORKING_CRS)
    projected = grid[["h3_index", "geometry"]].to_crs(WORKING_CRS)

    pieces = gpd.overlay(projected, roads, how="intersection", keep_geom_type=False)
    pieces["length_km"] = pieces.length / 1000
    lengths = pieces.groupby("h3_index")["length_km"].sum().rename("road_length_km")

    highway_classes = {"motorway", "motorway_link", "trunk", "trunk_link", "primary"}
    highways = roads.loc[roads["highway"].isin(highway_classes), ["geometry"]]
    if highways.empty:
        raise RuntimeError("No OSM highways found inside the Austin boundary")
    centroids = projected.copy()
    centroids["geometry"] = centroids.centroid
    nearest = gpd.sjoin_nearest(centroids, highways, how="left", distance_col="highway_m")
    distances = nearest.groupby("h3_index")["highway_m"].min().div(1000)

    result = pd.concat([lengths, distances.rename("highway_distance_km")], axis=1).reset_index()
    return result


def _poi_kind(tags: dict[str, str]) -> str | None:
    amenity = tags.get("amenity", "")
    shop = tags.get("shop", "")
    building = tags.get("building", "")
    landuse = tags.get("landuse", "")
    if building in {"warehouse", "industrial"} or landuse in {"industrial", "logistics"}:
        return "competitor"
    if amenity in {"fuel", "bank", "restaurant", "cafe"} or shop in {
        "convenience",
        "hardware",
        "trade",
    }:
        return "complementary"
    if amenity in {"hospital", "university", "marketplace"} or shop in {
        "mall",
        "supermarket",
        "department_store",
    }:
        return "anchor"
    if amenity or shop or tags.get("tourism") or tags.get("office"):
        return "other"
    return None


def _aggregate_pois(grid: gpd.GeoDataFrame, boundary: gpd.GeoDataFrame) -> pd.DataFrame:
    collections = []
    for layer in ("points", "multipolygons"):
        layer_data = _read_osm_layer(layer, boundary)
        if layer_data.empty:
            continue
        layer_data["poi_kind"] = layer_data.apply(lambda row: _poi_kind(_tags(row)), axis=1)
        layer_data = layer_data.loc[layer_data["poi_kind"].notna(), ["poi_kind", "geometry"]]
        layer_data["geometry"] = layer_data.representative_point()
        collections.append(layer_data)
    if not collections:
        raise RuntimeError("No OSM POIs found inside the Austin boundary")
    pois = gpd.GeoDataFrame(pd.concat(collections, ignore_index=True), crs=WGS84).to_crs(WORKING_CRS)

    projected = grid[["h3_index", "geometry"]].to_crs(WORKING_CRS)
    centroids = projected.copy()
    centroids["geometry"] = centroids.centroid
    result = pd.DataFrame({"h3_index": projected["h3_index"]})

    inside = gpd.sjoin(pois, projected, how="inner", predicate="within")
    total = inside.groupby("h3_index").size()
    result["poi_count"] = result["h3_index"].map(total).fillna(0).astype(int)

    for radius in (500, 1000, 2000, 5000):
        buffers = centroids.copy()
        buffers["geometry"] = buffers.buffer(radius)
        joined = gpd.sjoin(pois, buffers, how="inner", predicate="within")
        for kind in ("competitor", "complementary", "anchor"):
            counts = joined.loc[joined["poi_kind"] == kind].groupby("h3_index").size()
            column = f"{kind}_count_{radius // 1000}km" if radius >= 1000 else f"{kind}_count_500m"
            result[column] = result["h3_index"].map(counts).fillna(0).astype(int)
    return result


INDUSTRIAL_ZONES = {"IP", "LI", "MI", "W/LO"}
COMMERCIAL_ZONES = {"CBD", "CH", "CR", "CS", "CS-1", "DMU", "GO", "GR", "LO", "LR"}
RESIDENTIAL_PREFIXES = ("SF", "MF", "MH", "RR")


def _zone_class(value: object) -> str:
    zone = str(value or "").upper().split("-")[0]
    if zone in INDUSTRIAL_ZONES:
        return "industrial"
    if zone in COMMERCIAL_ZONES:
        return "commercial"
    if zone.startswith(RESIDENTIAL_PREFIXES):
        return "residential"
    if zone == "AG":
        return "agricultural"
    return "other"


def _normalize_polygons(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    result = frame.copy()
    result["geometry"] = result.geometry.make_valid(method="structure", keep_collapsed=False)
    result = result.explode(index_parts=False, ignore_index=True)
    return result.loc[result.geom_type.isin({"Polygon", "MultiPolygon"})].copy()


def _aggregate_zoning(grid: gpd.GeoDataFrame, boundary: gpd.GeoDataFrame) -> pd.DataFrame:
    zoning = _normalize_polygons(
        gpd.read_file(RAW_DIR / "austin_zoning.geojson").to_crs(WGS84)
    )
    zoning = gpd.clip(zoning, boundary, keep_geom_type=True)
    zoning = _normalize_polygons(zoning)
    zone_field = next((name for name in ("ZONING_BASE", "zoning_base") if name in zoning), None)
    if zone_field is None:
        raise RuntimeError("Austin zoning data has no ZONING_BASE field")
    zoning["zone_class"] = zoning[zone_field].map(_zone_class)

    projected = grid[["h3_index", "geometry"]].to_crs(WORKING_CRS)
    pieces = gpd.overlay(
        projected, zoning[["zone_class", "geometry"]].to_crs(WORKING_CRS), how="intersection"
    )
    pieces["area_m2"] = pieces.area
    area = pieces.pivot_table(
        index="h3_index", columns="zone_class", values="area_m2", aggfunc="sum", fill_value=0
    )
    dominant = area.idxmax(axis=1).rename("dominant_zone_class")
    cell_area = projected.set_index("h3_index").area
    result = dominant.to_frame()
    for kind in ("commercial", "industrial", "residential"):
        values = area[kind] if kind in area else pd.Series(0.0, index=area.index)
        result[f"{kind}_area_pct"] = (100 * values / cell_area.reindex(area.index)).clip(0, 100)
    return result.reset_index()


def _aggregate_flood(grid: gpd.GeoDataFrame, boundary: gpd.GeoDataFrame) -> pd.DataFrame:
    flood = _normalize_polygons(
        gpd.read_file(RAW_DIR / "fema_flood_zones.geojson").to_crs(WGS84)
    )
    flood = gpd.clip(flood, boundary, keep_geom_type=True)
    flood = _normalize_polygons(flood)
    zone_field = next((name for name in ("FLD_ZONE", "fld_zone") if name in flood), None)
    sfha_field = next((name for name in ("SFHA_TF", "sfha_tf") if name in flood), None)
    if not zone_field:
        zone_field = next((name for name in ("FLOOD_ZONE", "flood_zone") if name in flood), None)
    if not zone_field:
        raise RuntimeError("FEMA data is missing a flood-zone field")
    if sfha_field:
        flood["in_sfha"] = flood[sfha_field].astype(str).str.upper().isin(
            {"T", "TRUE", "Y", "YES"}
        )
    else:
        # Austin's FEMA mirror exposes FLOOD_ZONE but not FEMA's derived SFHA_TF flag.
        zone = flood[zone_field].astype(str).str.upper()
        flood["in_sfha"] = zone.str.match(r"^(A|V)")

    projected = grid[["h3_index", "geometry"]].to_crs(WORKING_CRS)
    pieces = gpd.overlay(
        projected,
        flood[[zone_field, "in_sfha", "geometry"]].to_crs(WORKING_CRS),
        how="intersection",
    )
    pieces["area_m2"] = pieces.area
    largest = pieces.sort_values("area_m2").groupby("h3_index").tail(1)
    sfha_area = pieces.loc[pieces["in_sfha"]].groupby("h3_index")["area_m2"].sum()
    cell_area = projected.set_index("h3_index").area
    result = largest.set_index("h3_index")[[zone_field]].rename(columns={zone_field: "flood_zone"})
    result["sfha_area_pct"] = (100 * sfha_area / cell_area).reindex(result.index).fillna(0).clip(0, 100)
    result["in_sfha"] = result["sfha_area_pct"] > 0
    return result.reset_index()


def _read_epa_monitors(boundary: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    archive = RAW_DIR / "epa_daily_pm25_2025.zip"
    with zipfile.ZipFile(archive) as bundle:
        csv_name = next(name for name in bundle.namelist() if name.lower().endswith(".csv"))
        with bundle.open(csv_name) as source:
            frame = pd.read_csv(source, low_memory=False)
    frame.columns = [column.strip().lower().replace(" ", "_") for column in frame.columns]
    xmin, ymin, xmax, ymax = boundary.total_bounds
    frame = frame.loc[
        frame["latitude"].between(ymin - 2, ymax + 2)
        & frame["longitude"].between(xmin - 2, xmax + 2)
    ].copy()
    if frame.empty:
        raise RuntimeError("No EPA PM2.5 monitors found near Austin")
    monitor_columns = ["state_code", "county_code", "site_num", "latitude", "longitude"]
    monitors = (
        frame.groupby(monitor_columns, as_index=False)
        .agg(pm25=("arithmetic_mean", "mean"), aqi=("aqi", "mean"))
        .dropna(subset=["pm25"])
    )
    return gpd.GeoDataFrame(
        monitors,
        geometry=gpd.points_from_xy(monitors["longitude"], monitors["latitude"]),
        crs=WGS84,
    )


def _aggregate_air_quality(grid: gpd.GeoDataFrame, boundary: gpd.GeoDataFrame) -> pd.DataFrame:
    monitors = _read_epa_monitors(boundary).to_crs(WORKING_CRS)
    xmin, ymin, xmax, ymax = boundary.to_crs(WORKING_CRS).total_bounds
    pixel_size = 1_000.0
    width = math.ceil((xmax - xmin) / pixel_size)
    height = math.ceil((ymax - ymin) / pixel_size)
    xs = xmin + (np.arange(width) + 0.5) * pixel_size
    ys = ymax - (np.arange(height) + 0.5) * pixel_size
    raster_x, raster_y = np.meshgrid(xs, ys)

    monitor_xy = np.column_stack((monitors.geometry.x, monitors.geometry.y))
    raster_xy = np.column_stack((raster_x.ravel(), raster_y.ravel()))
    distances = np.sqrt(((raster_xy[:, None, :] - monitor_xy[None, :, :]) ** 2).sum(axis=2))
    weights = 1 / np.maximum(distances, 100) ** 2
    pm25_monitors = np.asarray(monitors["pm25"], dtype=float)
    aqi_monitors = np.asarray(monitors["aqi"], dtype=float)
    pm25_raster = ((weights @ pm25_monitors) / weights.sum(axis=1)).reshape(height, width)
    valid_aqi = np.isfinite(aqi_monitors)
    if valid_aqi.any():
        aqi_raster = (
            (weights[:, valid_aqi] @ aqi_monitors[valid_aqi])
            / weights[:, valid_aqi].sum(axis=1)
        ).reshape(height, width)
    else:
        aqi_raster = np.full((height, width), np.nan)

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        AIR_QUALITY_RASTER_PATH,
        "w",
        driver="GTiff",
        width=width,
        height=height,
        count=2,
        dtype="float32",
        crs=WORKING_CRS,
        transform=from_origin(xmin, ymax, pixel_size, pixel_size),
        nodata=np.nan,
    ) as dataset:
        dataset.write(pm25_raster.astype("float32"), 1)
        dataset.write(aqi_raster.astype("float32"), 2)
        dataset.set_band_description(1, "annual_mean_pm25")
        dataset.set_band_description(2, "annual_mean_aqi")

    centroids = grid[["h3_index", "geometry"]].to_crs(WORKING_CRS)
    centroids["geometry"] = centroids.centroid
    coordinates = list(zip(centroids.geometry.x, centroids.geometry.y, strict=True))
    with rasterio.open(AIR_QUALITY_RASTER_PATH) as dataset:
        samples = np.asarray(list(dataset.sample(coordinates)))
    return pd.DataFrame(
        {"h3_index": centroids["h3_index"], "pm25": samples[:, 0], "aqi": samples[:, 1]}
    )


def build_facts() -> Path:
    boundary = _boundary()
    grid = _h3_grid(boundary)
    projected = grid.to_crs(WORKING_CRS)
    facts = grid.copy()
    facts["cell_area_km2"] = projected.area / 1_000_000

    aggregators = (
        ("demographics", _aggregate_demographics),
        ("roads", _aggregate_roads),
        ("POIs", _aggregate_pois),
        ("zoning", _aggregate_zoning),
        ("flood", _aggregate_flood),
        ("air quality", _aggregate_air_quality),
    )
    for name, aggregate in aggregators:
        print(f"Building {name} facts...", flush=True)
        component = aggregate(grid, boundary)
        facts = facts.merge(component, on="h3_index", how="left")

    facts["population"] = facts["population"].fillna(0).round().astype(int)
    facts["population_density"] = facts["population"] / facts["cell_area_km2"]
    facts["road_length_km"] = facts["road_length_km"].fillna(0)
    facts["road_density"] = facts["road_length_km"] / facts["cell_area_km2"]
    facts["dominant_zone_class"] = facts["dominant_zone_class"].fillna("unknown")
    for column in ("commercial_area_pct", "industrial_area_pct", "residential_area_pct"):
        facts[column] = facts[column].fillna(0)
    facts["flood_zone"] = facts["flood_zone"].fillna("UNKNOWN")
    facts["sfha_area_pct"] = facts["sfha_area_pct"].fillna(0)
    facts["in_sfha"] = facts["in_sfha"].fillna(False).astype(bool)

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    facts.to_parquet(FACTS_PATH, index=False)
    return FACTS_PATH
