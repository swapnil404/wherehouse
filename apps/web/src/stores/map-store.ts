import { create } from "zustand";

import type { PresetName, ScoredCell, SubscoreKey, Weights } from "@/lib/cells";
import { toggleComparedSite } from "@/lib/compare";
import type { HotspotMethod } from "@/lib/hotspots";
import type { GridMeasure } from "@/lib/heatmap-palette";
import type { GridAnalytics } from "@/lib/score-analytics";
import type { DrawMode, StudyArea } from "@/lib/study-area";
import {
  PMTILES_BASE_URL,
  TILE_LAYERS,
  type LegendEntry,
  type TileLayerId,
} from "@/lib/tile-layers";

/**
 * Server-computed analytics. Separate from the tile layers because they are
 * fetched per preset and per parameter rather than served as a static
 * archive, and they draw above everything else.
 */
export type AnalysisLayerId = "hotspots" | "underserved";

export type LayerId = "heatmap" | AnalysisLayerId | TileLayerId;

export interface LayerState {
  visible: boolean;
  opacity: number;
}

export interface LayerMeta {
  id: LayerId;
  label: string;
  /**
   * Layers whose source data has not been tiled yet, or whose tile bucket is
   * not configured in this deployment. They render as disabled rows rather
   * than being hidden, so the shell shows the real shape of the product.
   */
  available: boolean;
  hint?: string;
  /**
   * Rendered as swatches under the row. Present on every layer that paints
   * more than one color, so a category is never identified by color alone.
   */
  legend?: readonly LegendEntry[];
}

const TILES_UNAVAILABLE_HINT = "Set VITE_PMTILES_BASE_URL to enable";

/**
 * Rail order. Heatmap first — it is the layer the product is about — then the
 * tile overlays in the order they stack on the map, so the list reads top-down
 * the way the map reads bottom-up.
 */
export const LAYER_META: readonly LayerMeta[] = [
  // Just "Heatmap": the row is a checkbox for whether the hexes are painted
  // at all, and the picker nested under it says what they are painted by. A
  // label naming one of the two measures would contradict the other.
  { id: "heatmap", label: "Heatmap", available: true },
  ...TILE_LAYERS.map((layer): LayerMeta => ({
    id: layer.id,
    label: layer.label,
    available: PMTILES_BASE_URL !== null,
    hint: PMTILES_BASE_URL === null ? TILES_UNAVAILABLE_HINT : layer.hint,
    legend: layer.legend,
  })),
] as const;

/**
 * Rendered in their own rail section rather than mixed into the tile list:
 * they answer a different question, and the section gives the method picker
 * and its parameters somewhere to live next to the toggle they affect.
 */
export const ANALYSIS_META: readonly { id: AnalysisLayerId; label: string; hint: string }[] = [
  {
    id: "hotspots",
    label: "Strong areas",
    hint: "Where good sites bunch together instead of standing alone",
  },
  {
    id: "underserved",
    label: "Gaps in the market",
    hint: "Plenty of people, few businesses already serving them",
  },
] as const;

/**
 * Defaults mirror the tRPC input defaults, so an untouched panel sends
 * exactly what the router would have filled in anyway.
 */
export interface HotspotParams {
  method: HotspotMethod;
  /** Gi* neighbourhood radius in H3 rings. */
  k: number;
  /** DBSCAN: minimum composite score for a cell to be a candidate. */
  threshold: number;
  /** DBSCAN: neighbourhood radius in kilometres. */
  epsKm: number;
  /** DBSCAN: minimum candidates before a cluster is admitted. */
  minSamples: number;
}

const INITIAL_HOTSPOT_PARAMS: HotspotParams = {
  method: "gi_star",
  k: 2,
  // Deliberately *not* the API's default of 70. The composite tops out at
  // 69.5 on the active warehouse dataset (p95 = 56.2, p99 = 65.6), so 70
  // matches zero cells and DBSCAN returns 1,021 noise and no clusters — the
  // layer would open looking broken. 55 sits around p95 and yields 4
  // clusters over 41 cells. The panel captions the slider with the live
  // distribution so this stays honest if the data or weights move.
  threshold: 55,
  epsKm: 1.5,
  minSamples: 4,
};

/** Published by the canvas so the rail can label the legend with real counts. */
export interface HotspotStats {
  /** Painted-class tallies, keyed by the API's `classification` value. */
  counts: Record<string, number>;
  /** DBSCAN only; zero for the other methods. */
  clusters: number;
  underserved: number;
}

