import { useMutation } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";

import { useTRPC } from "@/utils/trpc";

/**
 * MapLibre touches `window` at import time, so this module must only ever be
 * reached from the client-only boundary in `map-view.tsx`. Do not import it
 * directly from a route.
 */

const AUSTIN = { lng: -97.7431, lat: 30.2672 };

/** CARTO dark matter — free, no API key, OSM-attributed. */
const BASEMAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const trpc = useTRPC();
  const scorePoint = useMutation(trpc.geo.score.mutationOptions());
  const scorePointRef = useRef(scorePoint.mutate);

  scorePointRef.current = scorePoint.mutate;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [AUSTIN.lng, AUSTIN.lat],
      zoom: 11,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.getCanvas().style.cursor = "crosshair";
    map.on("click", ({ lngLat }) => {
      scorePointRef.current({
        point: { lat: lngLat.lat, lon: lngLat.lng },
      });
    });

    mapRef.current = map;

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!scorePoint.data || !mapRef.current) return;

    markerRef.current ??= new maplibregl.Marker({ color: "#22c55e" });
    markerRef.current
      .setLngLat([scorePoint.data.lon, scorePoint.data.lat])
      .addTo(mapRef.current);
  }, [scorePoint.data]);

  // Sized with h-full/w-full rather than `absolute inset-0`: MapLibre adds
  // `.maplibregl-map` to this element, and that rule sets `position: relative`.
  // It is unlayered CSS, so it outranks Tailwind's layered `.absolute` no
  // matter the import order — the container would collapse to zero height.
  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      <aside className="absolute top-4 right-16 w-80 max-w-[calc(100%-5rem)] rounded-lg border border-white/10 bg-neutral-950/90 p-4 text-neutral-100 shadow-xl backdrop-blur">
        {scorePoint.isPending ? (
          <p className="text-sm text-neutral-300">Scoring this location…</p>
        ) : scorePoint.error ? (
          <div>
            <p className="font-medium text-red-300">Location unavailable</p>
            <p className="mt-1 text-sm text-neutral-300">{scorePoint.error.message}</p>
          </div>
        ) : scorePoint.data ? (
          <div>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs tracking-wide text-neutral-400 uppercase">Site score</p>
                <p className="text-3xl font-semibold">{scorePoint.data.score}</p>
              </div>
              <span className={scorePoint.data.eligible
                ? "rounded-full bg-green-500/15 px-2 py-1 text-xs text-green-300"
                : "rounded-full bg-amber-500/15 px-2 py-1 text-xs text-amber-300"}
              >
                {scorePoint.data.eligible ? "Eligible" : "Constraints failed"}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              {Object.entries(scorePoint.data.subscores).map(([name, score]) => (
                <div key={name} className="rounded bg-white/5 px-2 py-1.5">
                  <span className="capitalize text-neutral-400">{name}</span>
                  <span className="float-right font-medium">{score}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-2">
              {scorePoint.data.constraints.map((constraint) => (
                <div key={constraint.id} className="flex gap-2 text-xs">
                  <span className={constraint.pass ? "text-green-400" : "text-red-400"}>
                    {constraint.pass ? "Pass" : "Fail"}
                  </span>
                  <span className="text-neutral-300">{constraint.label}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-neutral-300">Click anywhere in Austin to score that location.</p>
        )}
      </aside>
    </div>
  );
}
