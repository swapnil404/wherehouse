import { env } from "@wherehouse/env/server";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export function createDb() {
  const client = postgres(env.HYPERDRIVE.connectionString, { max: 1 });

  return drizzle({ client, schema });
}

export type ReachabilityMode = "car" | "foot";

export interface CatchmentBand {
  minutes: number;
  destinationH3Indexes: string[];
  destinationCount: number;
  catchmentPopulation: number;
}

export interface Catchment {
  datasetId: string;
  h3Resolution: number;
  sourceH3Index: string;
  mode: ReachabilityMode;
  bands: CatchmentBand[];
}

interface CatchmentRow extends Record<string, unknown> {
  dataset_id: string;
  h3_resolution: number;
  source_h3_index: string;
  mode: ReachabilityMode;
  band_minutes: number;
  destination_h3_indexes: string[];
  destination_count: number;
  catchment_population: string;
}

/** Read a precomputed catchment from the currently active geo dataset. */
export async function getActiveCatchment(
  sourceH3Index: string,
  mode: ReachabilityMode,
): Promise<Catchment | null> {
  const rows = await createDb().execute<CatchmentRow>(sql`
    SELECT
      reach.dataset_id::text AS dataset_id,
      dataset.h3_resolution,
      reach.source_h3_index,
      reach.mode,
      reach.band_minutes,
      reach.destination_h3_indexes,
      reach.destination_count,
      reach.catchment_population::text AS catchment_population
    FROM cell_reach AS reach
    JOIN geo_active_dataset AS active
      ON active.dataset_id = reach.dataset_id
      AND active.singleton = true
    JOIN geo_dataset AS dataset
      ON dataset.id = active.dataset_id
      AND dataset.status = 'active'
    WHERE reach.source_h3_index = ${sourceH3Index}
      AND reach.mode = ${mode}
    ORDER BY reach.band_minutes
  `);

  const first = rows[0];
  if (!first) {
    return null;
  }

  return {
    datasetId: first.dataset_id,
    h3Resolution: first.h3_resolution,
    sourceH3Index: first.source_h3_index,
    mode: first.mode,
    bands: rows.map((row) => ({
      minutes: row.band_minutes,
      destinationH3Indexes: row.destination_h3_indexes,
      destinationCount: row.destination_count,
      catchmentPopulation: Number(row.catchment_population),
    })),
  };
}
