import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

config({ path: "../../apps/web/.env", quiet: true });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const migrationPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../pipeline/sql/0001_enable_postgis.sql",
);
const migration = await readFile(migrationPath, "utf8");
const client = postgres(databaseUrl, { max: 1 });

try {
  await client.unsafe(migration);

  const [extension] = await client<
    { extname: string; extversion: string }[]
  >`SELECT extname, extversion FROM pg_extension WHERE extname = 'postgis'`;

  if (!extension) {
    throw new Error("PostGIS installation did not complete");
  }

  const [spatialCheck] = await client<{ point: string }[]>`
    SELECT ST_AsText(
      ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326)
    ) AS point
  `;

  if (spatialCheck?.point !== "POINT(-97.7431 30.2672)") {
    throw new Error("PostGIS spatial function check failed");
  }

  console.log(`PostGIS ${extension.extversion} is installed and working`);
} finally {
  await client.end();
}
