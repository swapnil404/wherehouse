CREATE TABLE IF NOT EXISTS cell_reach (
    dataset_id uuid NOT NULL,
    source_h3_index text NOT NULL,
    mode text NOT NULL CHECK (mode IN ('car', 'foot')),
    band_minutes smallint NOT NULL CHECK (band_minutes > 0),
    destination_h3_indexes text[] NOT NULL,
    destination_count integer NOT NULL CHECK (destination_count >= 0),
    catchment_population bigint NOT NULL CHECK (catchment_population >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (dataset_id, source_h3_index, mode, band_minutes),
    FOREIGN KEY (dataset_id, source_h3_index)
        REFERENCES h3_cell_fact(dataset_id, h3_index) ON DELETE CASCADE,
    CHECK (destination_count = cardinality(destination_h3_indexes)),
    CHECK (
        (mode = 'car' AND band_minutes IN (10, 20, 30)) OR
        (mode = 'foot' AND band_minutes IN (10, 20))
    )
);
