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
 * There is no settings column any more. There was a 256px rail down the left
 * edge holding nothing but configuration, which spent a fifth of the window
 * permanently on controls and made a wall of them the first thing on screen
 * in a product whose subject is the map behind them. Trimming it helped
 * twice and it was still a settings column.
 *
 * So the controls went to what they affect rather than into a drawer of
 * their own:
 *
 *   top-left      what you are looking for, and what is drawn
 *   top-right     the answer, and the priorities that shape it
 *   bottom-left   the colour key, above MapLibre's scale bar
 *   bottom-centre loading and empty-state notices
 *   bottom-right  MapLibre's navigation control and attribution
 *
 * Nothing dodges anything: each floating element owns a corner, and the two
 * that can grow (layers, results) open downward into space no other element
 * claims.
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
