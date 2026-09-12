/**
 * Score heatmap ramp.
 *
 * Nothing-inspired red-to-white ramp, inverted for the dark basemap:
 * luminance tracks magnitude, so bright = high score and the low end recedes
 * toward the basemap. Fixed bin edges still carry the data semantics; only
 * the visual encoding changes.
 */

/** A low-alpha seam that keeps individual H3 cells readable. */
export const HEX_SEAM_RGBA: [number, number, number, number] = [14, 14, 14, 70];

export interface ScoreBin {
  /** Inclusive lower edge. */
  min: number;
  /** Exclusive upper edge, except the top bin which includes 100. */
  max: number;
  hex: string;
  rgb: [number, number, number];
  /**
   * Per-bin alpha. The lowest bin is deliberately dimmer so weak areas recede
   * toward the basemap. The layer's own opacity multiplies this, so the
   * opacity slider still scales the whole ramp.
   */
  alpha: number;
}

/**
 * Bin edges are **fixed and absolute** — never quantile. Quantile bins
 * re-normalize per preset, which would make every preset produce a
 * structurally identical map and erase the retail/warehouse inversion.
 *
 * The interior edges are the sextiles of the *pooled* score distribution
 * across all three presets on the active dataset (3,063 scores over 1,021
 * cells), computed once and frozen here. Pooling is what keeps them
 * preset-independent while still matching where the scores actually live:
 * real scores span roughly 16-92 and cluster in the 29-54 band, so
 * equal-interval edges over 0-100 left three of six bands empty and put 48%
 * of the warehouse map in a single color.
 *
 * Measured share per band on the active dataset:
 *
 *   warehouse   27%  26%  19%  14%   7%   6%
 *   retail       8%  13%  15%  19%  20%  25%
 *   ev          10%  15%  14%  18%  26%  17%
 *
 * Every band carries real mass under every preset, and the warehouse/retail
 * inversion is visible in the ramp itself rather than only in cell positions.
 *
 * Re-derive these if the pipeline emits a new dataset or the preset weights
 * change materially; they are a property of the data, not a style choice.
 */
export const SCORE_BINS: readonly ScoreBin[] = [
  { min: 0, max: 29, hex: "#260609", rgb: [38, 6, 9], alpha: 125 },
  { min: 29, max: 34, hex: "#5c0b11", rgb: [92, 11, 17], alpha: 255 },
  { min: 34, max: 39, hex: "#97131b", rgb: [151, 19, 27], alpha: 255 },
  { min: 39, max: 46, hex: "#e51b23", rgb: [229, 27, 35], alpha: 255 },
  { min: 46, max: 54, hex: "#ff666c", rgb: [255, 102, 108], alpha: 255 },
  { min: 54, max: 100, hex: "#f4f4f0", rgb: [244, 244, 240], alpha: 255 },
] as const;

/**
 * Air-quality ramp, for the other thing the hexes can show.
 *
 * A different hue family on purpose. The two measures are mutually exclusive,
 * so only one is ever painted — but a reader who glances at the map after
 * leaving it on a tab for a minute has to be able to tell which one they left
 * it on, and a legend in the far corner is not that cue. Blue is the one hue
 * absent from every full-coverage fill on this map (zoning holds orange,
 * violet, green and grey), and it carries the atmospheric reading for free.
 *
 * **Equal bands, unlike `SCORE_BINS`, and that is not an oversight.** The
 * subscore is `100 * (1 - aqi_percentile)` — a rank against the rest of the
 * city, so the grid is uniform across 0-100 by construction and each sixth
 * holds about a sixth of the cells. The score ramp needs unequal sextiles
 * precisely because real composites are *not* uniform; this one would be
 * distorted by them.
 *
 * Luminance still tracks magnitude, matching the score ramp's logic: the
 * cleanest air is brightest and the worst recedes toward the basemap.
 */
export const AQI_BINS: readonly ScoreBin[] = [
  { min: 0, max: 17, hex: "#151a3a", rgb: [21, 26, 58], alpha: 125 },
  { min: 17, max: 33, hex: "#26307a", rgb: [38, 48, 122], alpha: 255 },
  { min: 33, max: 50, hex: "#3a4fb8", rgb: [58, 79, 184], alpha: 255 },
  { min: 50, max: 67, hex: "#5d7ee0", rgb: [93, 126, 224], alpha: 255 },
  { min: 67, max: 83, hex: "#92b3f2", rgb: [146, 179, 242], alpha: 255 },
  { min: 83, max: 100, hex: "#d6e6fb", rgb: [214, 230, 251], alpha: 255 },
] as const;

export type Rgba = [number, number, number, number];

const TRANSPARENT: Rgba = [0, 0, 0, 0];

/** Index of the bin a value falls in, or `-1` when there is no value. */
export function binIndexIn(
  value: number | null | undefined,
  bins: readonly ScoreBin[],
): number {
  if (value == null || Number.isNaN(value)) return -1;
  const clamped = Math.min(100, Math.max(0, value));
  const found = bins.findIndex((b) => clamped >= b.min && clamped < b.max);
  return found === -1 ? bins.length - 1 : found;
}

/**
 * Fill color for a value on one of the ramps. A `null` value means "no data"
 * and paints nothing — the absence is shown by the map's empty state, not by
 * guessing a color.
 */
export function colorIn(
  value: number | null | undefined,
  bins: readonly ScoreBin[],
): Rgba {
  const index = binIndexIn(value, bins);
  if (index === -1) return TRANSPARENT;

  const bin = bins[index];
  return [bin.rgb[0], bin.rgb[1], bin.rgb[2], bin.alpha];
}

/**
 * What the hexes encode.
 *
 * A mode rather than a second layer. Both are full-coverage choropleths over
 * the same 1,021 cells, so switching one on *over* the other would stack two
 * opaque washes and neither would be readable — the reader would have to fade
 * one out by hand every time. Everything else in the layer panel is a genuine
 * overlay that composites cleanly; these two are alternatives, and the control
 * says so.
 *
 * Both come from the one `/v1/heatmap` payload the client already holds, so
 * switching between them is a recolor with no request, exactly like a weight
 * edit.
 */
export type GridMeasure = "score" | "aqi";

export interface GridMeasureMeta {
  id: GridMeasure;
  /** Names the measure, not the encoding — this is what the colors mean. */
  label: string;
  bins: readonly ScoreBin[];
  /**
   * Caveat shown under the legend.
   *
   * Only air quality carries one, and it is not optional: the subscore is a
   * rank within Austin, so a cell at 90 has cleaner air than 90% of the city
   * and that is all it says. Printed without this, a reader who knows what AQI
   * numbers normally mean would read 90 as a hazardous reading — the opposite
   * of what the color shows.
   */
  note?: string;
}

export const GRID_MEASURES: readonly GridMeasureMeta[] = [
  { id: "score", label: "Site score", bins: SCORE_BINS },
  {
    id: "aqi",
    label: "Air quality",
    bins: AQI_BINS,
    note: "Ranked against the rest of Austin, not an AQI reading. Brighter is cleaner.",
  },
] as const;

export function measureMeta(id: GridMeasure): GridMeasureMeta {
  return GRID_MEASURES.find((measure) => measure.id === id) ?? GRID_MEASURES[0];
}
