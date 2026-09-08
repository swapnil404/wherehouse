import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { useMutation } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef } from "react";

import ScorePanel from "./score-panel";
import { compositeScore, type CellRecord } from "@/lib/cells";
import { BASEMAP_SURFACE_RGB, colorForScore } from "@/lib/heatmap-palette";
import { useMapStore } from "@/stores/map-store";
import { useTRPC } from "@/utils/trpc";

/**
 * MapLibre touches `window` at import time, so this module must only ever be
 * reached from the client-only boundary in `map-view.tsx`. Do not import it
 * directly from a route.
 */

const AUSTIN = { lng: -97.7431, lat: 30.2672 };

/** CARTO dark matter — free, no API key, OSM-attributed. */
const BASEMAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/**
 * TODO(geo.cells): the grid comes from a tRPC procedure that does not exist
 * yet — see `CellRecord` for the frozen payload contract. Deliberately empty
 * rather than seeded with placeholder cells: a hexagon on screen should mean a
 * real scored cell.
 */
const CELLS: CellRecord[] = [];

export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const trpc = useTRPC();
  const scorePoint = useMutation(trpc.geo.score.mutationOptions());
  const scorePointRef = useRef(scorePoint.mutate);

  const heatmap = useMapStore((s) => s.layers.heatmap);
  const weights = useMapStore((s) => s.weights);

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

    // Overlaid rather than interleaved: no dependency on the basemap's internal
    // layer ids. The tradeoff is that deck draws above the basemap's street
    // labels — revisit with `interleaved: true` plus a `beforeId` if labels need
    // to sit on top of the hexes.
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    map.addControl(overlay as unknown as maplibregl.IControl);

    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      overlayRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const layers = useMemo(() => {
    if (!heatmap.visible) return [];

    return [
      new H3HexagonLayer<CellRecord>({
        id: "score-heatmap",
        data: CELLS,
        getHexagon: (d) => d.h3Index,
        getFillColor: (d) => colorForScore(compositeScore(d.subscores, weights)),
        // Hex borders in the basemap color, so the seam between cells reads as
        // basemap showing through rather than as a drawn white grid.
        stroked: true,
        getLineColor: BASEMAP_SURFACE_RGB,
        lineWidthMinPixels: 1,
        filled: true,
        extruded: false,
        opacity: heatmap.opacity,
        pickable: true,
        updateTriggers: {
          getFillColor: [weights],
        },
      }),
    ];
  }, [heatmap.visible, heatmap.opacity, weights]);

  useEffect(() => {
    overlayRef.current?.setProps({ layers });
  }, [layers]);

  useEffect(() => {
    if (!scorePoint.data || !mapRef.current) return;

    markerRef.current ??= new maplibregl.Marker({ color: "#cde2fb" });
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

      {heatmap.visible && CELLS.length === 0 ? (
        <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
          <p className="rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
            Heatmap layer ready — no scored cells to draw yet
          </p>
        </div>
      ) : null}

      <ScorePanel
        isPending={scorePoint.isPending}
        error={scorePoint.error}
        data={scorePoint.data ?? null}
      />
    </div>
  );
}
