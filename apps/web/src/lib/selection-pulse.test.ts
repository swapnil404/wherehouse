import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cellToBoundary, cellToLatLng, latLngToCell } from "h3-js";

import { FOCUS_LINE, FOCUS_RGB } from "./focus-mark";
import {
  PULSE_PERIOD_MS,
  RING_COLOR,
  RING_WIDTH,
  expandedHexRing,
  pulseFrame,
} from "./selection-pulse";

const CELL = latLngToCell(30.2672, -97.7431, 8);

describe("pulseFrame", () => {
  test("starts at the cell's own size and full strength", () => {
    const frame = pulseFrame(0);
    assert.equal(frame.scale, 1);
    assert.ok(frame.alpha > 200, `alpha ${frame.alpha}`);
  });

  test("travels outward and fades across a period", () => {
    const steps = [0, 0.25, 0.5, 0.75].map((f) => pulseFrame(f * PULSE_PERIOD_MS));
    for (let i = 1; i < steps.length; i += 1) {
      assert.ok(steps[i].scale > steps[i - 1].scale, "ring should expand");
      assert.ok(steps[i].alpha < steps[i - 1].alpha, "ring should fade");
    }
  });

  test("loops forever instead of expiring", () => {
    // The beacon runs for as long as Reach is on, so an elapsed time an hour
    // in has to produce the same ring as the first frame rather than a ring
    // scaled off the edge of the map or an alpha stuck at zero.
    for (const period of [0, 1, 7, 300, 3000]) {
      const frame = pulseFrame(period * PULSE_PERIOD_MS);
      assert.equal(frame.scale, 1, `period ${period} should restart at the cell`);
      assert.ok(frame.alpha > 200, `period ${period} alpha ${frame.alpha}`);
    }
  });

  test("hands the ring off just before the next one starts", () => {
    // A frame at the very end of a period must have faded out, or each new
    // ring would appear to be born from a visible one.
    const last = pulseFrame(PULSE_PERIOD_MS - 16);
    assert.ok(last.alpha < 5, `alpha ${last.alpha}`);
  });

  test("folds a backwards clock back into range", () => {
    const frame = pulseFrame(-0.25 * PULSE_PERIOD_MS);
    assert.ok(frame.scale >= 1, `scale ${frame.scale}`);
    assert.ok(frame.alpha >= 0 && frame.alpha <= 255, `alpha ${frame.alpha}`);
  });

  test("never scales the ring below the cell it marks", () => {
    for (let i = 0; i <= 200; i += 1) {
      const frame = pulseFrame((i / 100) * PULSE_PERIOD_MS);
      assert.ok(frame.scale >= 1);
      assert.ok(frame.alpha >= 0 && frame.alpha <= 255);
    }
  });

  test("the travelling ring carries the focus colour at its own alpha", () => {
    // The ring and the beacon have to be the same mark in two forms. Reading
    // the colour off the frame rather than rebuilding it at the call site is
    // what stops the beacon being left behind on a future palette change.
    const frame = pulseFrame(0.3 * PULSE_PERIOD_MS);
    assert.deepEqual(frame.color.slice(0, 3), FOCUS_RGB);
    assert.equal(frame.color[3], frame.alpha);
    assert.deepEqual(RING_COLOR, FOCUS_LINE);
  });

  test("the resting ring is a constant the beacon never touches", () => {
    // The selection ring holds still and the beacon supplies all the motion,
    // which is what keeps the thousand-cell layers out of the per-frame path.
    assert.equal(RING_WIDTH, 3);
  });
});

describe("expandedHexRing", () => {
  const [lat, lng] = cellToLatLng(CELL);

  test("is the cell's own outline at scale 1", () => {
    const ring = expandedHexRing(CELL, 1);
    const boundary = cellToBoundary(CELL, true);

    assert.equal(ring.length, boundary.length);
    for (let i = 0; i < ring.length; i += 1) {
      assert.ok(Math.abs(ring[i][0] - boundary[i][0]) < 1e-9);
      assert.ok(Math.abs(ring[i][1] - boundary[i][1]) < 1e-9);
    }
  });

  test("pushes every vertex out from the centre by the scale", () => {
    const at1 = expandedHexRing(CELL, 1);
    const at2 = expandedHexRing(CELL, 2);

    for (let i = 0; i < at1.length; i += 1) {
      const near = Math.hypot(at1[i][0] - lng, at1[i][1] - lat);
      const far = Math.hypot(at2[i][0] - lng, at2[i][1] - lat);
      assert.ok(Math.abs(far / near - 2) < 1e-6, `vertex ${i} ratio ${far / near}`);
    }
  });

  test("keeps the cell centre inside every ring it draws", () => {
    // Deliberately not asserting that the vertex mean sits on the centre: an
    // H3 cell is not a regular hexagon in lat/lng, so its vertices average to
    // a point a little off `cellToLatLng`, and scaling about the centre moves
    // that average outward in proportion. The centre being *enclosed* is the
    // property the beacon actually depends on.
    for (const scale of [1, 1.25, 1.75]) {
      const ring = expandedHexRing(CELL, scale);
      const lngs = ring.map((p) => p[0]);
      const lats = ring.map((p) => p[1]);

      assert.ok(Math.min(...lngs) < lng && lng < Math.max(...lngs), `scale ${scale}`);
      assert.ok(Math.min(...lats) < lat && lat < Math.max(...lats), `scale ${scale}`);
    }
  });

  test("each ring encloses the one before it", () => {
    const span = (scale: number) => {
      const lngs = expandedHexRing(CELL, scale).map((p) => p[0]);
      return Math.max(...lngs) - Math.min(...lngs);
    };

    assert.ok(span(1.75) > span(1.25));
    assert.ok(span(1.25) > span(1));
  });
});
