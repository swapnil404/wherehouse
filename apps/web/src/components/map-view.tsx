import { ClientOnly } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

/**
 * Client-only boundary for the map tree.
 *
 * `lazy` keeps `maplibre-gl` out of the server bundle entirely — it reaches for
 * `window` at import time — and `ClientOnly` keeps the first client render in
 * sync with the SSR output. Every future map layer (deck.gl overlays, draw
 * tools) belongs behind this boundary too.
 */

const MapCanvas = lazy(() => import("./map-canvas"));

function MapFallback() {
  return <div className="h-full w-full bg-neutral-950" />;
}

export default function MapView() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <ClientOnly fallback={<MapFallback />}>
        <Suspense fallback={<MapFallback />}>
          <MapCanvas />
        </Suspense>
      </ClientOnly>
    </div>
  );
}
