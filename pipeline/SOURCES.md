# Ingestion sources

The manual pipeline snapshots source files before transforming them. Runtime API requests never
call these providers.

| Layer | Snapshot | Fields used | Authority |
|---|---|---|---|
| Boundary | [2024 TIGER/Line Texas places](https://www2.census.gov/geo/tiger/TIGER2024/PLACE/tl_2024_48_place.zip) | Austin place polygon (`PLACEFP=05000`) | U.S. Census Bureau |
| Demographics | [2024 ACS 5-year](https://api.census.gov/data/2024/acs/acs5.html) and matching [2024 TIGER tracts](https://www2.census.gov/geo/tiger/TIGER2024/TRACT/tl_2024_48_tract.zip) | Population (`B01003_001E`), median household income (`B19013_001E`), median age (`B01002_001E`) | U.S. Census Bureau |
| Roads and POIs | [Geofabrik Texas OpenStreetMap PBF](https://download.geofabrik.de/north-america/us/texas.html) | `highway`, `amenity`, `shop`, `building`, `landuse`, and geometry | OpenStreetMap contributors / Geofabrik |
| Zoning | [City of Austin Zoning feature layer](https://maps.austintexas.gov/gis/rest/Shared/Zoning_1/MapServer/0) | `ZONING_BASE` and geometry | City of Austin Geospatial Services |
| Flood | [City of Austin FEMA Floodplain layer](https://maps.austintexas.gov/ArcGIS/rest/services/Shared/Floodplain/MapServer/1) | `FLOOD_ZONE` and geometry; SFHA is derived from FEMA zone classes | FEMA data served by City of Austin |
| Air quality | [2025 EPA AirData daily PM2.5](https://aqs.epa.gov/aqsweb/airdata/download_files.html) (`88101`) | Monitor coordinates, arithmetic mean, and AQI | U.S. EPA |

Source endpoints are pinned in `src/wherehouse_pipeline/config.py`. Every completed download records
the endpoint, vintage, timestamp, byte count, and SHA-256 checksum in
`data/source-manifest.json`.

The OSM source is licensed under ODbL and requires OpenStreetMap attribution. Government datasets
are still accompanied by their provider attribution and source metadata. Review upstream metadata
before redistributing raw snapshots or derived map tiles.
