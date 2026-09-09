import { create } from "zustand";

import type { PresetName, SubscoreKey, Weights } from "@/lib/cells";
import type { GridAnalytics } from "@/lib/score-analytics";
import {
  PMTILES_BASE_URL,
  TILE_LAYERS,
  type LegendEntry,
  type TileLayerId,
} from "@/lib/tile-layers";

export type LayerId = "heatmap" | TileLayerId;

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
  { id: "heatmap", label: "Score heatmap", available: true },
  ...TILE_LAYERS.map((layer): LayerMeta => ({
    id: layer.id,
    label: layer.label,
    available: PMTILES_BASE_URL !== null,
    hint: PMTILES_BASE_URL === null ? TILES_UNAVAILABLE_HINT : layer.hint,
    legend: layer.legend,
  })),
] as const;

/**
 * Every tile overlay starts hidden. They draw *above* the hexes, so switching
 * one on by default would mean the product's own layer opens partly covered.
 * Their opacities come from the specs rather than being restated here.
 */
const INITIAL_LAYERS: Record<LayerId, LayerState> = {
  heatmap: { visible: true, opacity: 0.8 },
  ...(Object.fromEntries(
    TILE_LAYERS.map((layer) => [
      layer.id,
      { visible: false, opacity: layer.defaultOpacity },
    ]),
  ) as Record<TileLayerId, LayerState>),
};

export interface HeatmapStats {
  /** Cells per score band, same order as `SCORE_BINS`. */
  counts: number[];
  total: number;
  eligible: number;
  datasetId: string;
  h3Resolution: number;
  /** Grid means and score distribution, for the waterfall and percentile grade. */
  analytics: GridAnalytics | null;
}

interface MapStore {
  layers: Record<LayerId, LayerState>;
  preset: PresetName;
  /**
   * Published by the map canvas, which owns the single heatmap query, and read
   * by the rail. Kept in the store rather than fetched twice so the rail can
   * render server-side without issuing an authenticated query of its own.
   */
  heatmapStats: HeatmapStats | null;
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
  toggleLayer: (id: LayerId) => void;
  setLayerOpacity: (id: LayerId, opacity: number) => void;
  setPreset: (preset: PresetName) => void;
  setEligibleOnly: (eligibleOnly: boolean) => void;
  setHeatmapStats: (stats: HeatmapStats | null) => void;
  setPresets: (presets: Partial<Record<PresetName, Weights>>) => void;
  /** `base` seeds the override on first edit, from the preset's own weights. */
  setWeight: (key: SubscoreKey, value: number, base: Weights) => void;
  resetWeights: () => void;
}

export const useMapStore = create<MapStore>((set) => ({
  layers: INITIAL_LAYERS,
  preset: "warehouse",
  eligibleOnly: false,
  heatmapStats: null,
  presets: null,
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
  setPreset: (preset) => set({ preset, customWeights: null }),
  setEligibleOnly: (eligibleOnly) => set({ eligibleOnly }),
  setWeight: (key, value, base) =>
    set((state) => ({
      customWeights: { ...(state.customWeights ?? base), [key]: value },
    })),
  resetWeights: () => set({ customWeights: null }),
  setHeatmapStats: (heatmapStats) => set({ heatmapStats }),
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
