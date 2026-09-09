import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    /**
     * Public base URL of the Neon Object Storage bucket holding the display
     * PMTiles archives, with no trailing slash.
     *
     * Optional on purpose. The score heatmap comes from the API, not from
     * tiles, so a deployment without this configured still renders the product
     * — the overlay rows just show as unavailable instead of the map failing
     * to boot.
     */
    VITE_PMTILES_BASE_URL: z.url().optional(),
  },
  runtimeEnv: (import.meta as any).env,
  emptyStringAsUndefined: true,
});
