/**
 * Score heatmap ramp.
 *
 * Single-hue blue, **inverted for the dark basemap**: luminance tracks
 * magnitude, so bright = high score and the low end recedes toward the
 * basemap instead of shouting. Every step is a documented ramp value,
 * validated against the CARTO dark-matter surface (`#0e0e0e`) for monotone
 * lightness and adjacent step separation.
 *
 * Bins are **fixed and absolute**, never quantile. Quantile bins re-normalize
 * per preset, which would make every preset produce a structurally identical
 * map and erase the retail/warehouse inversion.
 */

/** CARTO dark-matter background. Hex borders use this so the basemap shows through. */
export const BASEMAP_SURFACE = "#0e0e0e";
export const BASEMAP_SURFACE_RGB: [number, number, number] = [14, 14, 14];

export interface ScoreBin {
  /** Inclusive lower edge. */
  min: number;
  /** Exclusive upper edge, except the top bin which includes 100. */
  max: number;
  hex: string;
  rgb: [number, number, number];
  /**
   * Per-bin alpha. The lowest bin is deliberately dimmer so dead zones read as
   * empty basemap rather than dark blue paint. The layer's own opacity
   * multiplies this, so the slider still scales the whole ramp.
   */
  alpha: number;
}

/**
 * TODO(bin-edges): provisional equal-interval edges over 0-100. The real
 * distribution is unknown until the scoring engine reads the ingested grid, and
 * the edges have to stay stable across all three presets, so freeze them only
 * once more than one preset exists.
 */
export const SCORE_BINS: readonly ScoreBin[] = [
  { min: 0, max: 17, hex: "#0d366b", rgb: [13, 54, 107], alpha: 110 },
  { min: 17, max: 33, hex: "#184f95", rgb: [24, 79, 149], alpha: 255 },
  { min: 33, max: 50, hex: "#256abf", rgb: [37, 106, 191], alpha: 255 },
  { min: 50, max: 67, hex: "#3987e5", rgb: [57, 135, 229], alpha: 255 },
  { min: 67, max: 83, hex: "#86b6ef", rgb: [134, 182, 239], alpha: 255 },
  { min: 83, max: 100, hex: "#cde2fb", rgb: [205, 226, 251], alpha: 255 },
] as const;

export type Rgba = [number, number, number, number];

const TRANSPARENT: Rgba = [0, 0, 0, 0];

/**
 * Fill color for a composite score. A `null` score means "no data yet" and
 * paints nothing — the absence is shown by the map's empty state, not by
 * guessing a color.
 */
export function colorForScore(score: number | null | undefined): Rgba {
  if (score == null || Number.isNaN(score)) return TRANSPARENT;

  const clamped = Math.min(100, Math.max(0, score));
  const bin =
    SCORE_BINS.find((b) => clamped >= b.min && clamped < b.max) ??
    SCORE_BINS[SCORE_BINS.length - 1];

  return [bin.rgb[0], bin.rgb[1], bin.rgb[2], bin.alpha];
}
