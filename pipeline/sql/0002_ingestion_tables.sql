CREATE TABLE IF NOT EXISTS geo_dataset (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    status text NOT NULL CHECK (status IN ('building', 'active', 'archived')),
    coverage_area text NOT NULL,
    h3_resolution integer NOT NULL,
    pipeline_version text NOT NULL,
    cell_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    activated_at timestamptz
);

CREATE TABLE IF NOT EXISTS geo_source_snapshot (
    dataset_id uuid NOT NULL REFERENCES geo_dataset(id) ON DELETE CASCADE,
    source_name text NOT NULL,
    source_url text NOT NULL,
    source_year integer,
    downloaded_at timestamptz NOT NULL,
    sha256 text NOT NULL,
    byte_count bigint NOT NULL,
    PRIMARY KEY (dataset_id, source_name)
);

CREATE TABLE IF NOT EXISTS h3_cell_fact (
    dataset_id uuid NOT NULL REFERENCES geo_dataset(id) ON DELETE CASCADE,
    h3_index text NOT NULL,
    geometry geometry(Polygon, 4326) NOT NULL,
    centroid_lat double precision NOT NULL,
    centroid_lon double precision NOT NULL,
    cell_area_km2 double precision NOT NULL,
    population integer NOT NULL,
    population_density double precision NOT NULL,
    median_income double precision,
    median_age double precision,
    road_length_km double precision NOT NULL,
    road_density double precision NOT NULL,
    highway_distance_km double precision NOT NULL,
    poi_count integer NOT NULL,
    competitor_count_500m integer NOT NULL,
    competitor_count_1km integer NOT NULL,
    competitor_count_2km integer NOT NULL,
    competitor_count_5km integer NOT NULL,
    complementary_count_500m integer NOT NULL,
    complementary_count_1km integer NOT NULL,
    complementary_count_2km integer NOT NULL,
    complementary_count_5km integer NOT NULL,
    anchor_count_500m integer NOT NULL,
    anchor_count_1km integer NOT NULL,
    anchor_count_2km integer NOT NULL,
    anchor_count_5km integer NOT NULL,
    dominant_zone_class text NOT NULL,
    commercial_area_pct double precision NOT NULL,
    industrial_area_pct double precision NOT NULL,
    residential_area_pct double precision NOT NULL,
    flood_zone text NOT NULL,
    in_sfha boolean NOT NULL,
    sfha_area_pct double precision NOT NULL,
    pm25 double precision,
    aqi double precision,
    PRIMARY KEY (dataset_id, h3_index)
);

CREATE INDEX IF NOT EXISTS h3_cell_fact_geometry_gix
    ON h3_cell_fact USING gist (geometry);
CREATE INDEX IF NOT EXISTS h3_cell_fact_h3_index_idx
    ON h3_cell_fact (h3_index);

CREATE TABLE IF NOT EXISTS geo_active_dataset (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    dataset_id uuid NOT NULL REFERENCES geo_dataset(id)
);