/**
 * Every overlay starts hidden. They draw *above* the hexes, so switching one
 * on by default would mean the product's own layer opens partly covered.
 * Tile opacities come from the specs rather than being restated here.
 */
const INITIAL_LAYERS: Record<LayerId, LayerState> = {
  heatmap: { visible: true, opacity: 0.8 },
  hotspots: { visible: false, opacity: 0.9 },
  underserved: { visible: false, opacity: 0.9 },
  ...(Object.fromEntries(
    TILE_LAYERS.map((layer) => [
      layer.id,
      { visible: false, opacity: layer.defaultOpacity },
    ]),
  ) as Record<TileLayerId, LayerState>),
};

export interface HeatmapStats {
  /** Cells per band, in the order of the active measure's own bins. */
  counts: number[];
  total: number;
  eligible: number;
  datasetId: string;
  h3Resolution: number;
  /** Grid means and score distribution, for the waterfall and percentile grade. */
  analytics: GridAnalytics | null;
}

/**
 * One row of the shortlist.
 *
 * Published by the canvas rather than fetched: the heatmap payload already
 * carries every cell's subscores, so ranking is a sort over data the client
 * holds. That is the same property that lets the weight sliders recolour the
 * map with no request, and it means the shortlist reorders live while a
 * slider is dragged instead of waiting on a round trip.
 */
export interface RankedCell {
  h3Index: string;
  score: number;
  eligible: boolean;
}

/**
 * The clicked cell, as the canvas's score mutation sees it.
 *
 * The composite score is deliberately absent. `/v1/score` returns subscores
 * and the client weights them, so a slider drag updates the open panel
 * without refetching, exactly as it updates the map.
 */
export interface SelectionState {
  isPending: boolean;
  error: { message: string } | null;
  cell: ScoredCell | null;
}

export type ReachabilityMode = "car" | "foot";

