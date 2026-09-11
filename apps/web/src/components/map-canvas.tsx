import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { PolygonLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CircleAlertIcon,
  LoaderCircleIcon,
  MapPinIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { cellToLatLng } from "h3-js";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { useEffect, useMemo, useRef, useState } from "react";

import { panelPill } from "./panel-styles";
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
  POI_COLORS,
  POI_HOVER_LAYER_ID,
  POI_KIND_META,
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
/**
 * How many rows the shortlist carries.
 *
 * The grid is about a thousand cells. A shortlist exists to stop the reader
 * scanning, so it has to end well before the eye gives up; past roughly
 * thirty rows it is just the grid again in a narrower column.
 */
const RANKED_LIMIT = 25;

const BASEMAP_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const EMPTY_CELLS: HeatmapCell[] = [];
const EMPTY_HOTSPOT_CELLS: HotspotCell[] = [];
const EMPTY_UNDERSERVED: UnderservedCell[] = [];

/**
 * POI names come from OpenStreetMap, so they are arbitrary user-contributed
 * strings that reach `setHTML` — "Sammie's" is harmless, a name containing
 * angle brackets is not. Everything interpolated into popup markup goes
 * through here.
 */
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** `restaurant` / `car_repair` as written by the classifier, made readable. */
function humanize(value: unknown): string {
  const text = String(value ?? "").replaceAll("_", " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

const POI_KIND_COLOR: Record<string, string> = {
  competitor: POI_COLORS.competitor,
  complementary: POI_COLORS.complementary,
  anchor: POI_COLORS.anchor,
};

/**
 * Role block for the hover card: the label, what it means, and the OSM tags
 * behind it. A bare "Complementary" is jargon — it names a category without
 * saying what qualifies for it, which is the one thing a reader hovering a
 * dot wants to know.
 *
 * Three stacked lines rather than label and definition side by side. Inline,
 * the definition is a flex sibling that wraps inside its own box, so a long
 * one breaks mid-phrase and leaves its separator stranded against a
 * vertically centred label. Only the swatch row is flex; everything below it
 * is indented by the swatch's width so the text edges line up.
 */
const SWATCH_INDENT = "padding-left:14px";

function poiRoleHtml(kind: unknown): string {
  const key = String(kind ?? "");
  const meta = key in POI_KIND_META ? POI_KIND_META[key as keyof typeof POI_KIND_META] : null;
  const swatch = POI_KIND_COLOR[key] ?? "var(--muted-foreground)";
  const label = meta ? meta.label : humanize(key) || "Unclassified";

  const swatchRow = `<div style="display:flex;align-items:center;gap:6px">
        <span style="width:8px;height:8px;border-radius:2px;background:${swatch};flex:none"></span>
        <span style="font-size:11px;font-weight:600;color:var(--popover-foreground)">${escapeHtml(label)}</span>
      </div>`;

  // The archive only carries the three classified roles, so a missing entry
  // is a guard against a rebuilt archive rather than an expected branch.
  if (!meta) return swatchRow;

  return `${swatchRow}
      <div style="${SWATCH_INDENT};margin-top:2px;font-size:11px;line-height:1.4;color:color-mix(in oklab, var(--popover-foreground) 76%, transparent)">
        ${escapeHtml(meta.definition)}
      </div>
      <div style="${SWATCH_INDENT};margin-top:3px;font-size:10px;line-height:1.35;color:var(--muted-foreground)">
        ${escapeHtml(meta.examples)}
      </div>`;
}

/** Shared by every tooltip the overlay renders, so they cannot drift apart. */
const TOOLTIP_STYLE = {
  backgroundColor: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: "10px 12px",
  fontSize: "12px",
  fontFamily: "var(--font-sans)",
  boxShadow: "0 16px 40px -16px rgba(0,0,0,0.8)",
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

  const setRankedCells = useMapStore((s) => s.setRankedCells);
  const setSelection = useMapStore((s) => s.setSelection);
  const pendingFocusH3 = useMapStore((s) => s.pendingFocusH3);
  const clearPendingFocus = useMapStore((s) => s.clearPendingFocus);

  const scorePoint = useMutation(trpc.geo.score.mutationOptions());
  const scorePointRef = useRef(scorePoint.mutate);
  const selectedPointRef = useRef<{ lat: number; lon: number } | null>(null);
  /**
   * True while a POI card is open. The score hexes are pickable, so without
   * this a POI hover would show deck's hex tooltip and the POI popup at the
   * same time, in two different corners of the cursor.
   */
  const poiHoveredRef = useRef(false);
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

  /**
   * Top of the grid under the live weights.
   *
   * Ranked over `visibleCells`, so the "only workable sites" filter narrows
   * the shortlist exactly as it narrows the map. Capped: past about thirty
   * rows the list stops being a shortlist and the reader is back to scanning.
   */
  const rankedCells = useMemo(() => {
    const scored: { h3Index: string; score: number; eligible: boolean }[] = [];
    for (const cell of visibleCells) {
      const score = compositeScore(cell.subscores, weights);
      if (score != null) {
        scored.push({ h3Index: cell.h3Index, score, eligible: cell.eligible });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, RANKED_LIMIT);
  }, [visibleCells, weights]);

  useEffect(() => {
    setRankedCells(rankedCells.length > 0 ? rankedCells : null);
  }, [rankedCells, setRankedCells]);

  // The dock renders outside this client-only subtree, so the mutation's
  // state has to reach it through the store.
  useEffect(() => {
    if (!scorePoint.isPending && !scorePoint.error && !scorePoint.data) {
      setSelection(null);
      return;
    }
    setSelection({
      isPending: scorePoint.isPending,
      error: scorePoint.error ? { message: scorePoint.error.message } : null,
      cell: scorePoint.data ?? null,
    });
  }, [scorePoint.isPending, scorePoint.error, scorePoint.data, setSelection]);

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

  /**
   * A shortlist row was clicked: centre that cell and score it.
   *
   * Scored through the same mutation as a map click, from the cell's own
   * centroid, so the panel cannot disagree with the row that opened it.
   * `flyTo` is skipped under reduced motion, which would otherwise pan the
   * whole viewport for a second on every row click.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!pendingFocusH3 || !map) return;

    const [lat, lon] = cellToLatLng(pendingFocusH3);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const camera = { center: [lon, lat] as [number, number], zoom: Math.max(map.getZoom(), 12) };
    if (reduceMotion) map.jumpTo(camera);
    else map.flyTo({ ...camera, duration: 900 });

    const { preset: activePreset, customWeights: edits } = useMapStore.getState();
    selectedPointRef.current = { lat, lon };
    scorePointRef.current({ point: { lat, lon }, preset: activePreset, weights: edits ?? undefined });
    clearPendingFocus();
  }, [pendingFocusH3, clearPendingFocus]);

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

    // Bottom-right, stacked over the attribution. The top-right corner
    // belongs to the results card, and this control sitting there is what
    // forced the old score panel's `right-16` offset.
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.ScaleControl({ unit: "metric" }),
      "bottom-left",
    );
    map.getCanvas().style.cursor = "crosshair";

    /**
     * POI hover card.
     *
     * The dots are a MapLibre circle layer rather than a deck layer, so they
     * are invisible to deck's `getTooltip` and need their own wiring. The card
     * is anchored to the POI's own coordinates instead of the pointer, so it
     * reads as belonging to that dot rather than trailing the cursor.
     */
    function attachPoiHover(target: maplibregl.Map) {
      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 14,
        className: "wh-map-popup",
        maxWidth: "280px",
      });

      target.on("mousemove", POI_HOVER_LAYER_ID, (event) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;

        poiHoveredRef.current = true;
        target.getCanvas().style.cursor = "pointer";

        const { name, poi_kind: kind, poi_type: type } = feature.properties ?? {};

        popup
          .setLngLat(feature.geometry.coordinates as [number, number])
          .setHTML(
            `<div style="min-width:180px">
               <div style="font-weight:600;line-height:1.3">${
                 escapeHtml(name) || "Unnamed"
               }</div>
               ${
                 type
                   ? `<div style="margin-top:1px;font-size:11px;color:var(--muted-foreground)">${escapeHtml(humanize(type))}</div>`
                   : ""
               }
               <div style="margin-top:8px">${poiRoleHtml(kind)}</div>
             </div>`,
          )
          .addTo(target);
      });

      target.on("mouseleave", POI_HOVER_LAYER_ID, () => {
        poiHoveredRef.current = false;
        // Back to the map's own cursor, not `""` — the whole canvas is a
        // crosshair because clicking anywhere scores that point.
        target.getCanvas().style.cursor = "crosshair";
        popup.remove();
      });
    }

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

        attachPoiHover(map);
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
      useMapStore.getState().setSelectionOrigin("map");
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
        // The POI card wins: it is the more specific thing under the cursor.
        if (poiHoveredRef.current) return null;

        if (layer?.id === "underserved-cells") {
          const cell = object as UnderservedCell;
          return {
            html: `
              <div style="min-width:190px">
                <div style="font-weight:600;margin-bottom:6px">Underserved</div>
                <div style="display:flex;justify-content:space-between;gap:12px">
                  <span style="color:var(--muted-foreground)">People nearby</span>
                  <span style="font-family:var(--font-mono);font-variant-numeric:tabular-nums">${cell.demand.toFixed(0)}</span>
                </div>
                <div style="display:flex;justify-content:space-between;gap:12px">
                  <span style="color:var(--muted-foreground)">Businesses here</span>
                  <span style="font-family:var(--font-mono);font-variant-numeric:tabular-nums">${cell.supply}</span>
                </div>
                <div style="margin-top:6px;font-size:10px;color:var(--muted-foreground)">
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
               <span style="color:var(--muted-foreground)">${SUBSCORE_LABELS[key]}</span>
               <span style="font-family:var(--font-mono);font-variant-numeric:tabular-nums">${cell.subscores[key].toFixed(0)}</span>
             </div>`,
        ).join("");

        return {
          html: `
            <div style="min-width:190px">
              <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:6px">
                <span style="font-size:18px;font-weight:600;font-family:var(--font-mono);font-variant-numeric:tabular-nums">
                  ${score == null ? "-" : score.toFixed(1)}
                </span>
                <span style="font-size:11px;color:${
                  cell.eligible ? "var(--success)" : "var(--destructive)"
                }">
                  ${cell.eligible ? "Workable" : "Breaks a rule"}
                </span>
              </div>
              ${rows}
              <div style="margin-top:6px;font-size:10px;font-family:var(--font-mono);color:var(--muted-foreground)">${cell.h3Index}</div>
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

  const loading = cellsQuery.isPending || presetsQuery.isPending;
  const failed = cellsQuery.error ?? presetsQuery.error;

  // Sized with h-full/w-full rather than `absolute inset-0`: MapLibre adds
  // `.maplibregl-map` to this element, and that rule sets `position: relative`.
  // It is unlayered CSS, so it outranks Tailwind's layered `.absolute` no
  // matter the import order — the container would collapse to zero height.
  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {/* Bottom-centre is the one strip nothing else claims: the picker and
          the results card hold the top corners, the legend and the scale bar
          the bottom-left, navigation and attribution the bottom-right.
          A column so the grid notice and the POI hint stack instead of
          landing on top of each other when both apply. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-8 flex flex-col items-center gap-1.5">
        {heatmap.visible ? (
          loading ? (
            <p className={`${panelPill} text-muted-foreground`}>
              <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
              Scoring {PRESET_LABELS[preset]} sites…
            </p>
          ) : failed ? (
            <p className={`${panelPill} text-destructive ring-destructive/35`}>
              <TriangleAlertIcon className="size-3.5 shrink-0" />
              Could not load scores. {failed.message}
            </p>
          ) : visibleCells.length === 0 ? (
            <p className={`${panelPill} text-muted-foreground`}>
              <CircleAlertIcon className="size-3.5 shrink-0" />
              {eligibleOnly
                ? "Nowhere clears every rule for this use case"
                : "Nothing scored here yet"}
            </p>
          ) : null
        ) : null}

        {/* POIs are individual premises, not an area wash, and the archive
            thins them hard at low zoom — so the layer reads as almost empty
            on the opening view even though it is working. Saying so beats
            letting it look broken. */}
        {mapLayers.poi.visible ? (
          <p className={`${panelPill} text-muted-foreground`}>
            <MapPinIcon className="size-3.5 shrink-0" />
            Points of interest are individual local places. Zoom in and pan to see more
          </p>
        ) : null}
      </div>

    </div>
  );
}
