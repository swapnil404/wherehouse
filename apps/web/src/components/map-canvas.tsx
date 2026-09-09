import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef } from "react";

import ScorePanel from "./score-panel";
import {
  PRESET_LABELS,
  SUBSCORE_KEYS,
  SUBSCORE_LABELS,
  compositeScore,
  type HeatmapCell,
  type PresetName,
  type Weights,
} from "@/lib/cells";
import {
  BASEMAP_SURFACE_RGB,
  SCORE_BINS,
  binIndexForScore,
  colorForScore,
} from "@/lib/heatmap-palette";
import { computeGridAnalytics } from "@/lib/score-analytics";
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

const EMPTY_CELLS: HeatmapCell[] = [];

export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  const trpc = useTRPC();
  const preset = useMapStore((s) => s.preset);
  const heatmap = useMapStore((s) => s.layers.heatmap);
  const eligibleOnly = useMapStore((s) => s.eligibleOnly);
  const setHeatmapStats = useMapStore((s) => s.setHeatmapStats);
  const setPresets = useMapStore((s) => s.setPresets);
  const customWeights = useMapStore((s) => s.customWeights);

  const scorePoint = useMutation(trpc.geo.score.mutationOptions());
  const scorePointRef = useRef(scorePoint.mutate);
  scorePointRef.current = scorePoint.mutate;

  // Weight-independent subscores: the grid is fetched once per preset and the
  // composite is computed here, so a preset switch is a recolor, not a refetch
  // of scores.
  const cellsQuery = useQuery({
    ...trpc.geo.heatmap.queryOptions({ preset }),
    staleTime: Infinity,
  });
  const presetsQuery = useQuery({
    ...trpc.geo.presets.queryOptions(),
    staleTime: Infinity,
  });

  const cells = cellsQuery.data?.cells ?? EMPTY_CELLS;
  const presetWeights = (presetsQuery.data?.[preset] ?? null) as Weights | null;

  // Slider edits win over the preset. This single value drives the fill color,
  // the tooltip, the legend counts, the waterfall and the click-score request,
  // so the map and the panel can never disagree about what weights are active.
  const weights = customWeights ?? presetWeights ?? ({} as Weights);
  const weightsReady = Object.keys(weights).length > 0;

  // Publish the preset payload for the rail. Keys are narrowed against the
  // known labels so an unrecognized preset never becomes a button the client
  // cannot render.
  useEffect(() => {
    if (!presetsQuery.data) return;
    const served: Partial<Record<PresetName, Weights>> = {};
    for (const [name, value] of Object.entries(presetsQuery.data)) {
      if (name in PRESET_LABELS) served[name as PresetName] = value as Weights;
    }
    if (Object.keys(served).length > 0) setPresets(served);
  }, [presetsQuery.data, setPresets]);

  const visibleCells = useMemo(
    () => (eligibleOnly ? cells.filter((cell) => cell.eligible) : cells),
    [cells, eligibleOnly],
  );

  const selectedH3 = scorePoint.data?.h3_index ?? null;

  // The tooltip closure is built once with the overlay, so it reads the active
  // preset's weights through a ref rather than capturing a stale value.
  const weightsRef = useRef<Weights>(weights);
  weightsRef.current = weights;

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
      const { preset: activePreset, customWeights: edits } = useMapStore.getState();
      scorePointRef.current({
        point: { lat: lngLat.lat, lon: lngLat.lng },
        preset: activePreset,
        // Send slider edits so the panel's score matches the hex the user
        // clicked. Omitted when unedited, letting the server use the preset's
        // own weights as the source of truth.
        weights: edits ?? undefined,
      });
    });

    // Overlaid rather than interleaved: no dependency on the basemap's internal
    // layer ids. The tradeoff is that deck draws above the basemap's street
    // labels — revisit with `interleaved: true` plus a `beforeId` if labels need
    // to sit on top of the hexes.
    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
      getTooltip: ({ object }) => {
        const cell = object as HeatmapCell | undefined;
        if (!cell) return null;

        const score = compositeScore(cell.subscores, weightsRef.current);
        const rows = SUBSCORE_KEYS.map(
          (key) =>
            `<div style="display:flex;justify-content:space-between;gap:12px">
               <span style="color:#898781">${SUBSCORE_LABELS[key]}</span>
               <span style="font-variant-numeric:tabular-nums">${cell.subscores[key].toFixed(0)}</span>
             </div>`,
        ).join("");

        return {
          html: `
            <div style="min-width:190px">
              <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:6px">
                <span style="font-size:18px;font-weight:600;font-variant-numeric:tabular-nums">
                  ${score == null ? "—" : score.toFixed(1)}
                </span>
                <span style="font-size:11px;color:${cell.eligible ? "#0ca30c" : "#d03b3b"}">
                  ${cell.eligible ? "Eligible" : "Constraints failed"}
                </span>
              </div>
              ${rows}
              <div style="margin-top:6px;font-size:10px;color:#898781">${cell.h3Index}</div>
            </div>`,
          style: {
            backgroundColor: "#1a1a19",
            color: "#ffffff",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: "8px",
            padding: "10px 12px",
            fontSize: "12px",
            fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
          },
        };
      },
    });
    map.addControl(overlay as unknown as maplibregl.IControl);

    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
      overlayRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const layers = useMemo(() => {
    return [
      // The heatmap fill is conditional, but the selection ring below is not:
      // hiding the layer should not also discard the user's selection.
      ...(heatmap.visible && weightsReady
        ? [
            new H3HexagonLayer<HeatmapCell>({
              id: "score-heatmap",
              data: visibleCells,
              getHexagon: (d) => d.h3Index,
              getFillColor: (d) => colorForScore(compositeScore(d.subscores, weights)),
              // Hex borders in the basemap color, so the seam between cells
              // reads as basemap showing through rather than a drawn grid.
              stroked: true,
              getLineColor: BASEMAP_SURFACE_RGB,
              lineWidthMinPixels: 1,
              filled: true,
              extruded: false,
              opacity: heatmap.opacity,
              pickable: true,
              autoHighlight: true,
              highlightColor: [255, 255, 255, 40],
              updateTriggers: {
                getFillColor: [weights],
              },
            }),
          ]
        : []),
      // Outline the scored cell — the only selection cue, so it carries the
      // weight a pin used to. A pin marked a coordinate, which was misleading:
      // scoring snaps to the containing cell, so the hexagon is the honest
      // unit. Drawn last and unfilled, so the score color underneath stays
      // readable through the ring.
      ...(selectedH3
        ? [
            new H3HexagonLayer<{ h3Index: string }>({
              id: "selected-cell",
              data: [{ h3Index: selectedH3 }],
              getHexagon: (d) => d.h3Index,
              filled: false,
              stroked: true,
              getLineColor: [255, 255, 255, 255],
              lineWidthMinPixels: 3,
              extruded: false,
              pickable: false,
              // Independent of the heatmap's opacity slider: dialling the fill
              // down to 20% should not also fade the selection ring.
              opacity: 1,
            }),
          ]
        : []),
    ];
  }, [heatmap.visible, heatmap.opacity, visibleCells, weights, weightsReady, selectedH3]);

  useEffect(() => {
    overlayRef.current?.setProps({ layers });
  }, [layers]);

  // Publish band counts for the rail's legend. Derived from every cell, not
  // just the visible ones, so the distribution does not shift when the
  // eligibility filter is on.
  useEffect(() => {
    if (!cellsQuery.data || !weightsReady) {
      setHeatmapStats(null);
      return;
    }

    const counts = new Array<number>(SCORE_BINS.length).fill(0);
    let eligible = 0;
    for (const cell of cellsQuery.data.cells) {
      const index = binIndexForScore(compositeScore(cell.subscores, weights));
      if (index >= 0) counts[index] += 1;
      if (cell.eligible) eligible += 1;
    }

    setHeatmapStats({
      counts,
      total: cellsQuery.data.cells.length,
      eligible,
      datasetId: cellsQuery.data.datasetId,
      h3Resolution: cellsQuery.data.h3Resolution,
      analytics: computeGridAnalytics(cellsQuery.data.cells, weights),
    });
  }, [cellsQuery.data, weights, weightsReady, setHeatmapStats]);

  const stats = useMapStore((s) => s.heatmapStats);
  const loading = cellsQuery.isPending || presetsQuery.isPending;
  const failed = cellsQuery.error ?? presetsQuery.error;

  // Sized with h-full/w-full rather than `absolute inset-0`: MapLibre adds
  // `.maplibregl-map` to this element, and that rule sets `position: relative`.
  // It is unlayered CSS, so it outranks Tailwind's layered `.absolute` no
  // matter the import order — the container would collapse to zero height.
  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {/* Bottom-centred, clear of the top cluster (preset picker, score panel)
          and of MapLibre's own controls at bottom-left and bottom-right. */}
      {heatmap.visible ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center">
          {loading ? (
            <p className="flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
              <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
              Loading {PRESET_LABELS[preset]} grid…
            </p>
          ) : failed ? (
            <p className="flex items-center gap-1.5 rounded-full border border-destructive/40 bg-card/90 px-3 py-1.5 text-xs text-destructive backdrop-blur">
              <TriangleAlertIcon className="size-3.5 shrink-0" />
              Grid unavailable — {failed.message}
            </p>
          ) : visibleCells.length === 0 ? (
            <p className="flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
              <CircleAlertIcon className="size-3.5 shrink-0" />
              {eligibleOnly
                ? "No cells pass every constraint under this preset"
                : "No scored cells to draw"}
            </p>
          ) : null}
        </div>
      ) : null}

      <ScorePanel
        isPending={scorePoint.isPending}
        error={scorePoint.error}
        data={scorePoint.data ?? null}
        analytics={stats?.analytics ?? null}
        weights={weightsReady ? weights : null}
      />
    </div>
  );
}