interface MapStore {
  layers: Record<LayerId, LayerState>;
  preset: PresetName;
  /**
   * Published by the map canvas, which owns the single heatmap query, and read
   * by the rail. Kept in the store rather than fetched twice so the rail can
   * render server-side without issuing an authenticated query of its own.
   */
  heatmapStats: HeatmapStats | null;
  /** Painted-class tallies for the analysis legends. `null` until fetched. */
  hotspotStats: HotspotStats | null;
  /**
   * Whether `/v1/hotspots` is in flight or has failed.
   *
   * Published separately from `hotspotStats` because a null `hotspotStats`
   * is ambiguous: it means "not fetched yet", "fetching" and "the request
   * failed" all at once. The panel used to render every one of those as a
   * dash next to each class, so a failed call was indistinguishable from a
   * layer that had simply found nothing, and the map drew an empty overlay
   * with no explanation.
   */
  hotspotStatus: { pending: boolean; error: string | null };
  hotspotParams: HotspotParams;
  /**
   * The `/v1/presets` payload from the *running* sidecar — both the list of
   * use cases and their weights. Not hardcoded: the deployed sidecar can lag
   * the repo (it served only warehouse and retail while `ev` already existed
   * in the code), and a hardcoded list turns that lag into a button that 422s.
   *
   * `null` while loading, which the rail renders as the single current preset
   * rather than an empty picker.
   */
  presets: Partial<Record<PresetName, Weights>> | null;
  /**
   * Off by default on purpose. Only ~1% of cells clear every hard constraint
   * under warehouse and ev (16% under retail), so filtering by default would
   * blank the map. It reads better as an explicit "show me the shortlist".
   */
  eligibleOnly: boolean;
  /**
   * Weight overrides from the sliders. `null` means "use the preset's weights
   * exactly as the API defines them", which is not the same as a copy of them
   * — it keeps the panel able to say the preset is unmodified, and switching
   * preset clears it rather than carrying edits across use cases.
   */
  customWeights: Weights | null;
  /**
   * Top of the grid under the live weights, best first. `null` until the
   * canvas has scored a grid.
   */
  rankedCells: RankedCell[] | null;
  /** The clicked cell. `null` before the first click of a session. */
  selection: SelectionState | null;
  /**
   * A cell the results dock has asked the map to visit.
   *
   * A command rather than a callback: the dock renders during SSR as a
   * sibling of the map, while the map itself is lazy and client-only, so at
   * the moment a row is clicked there may be no map function to call. Parking
   * the request as state lets the canvas pick it up whenever it is ready, and
   * keeps the store free of function references.
   */
  pendingFocusH3: string | null;
  /**
   * Where the open cell came from.
   *
   * The dock jumps to the detail tab for a map click, because a click on the
   * map is a question about that cell and nothing else is showing the
   * answer. It deliberately does not jump for a shortlist click: the reader
   * is walking a list, and swapping the list out from under them on the
   * first row would make the second row cost two clicks.
   */
  selectionOrigin: "map" | "list" | null;
  /** Raw score responses kept for live, weight-adjusted side-by-side comparison. */
  comparisonSites: ScoredCell[];
  /**
   * Whether the reach bands are drawn and their numbers fetched.
   *
   * Off by default, following the same rule as every other overlay: the bands
   * paint *above* the score hexes, so leaving them on meant every click
   * covered the product's own layer with a red wash the reader had no way to
   * dismiss. It also stops a catchment query firing on every cell selection
   * for the many sessions that never ask about travel time.
   *
   * Sticky across selections on purpose. Someone comparing two sites on
   * catchment should not have to switch it back on for the second one.
   */
  catchmentOn: boolean;
  /** Shared by the score controls and the map's precomputed reach overlay. */
  catchmentMode: ReachabilityMode;
  catchmentMinutes: number;
  /**
   * Which drawing tool has the map's clicks, or `null` for none.
   *
   * While this is set the canvas stops scoring clicks and collects vertices
   * instead. It is store state rather than canvas state because the control
   * that arms it lives in the Layers card, on the other side of the map's
   * client-only boundary.
   */
  /**
   * What the hexes are coloured by.
   *
   * Air quality is the sixth data layer and the only one with no geometry of
   * its own to tile — it is a per-cell fact, so it paints on the same hexes
   * the score does. Making it a mode rather than an overlay is what keeps the
   * map from ever stacking two full-coverage washes.
   *
   * Deliberately not reset by `setPreset`: air quality does not vary by use
   * case, so switching from warehouse to retail while reading it would snap
   * the map back to a measure the reader did not ask for.
   */
  gridMeasure: GridMeasure;
  drawMode: DrawMode | null;
  /**
   * The finished shape, or `null` for the whole city.
   *
   * Narrows the heatmap and the shortlist together, exactly as `eligibleOnly`
   * does, because both answer "which cells am I asking about". It deliberately
   * does *not* gate click scoring: `/v1/score` works anywhere in the coverage
   * area, and refusing to score a point the reader just clicked would be a
   * restriction the drawing never promised.
   */
  studyArea: StudyArea | null;
  toggleLayer: (id: LayerId) => void;
  setLayerOpacity: (id: LayerId, opacity: number) => void;
  setPreset: (preset: PresetName) => void;
  setEligibleOnly: (eligibleOnly: boolean) => void;
  setHeatmapStats: (stats: HeatmapStats | null) => void;
  setHotspotStats: (stats: HotspotStats | null) => void;
  setHotspotStatus: (status: { pending: boolean; error: string | null }) => void;
  setHotspotParams: (params: Partial<HotspotParams>) => void;
  setPresets: (presets: Partial<Record<PresetName, Weights>>) => void;
  /** `base` seeds the override on first edit, from the preset's own weights. */
  setWeight: (key: SubscoreKey, value: number, base: Weights) => void;
  resetWeights: () => void;
  setRankedCells: (cells: RankedCell[] | null) => void;
  setSelectionOrigin: (origin: "map" | "list" | null) => void;
  setSelection: (selection: SelectionState | null) => void;
  toggleComparisonSite: (cell: ScoredCell) => void;
  removeComparisonSite: (h3Index: string) => void;
  clearComparisonSites: () => void;
  setCatchmentOn: (on: boolean) => void;
  setCatchmentMode: (mode: ReachabilityMode) => void;
  setCatchmentMinutes: (minutes: number) => void;
  setGridMeasure: (measure: GridMeasure) => void;
  setDrawMode: (mode: DrawMode | null) => void;
  /** Commits a finished shape, or clears the area with `null`. */
  setStudyArea: (area: StudyArea | null) => void;
  /** Called by the dock. Consumed and cleared by the canvas. */
  focusCell: (h3Index: string) => void;
  clearPendingFocus: () => void;
}

