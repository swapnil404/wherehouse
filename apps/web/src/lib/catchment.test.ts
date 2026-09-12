import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { gridDisk, latLngToCell } from "h3-js";

import {
  CATCHMENT_LINE_COLOR,
  CATCHMENT_LINE_WIDTH,
  buildCatchmentRegions,
} from "./catchment";
import { FOCUS_LINE } from "./focus-mark";
import { RING_COLOR } from "./selection-pulse";

const CENTRE = latLngToCell(30.2672, -97.7431, 8);
const NEAR = gridDisk(CENTRE, 1); // 7 cells
const WIDE = gridDisk(CENTRE, 2); // 19 cells, containing NEAR

const CUMULATIVE = [
  { minutes: 10, destinationH3Indexes: NEAR },
  { minutes: 20, destinationH3Indexes: WIDE },
];

describe("buildCatchmentRegions", () => {
  test("draws only the selected band", () => {
    // The whole point of the change: picking 20 minutes replaces the
    // 10-minute outline rather than adding a second ring around it.
    const regions = buildCatchmentRegions(CUMULATIVE, 20);
    assert.deepEqual(
      regions.map((region) => region.minutes),
      [20],
    );

    const nearer = buildCatchmentRegions(CUMULATIVE, 10);
    assert.deepEqual(
      nearer.map((region) => region.minutes),
      [10],
    );
  });

  test("the wider band encloses more ground than the nearer one", () => {
    const span = (minutes: number) => {
      const ring = buildCatchmentRegions(CUMULATIVE, minutes)[0].rings[0];
      const lngs = ring.map((point) => point[0]);
      return Math.max(...lngs) - Math.min(...lngs);
    };

    assert.ok(span(20) > span(10), "20 minutes should reach further than 10");
  });

  test("draws a closed ring", () => {
    const region = buildCatchmentRegions(CUMULATIVE, 20)[0];
    assert.ok(region.rings.length >= 1);
    assert.ok(region.rings[0].length >= 3, "outer ring needs at least 3 points");
  });

  test("unions the nearer bands rather than trusting the payload", () => {
    // The same area described with *exclusive* rings: the 20-minute band
    // carries only the cells that band added. Dissolved on its own that is a
    // donut, with a spurious inner edge where the 10-minute band ended.
    const exclusive = [
      { minutes: 10, destinationH3Indexes: NEAR },
      { minutes: 20, destinationH3Indexes: WIDE.filter((cell) => !NEAR.includes(cell)) },
    ];

    const region = buildCatchmentRegions(exclusive, 20)[0];
    assert.equal(region.rings.length, 1, "solid region, not a donut");
  });

  test("draws nothing rather than a different time when the band is missing", () => {
    // A foot payload has no 30-minute band. Falling back to the widest
    // available one would outline 20 minutes while the panel reported 30.
    assert.deepEqual(buildCatchmentRegions(CUMULATIVE, 30), []);
  });

  test("returns nothing when reach is off or nothing is reachable", () => {
    assert.deepEqual(buildCatchmentRegions([], 20), []);
    assert.deepEqual(buildCatchmentRegions([{ minutes: 10, destinationH3Indexes: [] }], 10), []);
  });
});

describe("contour styling", () => {
  test("matches the selected-cell ring, whatever the focus colour is", () => {
    // Asserted against the shared constant rather than a literal, so this
    // keeps testing that the marks agree instead of re-testing a hex code.
    // It is the property that broke when the compare tray claimed white.
    assert.deepEqual(CATCHMENT_LINE_COLOR, FOCUS_LINE);
    assert.deepEqual(CATCHMENT_LINE_COLOR, RING_COLOR);
  });

  test("is fully opaque", () => {
    assert.equal(CATCHMENT_LINE_COLOR[3], 255);
  });

  test("is one weight for every band", () => {
    // No ramp: the old per-band fade only separated nested contours, and with
    // a single outline it would mean a wider question got a fainter answer.
    assert.ok(CATCHMENT_LINE_WIDTH > 0);
  });
});
