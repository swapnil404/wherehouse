import { env } from "@wherehouse/env/server";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export function createDb() {
  const client = postgres(env.HYPERDRIVE.connectionString, { max: 1 });

  return drizzle({ client, schema });
}
