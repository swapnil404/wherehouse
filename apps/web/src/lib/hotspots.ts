import { cellsToMultiPolygon } from "h3-js";

/**
 * Spatial-analysis overlays: Gi* / DBSCAN / binning clusters, and the
 * underserved view.
 *
 * These are *derived* from the same composite the heatmap paints, so they are
 * drawn as findings on top of it rather than as a competing choropleth. The
 * heatmap answers "what does this cell score"; these answer "is that score
 * part of a real cluster", which is a different question and deserves a
 * different visual channel.
 */

export type HotspotMethod = "gi_star" | "dbscan" | "binning";

/** One classified cell as returned by `POST /v1/hotspots`. */
export interface HotspotCell {
  h3Index: string;
  score: number;
  classification: string;
  zScore?: number | null;
  pValue?: number | null;
  confidence?: number | null;
  clusterId?: number | null;
}

export interface UnderservedCell {
  h3Index: string;
  demand: number;
  supply: number;
  scope: "general_poi";
}

/**
 * Form carries the distinction, not hue — and that was forced by measurement,
 * not preference.
 *
 * By the time this layer was added the map already spent eight categorical
 * colors across zoning, flood and POI plus a six-step blue score ramp, and the
 * warm half of the space was gone: a conventional Gi* red measures ΔE 4.9 from
 * zoning-industrial, 5.3 from flood-SFHA and 6.4 from POI-competitor, all far
 * under the 15 floor. So hotspots render as dissolved *outlines* — a form no
 * other layer uses — which frees hot and cold to keep the red/blue convention
 * every GIS reader expects. They only have to separate from each other and
 * from underserved, and they do: worst pair ΔE 24.2 normal, 9.8 CVD.
 *
 * `underserved` was picked by sweeping OKLCH hue space against every color
 * already on the map. Purple-magenta was the only region left; this step
 * clears all twelve (worst ΔE 18.8 normal vs zoning-commercial, 8.8 CVD vs
 * the mid score band).
 */
export const HOTSPOT_COLORS = {
  hot: "#e8453c",
  cold: "#3f8fe0",
  underserved: "#a52bb4",
} as const;

const HOT_RGB: [number, number, number] = [232, 69, 60];
const COLD_RGB: [number, number, number] = [63, 143, 224];
const UNDERSERVED_RGB: [number, number, number] = [165, 43, 180];

/**
 * Fills are a tint that groups an outline into an area without competing with
 * the score colors underneath — the stroke carries the finding, the fill only
 * says "this is one region". Underserved cells sit a little stronger because
 * they are individual hexes rather than a dissolved area, so there is no
 * outline doing the work for them.
 */
const REGION_FILL_ALPHA = 38;
// Brighter than the cluster tint. Underserved cells are the finding itself
// rather than a boundary around one, so they have to hold their own against
// the score wash underneath instead of deferring to it.
const UNDERSERVED_FILL_ALPHA = 125;

export const HOT_LINE: [number, number, number, number] = [...HOT_RGB, 255];
export const COLD_LINE: [number, number, number, number] = [...COLD_RGB, 255];
export const HOT_FILL: [number, number, number, number] = [...HOT_RGB, REGION_FILL_ALPHA];
export const COLD_FILL: [number, number, number, number] = [...COLD_RGB, REGION_FILL_ALPHA];
export const UNDERSERVED_LINE: [number, number, number, number] = [...UNDERSERVED_RGB, 255];
export const UNDERSERVED_FILL: [number, number, number, number] = [
  ...UNDERSERVED_RGB,
  UNDERSERVED_FILL_ALPHA,
];

export type Tone = "hot" | "cold";

export interface MethodMeta {
  id: HotspotMethod;
  label: string;
  /** What the method actually computes, shown under the picker. */
  blurb: string;
  /**
   * Which `classification` values get outlined, and in which tone. Anything
   * unlisted is left unpainted: an unremarkable cell is not a finding, and
   * painting it would bury the ones that are.
   */
  painted: { classification: string; tone: Tone; label: string }[];
}

export const HOTSPOT_METHODS: readonly MethodMeta[] = [
  {
    id: "gi_star",
    // Getis-Ord Gi*. Named for what it tells you rather than for the
    // statistician: the method name and its z-thresholds meant nothing to
    // anyone choosing a site, and reading "|z| >= 1.96" off a control panel
    // is the clearest sign a tool was built for its author.
    label: "Proven",
    blurb: "Groups unlikely to be coincidence. The strictest test.",
    painted: [
      { classification: "hot", tone: "hot", label: "Strong area" },
      { classification: "cold", tone: "cold", label: "Weak area" },
    ],
  },
  {
    id: "dbscan",
    // DBSCAN.
    label: "Dense",
    blurb: "Tight pockets of high scorers, ignoring isolated one-offs.",
    painted: [{ classification: "cluster", tone: "hot", label: "Candidate area" }],
  },
  {
    id: "binning",
    label: "Simple",
    blurb: "Best and worst quarter of the grid. No statistics involved.",
    painted: [
      { classification: "hot", tone: "hot", label: "Best quarter" },
      { classification: "cold", tone: "cold", label: "Worst quarter" },
    ],
  },
] as const;

export function methodMeta(method: HotspotMethod): MethodMeta {
  // Non-null: `HotspotMethod` is exactly the union of the ids above.
  return HOTSPOT_METHODS.find((m) => m.id === method)!;
}

/** A dissolved cluster boundary. `rings[0]` is the outer ring; the rest are holes. */
export interface HotspotRegion {
  tone: Tone;
  rings: [number, number][][];
}

/**
 * Collapse classified cells into cluster outlines.
 *
 * Dissolving matters: stroking each hexagon separately would draw a honeycomb
 * of internal seams and read as a grid, not as one cluster. `cellsToMultiPolygon`
 * returns one entry per disconnected piece, so two separate hot areas stay two
 * outlines rather than being merged into a misleading single region.
 */
export function buildRegions(
  cells: readonly HotspotCell[],
  method: HotspotMethod,
): HotspotRegion[] {
  const regions: HotspotRegion[] = [];

  for (const { classification, tone } of methodMeta(method).painted) {
    const members = cells
      .filter((cell) => cell.classification === classification)
      .map((cell) => cell.h3Index);
    if (members.length === 0) continue;

    // `true` asks for GeoJSON winding and [lng, lat] order, which is the
    // order deck.gl's PolygonLayer expects.
    for (const polygon of cellsToMultiPolygon(members, true)) {
      regions.push({ tone, rings: polygon as [number, number][][] });
    }
  }

  return regions;
}

/** Painted-class tallies for the rail, keyed by `classification`. */
export function countByClassification(
  cells: readonly HotspotCell[],
  method: HotspotMethod,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { classification } of methodMeta(method).painted) counts[classification] = 0;
  for (const cell of cells) {
    if (cell.classification in counts) counts[cell.classification] += 1;
  }
  return counts;
}
