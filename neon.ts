import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  preview: {
    buckets: {
      "wherehouse-map-data": {
        access: "public_read",
      },
    },
  },
});
