import { create } from "zustand";

import type { Weights } from "@/lib/cells";

export type LayerId = "heatmap" | "poi" | "zoning" | "flood";

export interface LayerState {
  visible: boolean;
  opacity: number;
}

export interface LayerMeta {
  id: LayerId;
  label: string;
  /**
   * Layers whose source data has not been ingested or tiled yet. They render
   * as disabled rows rather than being hidden, so the shell shows the real
   * shape of the product.
   */
  available: boolean;
  hint?: string;
}

/** Rail order. Heatmap first — it is the layer the product is about. */
export const LAYER_META: readonly LayerMeta[] = [
  { id: "heatmap", label: "Score heatmap", available: true },
  { id: "poi", label: "Points of interest", available: false, hint: "Awaiting POI layer" },
  { id: "zoning", label: "Zoning", available: false, hint: "Awaiting vector tiles" },
  { id: "flood", label: "Flood zones", available: false, hint: "Awaiting vector tiles" },
] as const;

/**
 * Placeholder weights. These are the shipped warehouse preset's values, used
 * only so the composite-score path has something to run against — the weight
 * editor that owns them is not built yet, and presets come from the API.
 */
export const PLACEHOLDER_WEIGHTS: Weights = {
  demographics: 0.06,
  transport: 0.28,
  poi: 0.22,
  zoning: 0.36,
  flood: 0.06,
  aqi: 0.02,
};

interface MapStore {
  layers: Record<LayerId, LayerState>;
  weights: Weights;
  toggleLayer: (id: LayerId) => void;
  setLayerOpacity: (id: LayerId, opacity: number) => void;
}

export const useMapStore = create<MapStore>((set) => ({
  layers: {
    heatmap: { visible: true, opacity: 0.8 },
    poi: { visible: false, opacity: 0.9 },
    zoning: { visible: false, opacity: 0.5 },
    flood: { visible: false, opacity: 0.6 },
  },
  weights: PLACEHOLDER_WEIGHTS,
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
}));
