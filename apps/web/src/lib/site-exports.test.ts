import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { latLngToCell } from "h3-js";

import { buildSitesGeoJson, createSitesPdf, type ExportSite } from "./site-exports";

const site: ExportSite = {
  h3_index: latLngToCell(30.2672, -97.7431, 8),
  lat: 30.2672,
  lon: -97.7431,
  eligible: false,
  subscores: {
    demographics: 80,
    transport: 60,
    poi: 40,
    zoning: 100,
    flood: 20,
    aqi: 70,
  },
  constraints: [
    { id: "flood", label: "Outside floodplain", actual: "inside", required: "outside", pass: false },
  ],
};

describe("buildSitesGeoJson", () => {
  test("exports closed H3 polygons with live scores and metadata", () => {
    const result = buildSitesGeoJson({
      sites: [site],
      preset: "retail",
      weights: { demographics: 1, transport: 1 },
    });
    const feature = result.features[0];
    const ring = feature.geometry.coordinates[0];

    assert.equal(result.type, "FeatureCollection");
    assert.equal(feature.id, site.h3_index);
    assert.equal(feature.geometry.type, "Polygon");
    assert.deepEqual(ring[0], ring.at(-1));
    assert.equal(feature.properties.score, 70);
    assert.equal(feature.properties.preset, "retail");
    assert.deepEqual(feature.properties.failed_rules, ["Outside floodplain"]);
    assert.equal((feature.properties as Record<string, unknown>).subscore_zoning, 100);
  });

  test("creates one independently identified feature per site", () => {
    const second = {
      ...site,
      h3_index: latLngToCell(30.3, -97.7, 8),
      lat: 30.3,
      lon: -97.7,
      eligible: true,
      constraints: [],
    };
    const result = buildSitesGeoJson({
      sites: [site, second],
      preset: "warehouse",
      weights: { zoning: 1 },
    });

    assert.equal(result.features.length, 2);
    assert.deepEqual(result.features.map((feature) => feature.properties.site), ["Site 1", "Site 2"]);
    assert.deepEqual(result.features[1].properties.failed_rules, []);
  });

  test("includes the drawn study area and selected-cell count", () => {
    const result = buildSitesGeoJson({
      sites: [site],
      preset: "retail",
      weights: { demographics: 1 },
      scope: {
        label: "a 4-corner shape",
        cellCount: 18,
        area: {
          kind: "polygon",
          ring: [
            [-97.8, 30.2],
            [-97.7, 30.2],
            [-97.7, 30.3],
            [-97.8, 30.3],
          ],
        },
      },
    });

    assert.equal(result.study_area?.selected_cell_count, 18);
    assert.deepEqual(
      result.study_area?.geometry.coordinates[0][0],
      result.study_area?.geometry.coordinates[0].at(-1),
    );
  });
});

describe("createSitesPdf", () => {
  test("creates a valid single-site PDF report", async () => {
    const doc = await createSitesPdf({
      sites: [site],
      preset: "retail",
      weights: { demographics: 1, transport: 1 },
    });
    const bytes = new Uint8Array(doc.output("arraybuffer"));

    assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "%PDF");
    assert.equal(doc.getNumberOfPages(), 1);
    assert.ok(bytes.byteLength > 2_000);
  });
});
