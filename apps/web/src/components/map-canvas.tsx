import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { PolygonLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CircleAlertIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
} from "lucide-react";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { useEffect, useMemo, useRef, useState } from "react";

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
  HEX_SEAM_RGBA,
  SCORE_BINS,
  binIndexForScore,
  colorForScore,
} from "@/lib/heatmap-palette";
import {
  COLD_FILL,
  COLD_LINE,
  HOT_FILL,
  HOT_LINE,
  UNDERSERVED_FILL,
  UNDERSERVED_LINE,
  buildRegions,
  countByClassification,
  type HotspotCell,
  type HotspotRegion,
  type UnderservedCell,
} from "@/lib/hotspots";
import { computeGridAnalytics } from "@/lib/score-analytics";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import {
  PMTILES_BASE_URL,
  TILE_LAYERS,
  archiveUrl,
  bottomLayerId,
  styleLayersOf,
} from "@/lib/tile-layers";
import { useMapStore } from "@/stores/map-store";
import { useTRPC, useTRPCClient } from "@/utils/trpc";

/**
 * MapLibre touches `window` at import time, so this module must only ever be
 * reached from the client-only boundary in `map-view.tsx`. Do not import it
 * directly from a route.
 */

const AUSTIN = { lng: -97.7431, lat: 30.2672 };

/** CARTO dark matter — free, no API key, OSM-attributed. */
const BASEMAP_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const EMPTY_CELLS: HeatmapCell[] = [];
const EMPTY_HOTSPOT_CELLS: HotspotCell[] = [];
const EMPTY_UNDERSERVED: UnderservedCell[] = [];

/** Shared by every tooltip the overlay renders, so they cannot drift apart. */
const TOOLTIP_STYLE = {
  backgroundColor: "#1a1a19",
  color: "#ffffff",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: "8px",
  padding: "10px 12px",
  fontSize: "12px",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
};

/**
 * `addProtocol` registers globally on maplibre, not per map, so this runs once
 * per page rather than once per mount — re-registering on a remount would
 * discard the archive header/directory cache the protocol keeps, and every
 * visible tile would re-fetch.
 *
 * `metadata: true` costs one extra range request per archive and in exchange
 * populates the attribution control from what Tippecanoe baked in. Attribution
 * for OSM and the City of Austin data is not optional, so that trade is
 * already decided.
 */
let pmtilesProtocolRegistered = false;
function registerPMTilesProtocol() {
  if (pmtilesProtocolRegistered) return;
  maplibregl.addProtocol("pmtiles", new Protocol({ metadata: true }).tile);
  pmtilesProtocolRegistered = true;
}

/**
 * Where deck's layers get inserted into the basemap's layer stack.
 *
 * Two anchors, because the hexes and the analysis overlays belong at different
 * depths: the score heatmap sits *under* the PMTiles overlays, while clusters
 * and underserved areas are findings drawn on top of everything but the
 * basemap's labels.
 *
 * `null` means the style is not ready yet. An `undefined` id means it is ready
 * but nothing was found to anchor against, so deck draws on top — the old
 * overlaid behaviour, and a safe fallback rather than a crash.
 */
type DeckAnchor = {
  hexBeforeId: string | undefined;
  analysisBeforeId: string | undefined;
} | null;

