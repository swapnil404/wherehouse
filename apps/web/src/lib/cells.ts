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
 * Named for what they mean to someone choosing a site, not for the columns
 * they come from. "Demographics" and "POI" are the pipeline's words; nobody
 * picking a warehouse location thinks in them.
 *
 * Every label is phrased so that **more is better**, because the composite
 * is a higher-is-better score and the bars, deltas and rankings all read
 * that way. That is why flood is "Flood safety" rather than the
 * "Flood risk" it used to say: a cell scoring 90 there is a *safe* one, and
 * the old label announced the opposite of what the number meant.
 */
export const SUBSCORE_LABELS: Record<SubscoreKey, string> = {
  demographics: "People nearby",
  transport: "Transport access",
  poi: "Nearby businesses",
  zoning: "Zoning fit",
  flood: "Flood safety",
  aqi: "Air quality",
};

/** One line on what the dimension actually measures, for the priority rows. */
export const SUBSCORE_HINTS: Record<SubscoreKey, string> = {
  demographics: "Residents and daytime population in reach",
  transport: "Road, highway and transit connections",
  poi: "Competitors, complements and anchors around the site",
  zoning: "How well permitted land use matches this activity",
  flood: "Distance from mapped flood hazard areas",
  aqi: "Measured air quality at the site",
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
