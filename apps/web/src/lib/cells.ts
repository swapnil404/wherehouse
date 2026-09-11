import type { AppRouter } from "@wherehouse/api/routers/index";
import type { HeatmapResponse, PresetName } from "@wherehouse/api/geo/client";
import type { inferRouterOutputs } from "@trpc/server";

/**
 * Client-side scoring over the real heatmap payload.
 *
 * The API deliberately returns **weight-independent subscores** per cell
 * (`GET /v1/heatmap`), not a composite score. That is what lets a preset
 * change or a weight edit recolor the map with no network call — the client
 * does one weighted average and nothing else; the scoring math itself stays in
 * Python.
 *
 * Types are derived from the generated OpenAPI client rather than redeclared,
 * so a schema change surfaces as a compile error here.
 */

export type { PresetName };
export type HeatmapCell = HeatmapResponse["cells"][number];
/**
 * One scored location, as the client actually receives it.
 *
 * Inferred from the tRPC router rather than from the OpenAPI schema. The two
 * disagree: the generated `ScoreResponse` marks a constraint's `actual` and
 * `required` as required-but-unknown, while what survives the tRPC boundary
 * has them optional. Deriving from the router types the value that reaches
 * this code, so the panel cannot be written against a shape it never sees.
 *
 * Carries subscores and hard-constraint results but no composite: the client
 * weights it, which is why an open panel re-scores on a slider drag without
 * a refetch.
 */
export type ScoredCell = inferRouterOutputs<AppRouter>["geo"]["score"];
export type Subscores = HeatmapCell["subscores"];
export type SubscoreKey = keyof Subscores;
export type Weights = Partial<Record<SubscoreKey, number>>;

export const SUBSCORE_KEYS = [
  "demographics",
  "transport",
  "poi",
  "zoning",
  "flood",
  "aqi",
] as const satisfies readonly SubscoreKey[];

/** Fails to compile if the API gains a subscore not listed above. */
const _assertSubscoresExhaustive: (typeof SUBSCORE_KEYS)[number] =
  null as unknown as SubscoreKey;
void _assertSubscoresExhaustive;

/**
 * What each scoring dimension is called on screen.
 *
 * Plain words rather than the pipeline's column names, but the plain word has
 * to be **true to the formula** in `apps/fastapi/scoring.py`. An earlier pass
 * traded accuracy for readability and shipped three labels that described
 * something the score does not compute:
 *
 * - "People nearby" for `demographics`, which is 40% population density but
 *   also 35% how close local median income sits to this use case's target
 *   band and 25% the same for median age. A cell can score low there while
 *   being dense, because the residents are the wrong profile, and a label
 *   promising a headcount makes that look like a bug.
 * - "Transport access" for `transport`, which is 40% road density and 60%
 *   decay on distance to the nearest highway. **There is no transit term at
 *   all.** Anyone siting retail around a rail stop would have read the label
 *   and trusted a number that never considered it.
 * - "Distance from mapped flood hazard areas" for `flood`, which is
 *   categorical, not continuous: 0 inside the SFHA, 100 in zone X, 55
 *   otherwise. Nothing is measured in metres.
 *
 * Labels stay phrased so that **more is better**, matching a higher-is-better
 * composite and the bars, deltas and rankings built on it. That is why flood
 * reads as safety rather than risk.
 */
export const SUBSCORE_LABELS: Record<SubscoreKey, string> = {
  demographics: "Resident fit",
  transport: "Road access",
  poi: "Nearby businesses",
  zoning: "Zoning fit",
  flood: "Flood safety",
  aqi: "Air quality",
};

/**
 * One line on what the dimension actually measures, for the priority rows.
 *
 * These are the disclosure for the compressions above: the label is short
 * enough to fit a column header, the hint is where the formula gets stated
 * honestly enough that nobody makes a siting decision on a misreading.
 */
export const SUBSCORE_HINTS: Record<SubscoreKey, string> = {
  demographics:
    "Population density, plus how closely local income and age match this use case",
  transport:
    "Road density and distance to the nearest highway. Does not include transit",
  poi: "Competitor count against an ideal, plus complements and anchors nearby",
  zoning: "Whether the dominant zoning class permits this activity",
  flood: "Flood-zone class, not distance. Zero inside the 100-year floodplain",
  aqi: "Air quality at the site, ranked against the rest of the city",
};

export const PRESET_LABELS: Record<PresetName, string> = {
  warehouse: "Warehouse",
  retail: "Retail",
  ev: "EV charging",
};

/**
 * One weighted average, and nothing else. Returns `null` when there is nothing
 * to average so callers propagate the gap rather than rendering a fabricated 0.
 */
export function compositeScore(
  subscores: Subscores | null | undefined,
  weights: Weights,
): number | null {
  if (!subscores) return null;

  let weighted = 0;
  let total = 0;
  for (const key of SUBSCORE_KEYS) {
    const weight = weights[key] ?? 0;
    weighted += weight * subscores[key];
    total += weight;
  }

  if (total === 0) return null;
  return Math.min(100, Math.max(0, weighted / total));
}