export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [deckAnchor, setDeckAnchor] = useState<DeckAnchor>(null);

  const trpc = useTRPC();
  const preset = useMapStore((s) => s.preset);
  const mapLayers = useMapStore((s) => s.layers);
  const heatmap = mapLayers.heatmap;
  const eligibleOnly = useMapStore((s) => s.eligibleOnly);
  const setHeatmapStats = useMapStore((s) => s.setHeatmapStats);
  const setPresets = useMapStore((s) => s.setPresets);
  const customWeights = useMapStore((s) => s.customWeights);

  const hotspotParams = useMapStore((s) => s.hotspotParams);
  const setHotspotStats = useMapStore((s) => s.setHotspotStats);
  const analysisOn = mapLayers.hotspots.visible || mapLayers.underserved.visible;

  const scorePoint = useMutation(trpc.geo.score.mutationOptions());
  const scorePointRef = useRef(scorePoint.mutate);
  const selectedPointRef = useRef<{ lat: number; lon: number } | null>(null);
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

  // Gi* and DBSCAN run server-side across the whole grid, so unlike the
  // heatmap they cannot be recomputed in the browser when a weight moves.
  // Debouncing the value the request is keyed on keeps the heatmap instant
  // while the clusters catch up after the drag settles, instead of firing one
  // round trip per pointer move.
  const debouncedWeights = useDebouncedValue(customWeights, 400);
  const trpcClient = useTRPCClient();
  const hotspotsQuery = useQuery({
    queryKey: ["geo.hotspots", preset, hotspotParams, debouncedWeights],
    // `geo.hotspots` is declared a tRPC mutation because it POSTs upstream,
    // but it is a pure read. Driving it through the vanilla client inside a
    // query buys caching and — the reason it matters here — makes React Query
    // discard responses whose parameters are already stale, so a slow request
    // for one threshold cannot land on top of a fast one for the next.
    queryFn: () =>
      trpcClient.geo.hotspots.mutate({
        preset,
        method: hotspotParams.method,
        k: hotspotParams.k,
        threshold: hotspotParams.threshold,
        eps_km: hotspotParams.epsKm,
        min_samples: hotspotParams.minSamples,
        weights: debouncedWeights ?? undefined,
      }),
    // Only fetched once an analysis layer is actually switched on: it is the
    // most expensive call the map makes, and most sessions never open it.
    enabled: analysisOn,
    staleTime: Infinity,
  });

  const hotspotCells = (hotspotsQuery.data?.cells ?? EMPTY_HOTSPOT_CELLS) as HotspotCell[];
  const underservedCells = (hotspotsQuery.data?.underserved ??
    EMPTY_UNDERSERVED) as UnderservedCell[];

  const regions = useMemo(
    () => buildRegions(hotspotCells, hotspotParams.method),
    [hotspotCells, hotspotParams.method],
  );

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

  const selectedData = useMemo(() => {
    if (!scorePoint.data) return null;
    return {
      ...scorePoint.data,
      score: compositeScore(scorePoint.data.subscores, weights),
    };
  }, [scorePoint.data, weights]);
  const selectedH3 = selectedData?.h3_index ?? null;

  // Subscores and hard constraints vary by preset, so refresh the selected
  // cell when the use case changes. Weight-only edits stay local: the selected
  // composite above and every heatmap cell use the same weighted average.
  useEffect(() => {
    const point = selectedPointRef.current;
    if (!point) return;
    scorePointRef.current({ point, preset });
  }, [preset]);

  // The tooltip closure is built once with the overlay, so it reads the active
  // preset's weights through a ref rather than capturing a stale value.
  const weightsRef = useRef<Weights>(weights);
  weightsRef.current = weights;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    registerPMTilesProtocol();

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [AUSTIN.lng, AUSTIN.lat],
      zoom: 11,
      attributionControl: { compact: true },
    });

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "top-right",
    );
    map.addControl(
      new maplibregl.ScaleControl({ unit: "metric" }),
      "bottom-left",
    );
    map.getCanvas().style.cursor = "crosshair";

    map.on("load", () => {
      // The basemap's first symbol layer is where its labels begin. Everything
      // we add goes below it, so street and place names stay on top of both
      // the overlays and the hexes. Found by scanning rather than hardcoding
      // an id, so a CARTO style revision cannot silently bury the labels.
      const labelStart = map
        .getStyle()
        .layers.find((l) => l.type === "symbol")?.id;

      if (PMTILES_BASE_URL) {
        for (const layer of TILE_LAYERS) {
          map.addSource(layer.sourceId, {
            type: "vector",
            url: archiveUrl(layer),
          });
          const state = useMapStore.getState().layers[layer.id];
          // A rail row can contribute several paint passes (the POI glow sits
          // under the POI dots). `styleLayersOf` returns them bottom-first,
          // and each insert lands immediately below `labelStart`, so both the
          // passes within a layer and the layers themselves stack in array
          // order: zoning at the bottom, POI dots on top.
          for (const pass of styleLayersOf(layer)) {
            const initialStyle = {
              ...pass.spec,
              layout: {
                ...pass.spec.layout,
                visibility: state.visible ? "visible" : "none",
              },
              paint: {
                ...pass.spec.paint,
                [pass.opacityProperty]: state.opacity * pass.opacityScale,
              },
            } as maplibregl.LayerSpecification;
            map.addLayer(initialStyle, labelStart);
          }
        }
      }

      // Hexes go below the first overlay, which puts the stack, bottom to top:
      // basemap, hexes, overlays, labels. With no tiles configured there is no
      // overlay to sit under, so they anchor to the label boundary instead —
      // anchoring to a layer that was never added would throw in `addLayer`.
      setDeckAnchor({
        hexBeforeId: PMTILES_BASE_URL ? bottomLayerId(TILE_LAYERS[0]) : labelStart,
        analysisBeforeId: labelStart,
      });
    });

    map.on("click", ({ lngLat }) => {
      const { preset: activePreset, customWeights: edits } =
        useMapStore.getState();
      const point = { lat: lngLat.lat, lon: lngLat.lng };
      selectedPointRef.current = point;
      scorePointRef.current({
        point,
        preset: activePreset,
        // Send slider edits so the panel's score matches the hex the user
        // clicked. Omitted when unedited, letting the server use the preset's
        // own weights as the source of truth.
        weights: edits ?? undefined,
      });
    });

    // Interleaved: deck shares the basemap's GL context and its layers live in
    // the same stack, which is the only way the PMTiles overlays and the
    // basemap's labels can draw *above* the hexes. The cost is a dependency on
    // the basemap's layer ids, kept to the single lookup in the `load` handler
    // above and degraded to "draw on top" rather than a throw if it fails.
    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      getTooltip: (info) => {
        const { object, layer } = info;
        if (!object) return null;

        if (layer?.id === "underserved-cells") {
          const cell = object as UnderservedCell;
          return {
            html: `
              <div style="min-width:190px">
                <div style="font-weight:600;margin-bottom:6px">Underserved</div>
                <div style="display:flex;justify-content:space-between;gap:12px">
                  <span style="color:#898781">Residents (percentile)</span>
                  <span style="font-variant-numeric:tabular-nums">${cell.demand.toFixed(0)}</span>
                </div>
                <div style="display:flex;justify-content:space-between;gap:12px">
                  <span style="color:#898781">POIs in cell</span>
                  <span style="font-variant-numeric:tabular-nums">${cell.supply}</span>
                </div>
                <div style="margin-top:6px;font-size:10px;color:#898781">
                  General retail and services only
                </div>
              </div>`,
            style: TOOLTIP_STYLE,
          };
        }

        const cell = object as HeatmapCell;
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
          style: TOOLTIP_STYLE,
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
    // Interleaved layers are inserted with `map.addLayer(group, beforeId)`, so
    // handing deck a `beforeId` before the style has that layer would throw.
    // Nothing renders until the `load` handler has published the anchor.
    if (!deckAnchor) return [];

    // `@deck.gl/mapbox` reads `beforeId` off a layer's props in interleaved
    // mode, but it is not part of deck's core layer props and the package does
    // not export the type that adds it. Spread rather than written inline:
    // that is what keeps TypeScript from rejecting it as an excess property,
    // without reaching for `as any` on the whole layer.
    const placement = { beforeId: deckAnchor.hexBeforeId };
    const analysisPlacement = { beforeId: deckAnchor.analysisBeforeId };

    return [
      // The heatmap fill is conditional, but the selection ring below is not:
      // hiding the layer should not also discard the user's selection.
      ...(heatmap.visible && weightsReady
        ? [
            new H3HexagonLayer<HeatmapCell>({
              ...placement,
              id: "score-heatmap",
              data: visibleCells,
              getHexagon: (d) => d.h3Index,
              getFillColor: (d) =>
                colorForScore(compositeScore(d.subscores, weights)),
              // A soft seam rather than a border — see `HEX_SEAM_RGBA`. Kept
              // at a 1px minimum: thinner lands on sub-pixel widths, where
              // antialiasing thins the seam again on top of the alpha and it
              // breaks up unevenly across zoom levels.
              stroked: true,
              getLineColor: HEX_SEAM_RGBA,
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
              ...placement,
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

      // Individual hexes, not a dissolved area: each underserved cell carries
      // its own demand and supply numbers, and keeping them separate is what
      // lets the tooltip report them honestly. It also reads as a different
      // form from the cluster outlines below, which is the whole reason the
      // two can share a crowded palette.
      ...(mapLayers.underserved.visible && underservedCells.length > 0
        ? [
            new H3HexagonLayer<UnderservedCell>({
              ...analysisPlacement,
              id: "underserved-cells",
              data: underservedCells,
              getHexagon: (d) => d.h3Index,
              filled: true,
              getFillColor: UNDERSERVED_FILL,
              stroked: true,
              getLineColor: UNDERSERVED_LINE,
              lineWidthMinPixels: 1.5,
              extruded: false,
              opacity: mapLayers.underserved.opacity,
              pickable: true,
            }),
          ]
        : []),

      // Dissolved cluster boundaries. Stroking each hexagon separately would
      // draw a honeycomb and read as a grid rather than one cluster.
      ...(mapLayers.hotspots.visible && regions.length > 0
        ? [
            new PolygonLayer<HotspotRegion>({
              ...analysisPlacement,
              id: "hotspot-regions",
              data: regions,
              getPolygon: (d) => d.rings,
              filled: true,
              getFillColor: (d) => (d.tone === "hot" ? HOT_FILL : COLD_FILL),
              stroked: true,
              getLineColor: (d) => (d.tone === "hot" ? HOT_LINE : COLD_LINE),
              getLineWidth: 2,
              lineWidthUnits: "pixels",
              lineWidthMinPixels: 2,
              opacity: mapLayers.hotspots.opacity,
              // Deliberately not pickable. The outline's meaning is carried
              // entirely by its color plus the rail's legend, and staying out
              // of picking keeps the score hex underneath clickable.
              pickable: false,
            }),
          ]
        : []),
    ];
  }, [
    deckAnchor,
    heatmap.visible,
    heatmap.opacity,
    visibleCells,
    weights,
    weightsReady,
    selectedH3,
    mapLayers.underserved.visible,
    mapLayers.underserved.opacity,
    mapLayers.hotspots.visible,
    mapLayers.hotspots.opacity,
    underservedCells,
    regions,
  ]);

  useEffect(() => {
    overlayRef.current?.setProps({ layers });
  }, [layers]);

  // Push the rail's toggles and sliders onto the style. Runs off `deckAnchor`
  // rather than a mount-time flag because that is the signal the `load`
  // handler finished adding these layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !deckAnchor || !PMTILES_BASE_URL) return;

    for (const layer of TILE_LAYERS) {
      const state = mapLayers[layer.id];
      for (const pass of styleLayersOf(layer)) {
        map.setLayoutProperty(
          pass.spec.id,
          "visibility",
          state.visible ? "visible" : "none",
        );
        map.setPaintProperty(
          pass.spec.id,
          pass.opacityProperty,
          state.opacity * pass.opacityScale,
        );
      }
    }
  }, [deckAnchor, mapLayers]);

  // Publish painted-class tallies so the rail can caption each legend swatch
  // with a real count. Left alone while a refetch is in flight: the store
  // already cleared them when the parameter changed, and writing partial
  // numbers here would caption the new legend with the old response.
  useEffect(() => {
    if (!hotspotsQuery.data) return;
    setHotspotStats({
      counts: countByClassification(hotspotCells, hotspotParams.method),
      clusters: hotspotsQuery.data.clusters.length,
      underserved: underservedCells.length,
    });
  }, [
    hotspotsQuery.data,
    hotspotCells,
    underservedCells,
    hotspotParams.method,
    setHotspotStats,
  ]);

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
        data={selectedData}
        analytics={stats?.analytics ?? null}
        weights={weightsReady ? weights : null}
      />
    </div>
  );
}
