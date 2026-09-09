import { ClientOnly } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import HeatmapLegend from "./heatmap-legend";
import LayerPanel from "./layer-panel";
import PresetPicker from "./preset-picker";

/**
 * Hybrid shell: the layer rail is docked on the left because its controls are
 * always relevant, while the score panel floats over the map (inside
 * `map-canvas`) since it has nothing to say until a cell is picked — docking it
 * would reserve dead space.
 *
 * `LayerPanel` sits outside the client-only boundary on purpose: it is plain
 * React with no `window` access, so it renders during SSR and the rail is
 * present on first paint.
 *
 * `lazy` keeps `maplibre-gl` and `deck.gl` out of the server bundle entirely —
 * MapLibre reaches for `window` at import time — and `ClientOnly` keeps the
 * first client render in sync with the SSR output. Every future map layer
 * (draw tools, hot-spots) belongs behind this boundary too.
 */

const MapCanvas = lazy(() => import("./map-canvas"));

function MapFallback() {
  return <div className="h-full w-full bg-background" />;
}

export default function MapView() {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <LayerPanel />

      <div className="relative min-w-0 flex-1">
        <ClientOnly fallback={<MapFallback />}>
          <Suspense fallback={<MapFallback />}>
            <MapCanvas />
          </Suspense>
        </ClientOnly>

        {/* Outside the client-only boundary: it is store-driven React with no
            `window` access, so it renders on first paint and stays put while
            the map chunk loads. After ClientOnly in the DOM so it layers
            above the canvas without needing a stacking hack. */}
        <PresetPicker />
        <HeatmapLegend />
      </div>
    </div>
  );
}
