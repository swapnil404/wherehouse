import { ClientOnly } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import HeatmapLegend from "./heatmap-legend";
import LayersCard from "./layers-card";
import PresetPicker from "./preset-picker";
import ResultsDock from "./results-dock";
import CompareTray from "./compare-tray";

/**
 * The map, full bleed, with everything else floating over a corner of it.
 *
 * Controls live beside what they affect. The layers card stays visible because
 * it is the map's legend and tool shelf, while the results card owns the answer
 * and the priorities that shape it:
 *
 *   top-left      what you are looking for, and what is drawn
 *   top-right     the answer, and the priorities that shape it
 *   bottom-left   the colour key, above MapLibre's scale bar
 *   bottom-centre loading notices, zoom and tilt
 *   bottom-right  MapLibre attribution
 *
 * Nothing dodges anything: each floating element owns a corner, and the two
 * tall cards scroll inside their own bounds.
 *
 * All of them render outside the client-only boundary, so the chrome is
 * complete on first paint rather than appearing when the deck.gl chunk
 * lands.
 *
 * `lazy` keeps `maplibre-gl` and `deck.gl` out of the server bundle entirely
 * (MapLibre reaches for `window` at import time) and `ClientOnly` keeps the
 * first client render in sync with the SSR output. Every future map layer
 * (draw tools, hot-spots) belongs behind this boundary too.
 */

const MapCanvas = lazy(() => import("./map-canvas"));

function MapFallback() {
  return <div className="h-full w-full bg-background" />;
}

export default function MapView() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <ClientOnly fallback={<MapFallback />}>
        <Suspense fallback={<MapFallback />}>
          <MapCanvas />
        </Suspense>
      </ClientOnly>

      {/* After ClientOnly in the DOM so these layer above the canvas without
          needing a stacking hack. The wrapper is click-through; each control
          re-enables pointer events for itself, so the map stays draggable in
          the gaps between them. */}
      <div className="pointer-events-none absolute top-4 left-4 z-20 flex flex-col items-start gap-2">
        <PresetPicker />
        <LayersCard />
      </div>

      <HeatmapLegend />
      <ResultsDock />
      <CompareTray />
    </div>
  );
}
