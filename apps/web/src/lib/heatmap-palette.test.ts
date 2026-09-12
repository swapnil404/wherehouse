import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AQI_BINS,
  GRID_MEASURES,
  SCORE_BINS,
  binIndexIn,
  colorIn,
  measureMeta,
  type ScoreBin,
} from "./heatmap-palette";

function luminance(bin: ScoreBin): number {
  const [r, g, b] = bin.rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

for (const [name, bins] of [
  ["SCORE_BINS", SCORE_BINS],
  ["AQI_BINS", AQI_BINS],
] as const) {
  describe(name, () => {
    test("covers 0 to 100 with no gaps or overlaps", () => {
      assert.equal(bins[0].min, 0);
      assert.equal(bins[bins.length - 1].max, 100);
      for (let i = 1; i < bins.length; i += 1) {
        assert.equal(bins[i].min, bins[i - 1].max, `gap before band ${i}`);
      }
    });

    test("brightens as the value rises", () => {
      for (let i = 1; i < bins.length; i += 1) {
        assert.ok(
          luminance(bins[i]) > luminance(bins[i - 1]),
          `band ${i} is not brighter than ${i - 1}`,
        );
      }
    });

    test("hex and rgb agree", () => {
      for (const bin of bins) {
        const hex = `#${bin.rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
        assert.equal(hex, bin.hex);
      }
    });
  });
}

describe("AQI_BINS", () => {
  test("cuts the range evenly, because the subscore is a percentile rank", () => {
    // `100 * (1 - aqi_percentile)` is uniform across the grid by construction,
    // so unequal sextiles like the score ramp's would distort it.
    const widths = AQI_BINS.map((bin) => bin.max - bin.min);
    assert.ok(Math.max(...widths) - Math.min(...widths) <= 1, `widths ${widths}`);
  });

  test("is a different hue family from the score ramp", () => {
    // The two measures are mutually exclusive, so the ramp is the only cue
    // telling a returning reader which one the map was left on.
    for (const bin of AQI_BINS) {
      assert.ok(bin.rgb[2] > bin.rgb[0], `${bin.hex} is not blue-dominant`);
    }
    for (const bin of SCORE_BINS.slice(0, -1)) {
      assert.ok(bin.rgb[0] > bin.rgb[2], `${bin.hex} is not red-dominant`);
    }
  });
});

describe("binIndexIn / colorIn", () => {
  test("places a value in the band that contains it", () => {
    assert.equal(binIndexIn(0, AQI_BINS), 0);
    assert.equal(binIndexIn(100, AQI_BINS), AQI_BINS.length - 1);
    assert.equal(binIndexIn(40, AQI_BINS), 2);
    assert.equal(binIndexIn(40, SCORE_BINS), 3);
  });

  test("paints nothing when there is no value", () => {
    assert.deepEqual(colorIn(null, SCORE_BINS), [0, 0, 0, 0]);
    assert.deepEqual(colorIn(Number.NaN, AQI_BINS), [0, 0, 0, 0]);
    assert.equal(binIndexIn(undefined, SCORE_BINS), -1);
  });

  test("clamps rather than falling off either end", () => {
    assert.equal(binIndexIn(-20, SCORE_BINS), 0);
    assert.equal(binIndexIn(140, SCORE_BINS), SCORE_BINS.length - 1);
  });

  test("returns the band's own colour and alpha", () => {
    const bin = AQI_BINS[4];
    assert.deepEqual(colorIn(70, AQI_BINS), [...bin.rgb, bin.alpha]);
  });
});

describe("measureMeta", () => {
  test("air quality carries the ranking caveat and the score does not", () => {
    assert.equal(measureMeta("score").note, undefined);
    assert.match(measureMeta("aqi").note!, /Ranked against the rest of Austin/);
  });

  test("every measure is reachable from the picker list", () => {
    for (const option of GRID_MEASURES) {
      assert.equal(measureMeta(option.id).id, option.id);
    }
  });
});
