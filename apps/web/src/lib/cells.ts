import type { HeatmapResponse, PresetName } from "@wherehouse/api/geo/client";

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

export const SUBSCORE_LABELS: Record<SubscoreKey, string> = {
  demographics: "Demographics",
  transport: "Transport",
  poi: "Points of interest",
  zoning: "Zoning",
  flood: "Flood risk",
  aqi: "Air quality",
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
