import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SUBSCORE_KEYS, type HeatmapCell, type Subscores, type Weights } from "./cells";
import {
  buildNarrative,
  computeGridAnalytics,
  computeWaterfall,
  rankPhrase,
} from "./score-analytics";

function subscores(overrides: Partial<Subscores> = {}): Subscores {
  const base = {} as Subscores;
  for (const key of SUBSCORE_KEYS) base[key] = 50;
  return { ...base, ...overrides };
}

function cell(index: number, overrides: Partial<Subscores> = {}): HeatmapCell {
  return { h3Index: `cell-${index}`, eligible: true, subscores: subscores(overrides) };
}

/**
 * A grid where zoning fit climbs steadily from 0 to 99 and everything else is
 * flat at 50. That makes one layer's percentile predictable while leaving the
 * other five with no spread to rank against.
 */
const GRID: HeatmapCell[] = Array.from({ length: 100 }, (_, i) =>
  cell(i, { zoning: i }),
);

const EVEN_WEIGHTS: Weights = Object.fromEntries(
  SUBSCORE_KEYS.map((key) => [key, 1]),
);

describe("computeGridAnalytics", () => {
  test("keeps each layer's distribution sorted", () => {
    const analytics = computeGridAnalytics(GRID, EVEN_WEIGHTS)!;
    const zoning = analytics.subscoreSorted.zoning;

    assert.equal(zoning.length, 100);
    assert.equal(zoning[0], 0);
    assert.equal(zoning[99], 99);
    assert.deepEqual(zoning, [...zoning].sort((a, b) => a - b));
  });

  test("means still match the flat layers", () => {
    const analytics = computeGridAnalytics(GRID, EVEN_WEIGHTS)!;
    assert.equal(analytics.subscoreMeans.flood, 50);
    assert.equal(analytics.subscoreMeans.zoning, 49.5);
  });
});

describe("rankPhrase", () => {
  test("bands the extremes and the middle", () => {
    assert.equal(rankPhrase(99), "top 10% in Austin");
    assert.equal(rankPhrase(50), "middle of the pack");
    assert.equal(rankPhrase(1), "bottom 10% in Austin");
  });
});

describe("buildNarrative", () => {
  const analytics = computeGridAnalytics(GRID, EVEN_WEIGHTS)!;

  test("names the layer that lifts the score, with its rank", () => {
    const waterfall = computeWaterfall(
      subscores({ zoning: 98 }),
      analytics.subscoreMeans,
      EVEN_WEIGHTS,
    );
    const narrative = buildNarrative(waterfall, analytics);

    assert.equal(narrative.drivers.length, 1);
    assert.equal(narrative.drivers[0].key, "zoning");
    assert.ok(narrative.drivers[0].percentile >= 90);
    assert.equal(narrative.detractors.length, 0);
    assert.equal(
      narrative.summary,
      "Lifted most by zoning fit, with nothing pulling the score down.",
    );
  });

  test("names the layer that drags it down", () => {
    const waterfall = computeWaterfall(
      subscores({ zoning: 1 }),
      analytics.subscoreMeans,
      EVEN_WEIGHTS,
    );
    const narrative = buildNarrative(waterfall, analytics);

    assert.equal(narrative.detractors.length, 1);
    assert.equal(narrative.detractors[0].key, "zoning");
    assert.equal(narrative.summary, "Held back most by zoning fit, with nothing lifting it.");
  });

  test("says so when nothing moves", () => {
    const waterfall = computeWaterfall(
      subscores(),
      analytics.subscoreMeans,
      EVEN_WEIGHTS,
    );
    const narrative = buildNarrative(waterfall, analytics);

    assert.deepEqual(narrative.drivers, []);
    assert.deepEqual(narrative.detractors, []);
    assert.match(narrative.summary, /close to the Austin average/);
  });

  test("flags a top priority only when one layer is weighted above the rest", () => {
    const weighted: Weights = { ...EVEN_WEIGHTS, zoning: 10 };
    const tilted = buildNarrative(
      computeWaterfall(subscores({ zoning: 98 }), analytics.subscoreMeans, weighted),
      analytics,
    );
    assert.equal(tilted.drivers[0].topPriority, true);

    const even = buildNarrative(
      computeWaterfall(subscores({ zoning: 98 }), analytics.subscoreMeans, EVEN_WEIGHTS),
      analytics,
    );
    assert.equal(even.drivers[0].topPriority, false);
  });

  test("lists at most three a side, largest mover first", () => {
    const spread = computeGridAnalytics(
      Array.from({ length: 100 }, (_, i) =>
        cell(i, {
          demographics: i,
          transport: i,
          poi: i,
          zoning: i,
          flood: i,
          aqi: i,
        }),
      ),
      EVEN_WEIGHTS,
    )!;
    const waterfall = computeWaterfall(
      subscores({
        demographics: 99,
        transport: 95,
        poi: 90,
        zoning: 85,
        flood: 80,
        aqi: 75,
      }),
      spread.subscoreMeans,
      EVEN_WEIGHTS,
    );
    const narrative = buildNarrative(waterfall, spread);

    assert.equal(narrative.drivers.length, 3);
    assert.equal(narrative.drivers[0].key, "demographics");
    assert.ok(narrative.drivers[0].delta >= narrative.drivers[1].delta);
    assert.ok(narrative.drivers[1].delta >= narrative.drivers[2].delta);
  });
});
