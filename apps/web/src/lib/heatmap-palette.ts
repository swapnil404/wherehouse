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

export type Rgba = [number, number, number, number];

const TRANSPARENT: Rgba = [0, 0, 0, 0];

/** Index of the bin a score falls in, or `-1` when there is no score. */
export function binIndexForScore(score: number | null | undefined): number {
  if (score == null || Number.isNaN(score)) return -1;
  const clamped = Math.min(100, Math.max(0, score));
  const found = SCORE_BINS.findIndex((b) => clamped >= b.min && clamped < b.max);
  return found === -1 ? SCORE_BINS.length - 1 : found;
}

/**
 * Fill color for a composite score. A `null` score means "no data" and paints
 * nothing — the absence is shown by the map's empty state, not by guessing a
 * color.
 */
export function colorForScore(score: number | null | undefined): Rgba {
  const index = binIndexForScore(score);
  if (index === -1) return TRANSPARENT;

  const bin = SCORE_BINS[index];
  return [bin.rgb[0], bin.rgb[1], bin.rgb[2], bin.alpha];
}
