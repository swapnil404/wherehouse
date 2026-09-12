import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { latLngToCell } from "h3-js";

import {
  DOUBLE_CLICK_SLOP_PX,
  cellsInStudyArea,
  circleRing,
  distanceMeters,
  studyAreaContains,
  withoutTrailingDuplicate,
  type Position,
} from "./study-area";

const AUSTIN: Position = [-97.7431, 30.2672];

/** A square roughly 0.02° on a side, centred on downtown Austin. */
const SQUARE: Position[] = [
  [-97.753, 30.257],
  [-97.733, 30.257],
  [-97.733, 30.277],
  [-97.753, 30.277],
];

describe("distanceMeters", () => {
  test("measures a known separation", () => {
    // One degree of latitude is ~111.2 km anywhere on the sphere.
    const meters = distanceMeters([-97.7431, 30], [-97.7431, 31]);
    assert.ok(Math.abs(meters - 111_195) < 500, `got ${meters}`);
  });

  test("is zero for a point against itself", () => {
    assert.equal(distanceMeters(AUSTIN, AUSTIN), 0);
  });
});

describe("studyAreaContains", () => {
  test("accepts a point inside the ring and rejects one outside", () => {
    const area = { kind: "polygon", ring: SQUARE } as const;
    assert.equal(studyAreaContains(area, AUSTIN), true);
    assert.equal(studyAreaContains(area, [-97.8, 30.2672]), false);
  });

  test("treats the radius as a great-circle distance, not a bounding box", () => {
    const area = { kind: "radius", center: AUSTIN, radiusMeters: 1000 } as const;
    // Due north, just inside and just outside a 1 km radius.
    assert.equal(studyAreaContains(area, [-97.7431, 30.2672 + 0.008]), true);
    assert.equal(studyAreaContains(area, [-97.7431, 30.2672 + 0.010]), false);
  });
});

describe("circleRing", () => {
  test("every vertex sits on the radius", () => {
    for (const vertex of circleRing(AUSTIN, 2000)) {
      const off = Math.abs(distanceMeters(AUSTIN, vertex) - 2000);
      assert.ok(off < 5, `vertex off by ${off} m`);
    }
  });

  test("is wider in longitude than latitude at Austin's latitude", () => {
    const ring = circleRing(AUSTIN, 2000);
    const lngSpan = Math.max(...ring.map((p) => p[0])) - Math.min(...ring.map((p) => p[0]));
    const latSpan = Math.max(...ring.map((p) => p[1])) - Math.min(...ring.map((p) => p[1]));
    // cos(30.27°) ≈ 0.863, so the longitude span is ~1/0.863 of the latitude
    // span. Without the cosine term the two would be equal and the drawn
    // circle would not match the cells the radius test selects.
    assert.ok(lngSpan / latSpan > 1.13, `ratio ${lngSpan / latSpan}`);
  });
});

describe("cellsInStudyArea", () => {
  const near = { h3Index: latLngToCell(30.2672, -97.7431, 8) };
  const far = { h3Index: latLngToCell(30.45, -97.95, 8) };

  test("passes every cell through when there is no area", () => {
    const cells = [near, far];
    assert.equal(cellsInStudyArea(cells, null), cells);
  });

  test("keeps only the cells whose centroid falls inside", () => {
    const kept = cellsInStudyArea([near, far], {
      kind: "radius",
      center: AUSTIN,
      radiusMeters: 3000,
    });
    assert.deepEqual(kept, [near]);
  });
});

describe("withoutTrailingDuplicate", () => {
  const ring: Position[] = [
    [-97.75, 30.25],
    [-97.74, 30.25],
    [-97.74, 30.26],
    [-97.7399, 30.2599],
  ];

  /**
   * A stand-in for `map.project` at a given scale. The last two corners of
   * `ring` are about 14 m apart on the ground, which is a repeated click when
   * zoomed out and two deliberate corners when zoomed right in — the whole
   * reason this test takes a projection instead of a distance.
   */
  const projectAt = (metersPerPixel: number) => (position: Position) => ({
    x: (position[0] * 111_320 * Math.cos(30.25 * (Math.PI / 180))) / metersPerPixel,
    y: (position[1] * 111_320) / metersPerPixel,
  });

  test("drops a corner that lands within the double-click slop", () => {
    // 65 m per pixel is roughly zoom 11, where 14 m is a fifth of a pixel.
    assert.equal(withoutTrailingDuplicate(ring, projectAt(65)).length, 3);
  });

  test("keeps the same corner once it is pixels apart", () => {
    // 0.5 m per pixel is roughly zoom 18, where the same 14 m is 28 pixels.
    assert.equal(withoutTrailingDuplicate(ring, projectAt(0.5)).length, 4);
  });

  test("leaves a ring too short to have a duplicate alone", () => {
    assert.equal(withoutTrailingDuplicate([ring[0]], projectAt(65)).length, 1);
  });

  test("the slop is a handful of pixels, not a fraction of one", () => {
    // Below about 4 px it stops catching a real double-click; far above it
    // starts swallowing corners placed deliberately close together.
    assert.ok(DOUBLE_CLICK_SLOP_PX >= 4 && DOUBLE_CLICK_SLOP_PX <= 16);
  });
});
