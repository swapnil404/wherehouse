/**
 * The grid payload contract the heatmap reads.
 *
 * This is the shape the future `geo.cells` procedure has to return — frozen
 * here so the layer, the legend and the panels can be built before the
 * endpoint exists. Nothing in the UI should widen it.
 *
 * Three deliberate choices:
 *
 * - **No geometry.** `h3-js` reconstructs the hexagon boundary from
 *   `h3Index` client-side, so polygons never cross the wire.
 * - **Subscores, not a composite score.** Weight sliders recompute
 *   `Σ(w·s)/Σw` locally with no network call; that only works if the client
 *   holds every per-cell subscore. Sending one blended number would put a
 *   round trip behind every slider drag.
 * - **`null` means "not available yet"**, never zero. A missing subscore has
 *   to be distinguishable from a real subscore of 0.
 */

export const SUBSCORE_KEYS = [
  "demographics",
  "transport",
  "poi",
  "zoning",
  "flood",
  "aqi",
] as const;

export type SubscoreKey = (typeof SUBSCORE_KEYS)[number];

export type Subscores = Record<SubscoreKey, number>;

export type Weights = Record<SubscoreKey, number>;

export interface CellRecord {
  h3Index: string;
  /** `null` until the scoring engine reads the ingested grid. */
  subscores: Subscores | null;
  /** `null` until the constraint evaluation is wired. */
  eligible: boolean | null;
}

/** Human-readable labels for the six scoring layers. */
export const SUBSCORE_LABELS: Record<SubscoreKey, string> = {
  demographics: "Demographics",
  transport: "Transport",
  poi: "Points of interest",
  zoning: "Zoning",
  flood: "Flood risk",
  aqi: "Air quality",
};

/**
 * One weighted average, and nothing else — the scoring math itself stays in
 * Python. Returns `null` when subscores are absent so callers propagate the
 * gap instead of rendering a fabricated 0.
 */
export function compositeScore(
  subscores: Subscores | null,
  weights: Weights,
): number | null {
  if (!subscores) return null;

  let weighted = 0;
  let total = 0;
  for (const key of SUBSCORE_KEYS) {
    const w = weights[key] ?? 0;
    weighted += w * subscores[key];
    total += w;
  }

  if (total === 0) return null;
  return Math.min(100, Math.max(0, weighted / total));
}