export const useMapStore = create<MapStore>((set) => ({
  layers: INITIAL_LAYERS,
  preset: "warehouse",
  eligibleOnly: false,
  heatmapStats: null,
  hotspotStats: null,
  hotspotStatus: { pending: false, error: null },
  hotspotParams: INITIAL_HOTSPOT_PARAMS,
  presets: null,
  rankedCells: null,
  selection: null,
  pendingFocusH3: null,
  selectionOrigin: null,
  comparisonSites: [],
  catchmentOn: false,
  catchmentMode: "car",
  catchmentMinutes: 20,
  gridMeasure: "score",
  drawMode: null,
  studyArea: null,
  toggleLayer: (id) =>
    set((state) => ({
      layers: {
        ...state.layers,
        [id]: { ...state.layers[id], visible: !state.layers[id].visible },
      },
    })),
  setLayerOpacity: (id, opacity) =>
    set((state) => ({
      layers: {
        ...state.layers,
        [id]: { ...state.layers[id], opacity },
      },
    })),
  customWeights: null,
  // Switching use case discards weight edits: carrying a warehouse-tuned
  // zoning weight into retail would silently misrepresent the retail preset.
  setPreset: (preset) =>
    set({
      preset,
      customWeights: null,
      hotspotStats: null,
      // Both describe the outgoing preset. Subscores and hard constraints are
      // preset-specific, so keeping them would caption the new use case with
      // the previous one's answer until the refetch lands.
      rankedCells: null,
      selection: null,
      selectionOrigin: null,
      comparisonSites: [],
    }),
  setEligibleOnly: (eligibleOnly) => set({ eligibleOnly }),
  setWeight: (key, value, base) =>
    set((state) => ({
      customWeights: { ...(state.customWeights ?? base), [key]: value },
    })),
  resetWeights: () => set({ customWeights: null }),
  setRankedCells: (rankedCells) => set({ rankedCells }),
  setSelection: (selection) => set({ selection }),
  toggleComparisonSite: (cell) =>
    set((state) => ({
      comparisonSites: toggleComparedSite(state.comparisonSites, cell),
    })),
  removeComparisonSite: (h3Index) =>
    set((state) => ({
      comparisonSites: state.comparisonSites.filter(
        (site) => site.h3_index !== h3Index,
      ),
    })),
  clearComparisonSites: () => set({ comparisonSites: [] }),
  setCatchmentOn: (catchmentOn) => set({ catchmentOn }),
  setCatchmentMode: (catchmentMode) =>
    set({ catchmentMode, catchmentMinutes: 20 }),
  setCatchmentMinutes: (catchmentMinutes) => set({ catchmentMinutes }),
  // Does *not* clear `heatmapStats`, unlike the preset and hotspot setters.
  // That object carries the grid analytics the score panel's waterfall and
  // percentile grade are built from, and none of that depends on which ramp
  // the hexes use. Dropping it would blank an open breakdown to recolor a
  // legend. The canvas recomputes the band counts on the next render instead.
  setGridMeasure: (gridMeasure) => set({ gridMeasure }),
  // Arming a tool drops the previous shape rather than leaving it on screen
  // to be replaced: two boundaries on the map, one of which is about to be
  // discarded, cannot be told apart while the second is half drawn.
  setDrawMode: (drawMode) => set({ drawMode, studyArea: null }),
  // Disarms the tool in the same update that commits the shape, so the canvas
  // cannot land a finished area and still be collecting vertices for it.
  setStudyArea: (studyArea) => set({ studyArea, drawMode: null }),
  focusCell: (pendingFocusH3) => set({ pendingFocusH3, selectionOrigin: "list" }),
  setSelectionOrigin: (selectionOrigin) => set({ selectionOrigin }),
  clearPendingFocus: () => set({ pendingFocusH3: null }),
  setHeatmapStats: (heatmapStats) => set({ heatmapStats }),
  setHotspotStats: (hotspotStats) => set({ hotspotStats }),
  setHotspotStatus: (hotspotStatus) => set({ hotspotStatus }),
  // Stats are dropped on every parameter change: they describe the response
  // that is now stale, and leaving them up would caption the new legend with
  // the old counts while the refetch is in flight.
  setHotspotParams: (params) =>
    set((state) => ({
      hotspotParams: { ...state.hotspotParams, ...params },
      hotspotStats: null,
    })),
  setPresets: (presets) =>
    set((state) => {
      const served = Object.keys(presets) as PresetName[];
      // If the sidecar does not serve the selected preset, fall back rather
      // than leaving the map wedged on a preset that 422s.
      const stranded = served.length > 0 && !served.includes(state.preset);
      return {
        presets,
        preset: stranded ? served[0] : state.preset,
        customWeights: stranded ? null : state.customWeights,
      };
    }),
}));
