import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { PathLayer, PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CircleAlertIcon,
  LoaderCircleIcon,
  MapPinIcon,
  PencilLineIcon,
  ScanIcon,
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
  CATCHMENT_LINE_COLOR,
  CATCHMENT_LINE_WIDTH,
  buildCatchmentRegions,
  type CatchmentRegion,
} from "@/lib/catchment";
import { COMPARE_COLORS } from "@/lib/compare";
import {
  HEX_SEAM_RGBA,
  binIndexIn,
  colorIn,
  measureMeta,
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
import {
  RING_COLOR,
  RING_WIDTH,
  expandedHexRing,
  pulseFrame,
} from "@/lib/selection-pulse";
import {
  DOUBLE_CLICK_SLOP_PX,
  MIN_RADIUS_M,
  STUDY_AREA_DRAFT_LINE,
  STUDY_AREA_COLOR,
  STUDY_AREA_FILL,
  STUDY_AREA_LINE,
  cellsInStudyArea,
  circleRing,
  describeStudyArea,
  distanceMeters,
  pixelsApart,
  studyAreaRing,
  withoutTrailingDuplicate,
  type Position,
} from "@/lib/study-area";
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

// Every analysis layer is a flat surface whose visual stacking is already
// controlled by `beforeId` and array order. Leaving depth testing on makes
// those coplanar polygons compete with MapLibre's basemap on some GPUs,
// producing horizontal z-fighting stripes across otherwise solid hexes.
const FLAT_LAYER_PARAMETERS = {
  depthCompare: "always",
  depthWriteEnabled: false,
} as const;

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
  /**
   * Where the zoom control is mounted.
   *
   * MapLibre only offers four control positions, all corners, and the zoom
   * bar is wanted bottom-centre. Rather than reimplement it, the control is
   * instantiated directly and its element appended here: `onAdd` returns the
   * DOM node and `onRemove` tears it down, which is the whole of the
   * `IControl` contract. That keeps the parts worth keeping, notably the
   * compass, the pitch visualisation and the buttons disabling themselves at
   * the style's zoom limits, while this component owns the placement.
   */
  const zoomHostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [deckAnchor, setDeckAnchor] = useState<DeckAnchor>(null);

  const trpc = useTRPC();
  const preset = useMapStore((s) => s.preset);
  const mapLayers = useMapStore((s) => s.layers);
  const heatmap = mapLayers.heatmap;
  const gridMeasure = useMapStore((s) => s.gridMeasure);
  const measure = measureMeta(gridMeasure);
  const eligibleOnly = useMapStore((s) => s.eligibleOnly);
  const setHeatmapStats = useMapStore((s) => s.setHeatmapStats);
  const setPresets = useMapStore((s) => s.setPresets);
  const customWeights = useMapStore((s) => s.customWeights);

  const hotspotParams = useMapStore((s) => s.hotspotParams);
  const setHotspotStats = useMapStore((s) => s.setHotspotStats);
  const setHotspotStatus = useMapStore((s) => s.setHotspotStatus);
  const analysisOn = mapLayers.hotspots.visible || mapLayers.underserved.visible;

  const drawMode = useMapStore((s) => s.drawMode);
  const studyArea = useMapStore((s) => s.studyArea);
  const setDrawMode = useMapStore((s) => s.setDrawMode);
  const setStudyArea = useMapStore((s) => s.setStudyArea);

  /**
   * The shape being drawn right now: corners placed so far, and where the
   * pointer is.
   *
   * Local rather than in the store. It changes at pointer-move rate and
   * nothing outside this canvas draws it, so putting it in the store would
   * publish a hundred updates a second to subscribers that only ever want the
   * finished shape.
   */
  const [draft, setDraft] = useState<Position[]>([]);
  const [cursor, setCursor] = useState<Position | null>(null);

  const setRankedCells = useMapStore((s) => s.setRankedCells);
  const setSelection = useMapStore((s) => s.setSelection);
  const setStudyAreaScores = useMapStore((s) => s.setStudyAreaScores);
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

  /**
   * What one cell is worth under the active measure.
   *
   * The composite is weighted here in the browser, so it moves with the
   * sliders; air quality is a raw subscore off the same payload and does not.
   * One function, so the fill, the tooltip headline and the legend's band
   * counts cannot disagree about what the colors are showing.
   */
  const valueOf = useMemo(
    () =>
      gridMeasure === "aqi"
        ? (cell: HeatmapCell) => cell.subscores.aqi
        : (cell: HeatmapCell) => compositeScore(cell.subscores, weights),
    [gridMeasure, weights],
  );

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

  // The panel and the map both need to distinguish "working" and "failed"
  // from "found nothing", and neither can read the query from here.
  const hotspotError = hotspotsQuery.error;
  useEffect(() => {
    setHotspotStatus({
      pending: analysisOn && hotspotsQuery.isPending,
      error: hotspotError ? hotspotError.message : null,
    });
  }, [analysisOn, hotspotsQuery.isPending, hotspotError, setHotspotStatus]);

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

  /**
   * The cells the reader is actually asking about.
   *
   * Two narrowings, applied together: the drawn study area and the
   * eligibility filter. Both cut the same array, which keeps the map and the
   * shortlist from disagreeing. The grid narrows immediately; the shortlist
   * then switches to the complete batch-score response when it lands.
   *
   * The analysis overlays are deliberately *not* cut this way. Gi* and DBSCAN
   * run across the whole grid, so clipping a cluster to a hand-drawn boundary
   * would redraw a finding as something smaller than what was found.
   */
  const areaCells = useMemo(
    () => cellsInStudyArea(cells, studyArea),
    [cells, studyArea],
  );
  const visibleCells = useMemo(
    () => (eligibleOnly ? areaCells.filter((cell) => cell.eligible) : areaCells),
    [areaCells, eligibleOnly],
  );

  // A heatmap row is intentionally compact and has no hard-rule detail. Once
  // an area is committed, score every selected centroid through the batch
  // endpoint so the shortlist and exports have complete, authoritative rows.
  const areaPoints = useMemo(
    () =>
      studyArea
        ? areaCells.map((cell) => {
            const [lat, lon] = cellToLatLng(cell.h3Index);
            return { lat, lon };
          })
        : [],
    [areaCells, studyArea],
  );
  const studyAreaQuery = useQuery({
    queryKey: ["geo.scoreBatch", preset, areaCells.map((cell) => cell.h3Index)],
    queryFn: () =>
      trpcClient.geo.scoreBatch.mutate({
        points: areaPoints,
        preset,
      }),
    enabled: studyArea !== null && areaPoints.length > 0,
    staleTime: Infinity,
  });
  const studyAreaError = studyAreaQuery.error;

  useEffect(() => {
    if (!studyArea) {
      setStudyAreaScores(null, { pending: false, error: null });
      return;
    }
    if (areaPoints.length === 0) {
      setStudyAreaScores([], { pending: false, error: null });
      return;
    }
    setStudyAreaScores(studyAreaQuery.data?.results ?? null, {
      pending: studyAreaQuery.isPending,
      error: studyAreaError ? studyAreaError.message : null,
    });
  }, [
    studyArea,
    areaPoints.length,
    studyAreaQuery.data,
    studyAreaQuery.isPending,
    studyAreaError,
    setStudyAreaScores,
  ]);

  /**
   * Top of the grid under the live weights.
   *
   * Ranked over `visibleCells`, so the "only workable sites" filter narrows
   * the shortlist exactly as it narrows the map. Capped: past about thirty
   * rows the list stops being a shortlist and the reader is back to scanning.
   */
  const rankedCells = useMemo(() => {
    const scored: { h3Index: string; score: number; eligible: boolean }[] = [];
    const cellsToRank = studyAreaQuery.data
      ? studyAreaQuery.data.results
          .filter((cell) => !eligibleOnly || cell.eligible)
          .map((cell) => ({
            h3Index: cell.h3_index,
            eligible: cell.eligible,
            subscores: cell.subscores,
          }))
      : studyArea
        ? []
        : visibleCells;
    for (const cell of cellsToRank) {
      const score = compositeScore(cell.subscores, weights);
      if (score != null) {
        scored.push({ h3Index: cell.h3Index, score, eligible: cell.eligible });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, RANKED_LIMIT);
  }, [visibleCells, weights, studyArea, studyAreaQuery.data, eligibleOnly]);

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
  const comparisonSites = useMapStore((state) => state.comparisonSites);
  const catchmentOn = useMapStore((state) => state.catchmentOn);
  const catchmentMode = useMapStore((state) => state.catchmentMode);
  const catchmentMinutes = useMapStore((state) => state.catchmentMinutes);
  const catchmentQuery = useQuery({
    ...trpc.geo.catchment.queryOptions({
      h3Index: selectedH3 ?? "",
      mode: catchmentMode,
    }),
    enabled: catchmentOn && selectedH3 !== null,
    staleTime: Infinity,
  });

  /**
   * Milliseconds since the locator beacon started, or `null` when it is not
   * running.
   *
   * Driven by `requestAnimationFrame` rather than a CSS animation, because the
   * thing being animated is a deck.gl layer and there is no DOM node to style.
   */
  const [pulse, setPulse] = useState<number | null>(null);

  /**
   * The beacon runs for exactly as long as Reach is on and a cell is scored.
   *
   * Those two conditions are the situation it exists for: a white contour
   * spreading across the city with the white selection ring somewhere inside
   * it. With Reach off there is nothing to lose the cell in, so it stops and
   * the plain ring is left to do the marking.
   */
  useEffect(() => {
    if (!selectedH3 || !catchmentOn) {
      setPulse(null);
      return;
    }
    // Honoured the same way the shortlist's `flyTo` honours it: the beacon is
    // an attention cue, and for a reader who has asked for less motion the
    // steady ring already marks the cell.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPulse(null);
      return;
    }

    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      setPulse(now - start);
      frame = requestAnimationFrame(step);
    });

    return () => cancelAnimationFrame(frame);
  }, [selectedH3, catchmentOn]);

  const pulseState = pulse == null ? null : pulseFrame(pulse);

  const catchmentRegions = useMemo(
    // Gated on the switch as well as on the query, because disabling a query
    // does not discard what it already cached: switching Reach off after a
    // fetch would leave `data` populated and the contours drawn.
    () =>
      buildCatchmentRegions(
        catchmentOn ? (catchmentQuery.data?.bands ?? []) : [],
        catchmentMinutes,
      ),
    [catchmentOn, catchmentQuery.data, catchmentMinutes],
  );

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
  // Same reason as the weights: the tooltip closure is built once with the
  // overlay, so it cannot capture the measure by value.
  const measureRef = useRef(measure);
  measureRef.current = measure;

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

    // Bottom-left, beside the score key.
    //
    // The whole right edge belongs to the results card, which grows downward
    // from the top and on the "This site" tab reaches most of the way to the
    // bottom, so it covered this control there. Bottom-right is the same
    // edge; the left column is the only side nothing expands into.
    //
    // The scale bar is the only thing left in this corner, and it sits in the
    // very bottom strip, clear of the score key above it. Default `maxWidth`
    // restored: it was narrowed only to fit beside the key when the zoom bar
    // shared this corner.
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    // Zoom goes bottom-centre instead, mounted into this component's own node
    // rather than one of MapLibre's four corner containers. See `zoomHostRef`.
    const nav = new maplibregl.NavigationControl({ visualizePitch: true });
    zoomHostRef.current?.appendChild(nav.onAdd(map));

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
        // While a tool is armed the cursor is placing corners, not inspecting
        // premises. The card would otherwise open over the shape being drawn
        // and swap the crosshair for a pointer mid-stroke.
        if (useMapStore.getState().drawMode) return;

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
      const {
        preset: activePreset,
        customWeights: edits,
        drawMode: armed,
      } = useMapStore.getState();
      // A drawing tool owns the clicks while it is armed. Without this, every
      // corner placed would also score the point under it, so finishing a
      // five-corner shape would fire five score requests and leave the panel
      // showing whichever one landed last.
      if (armed) return;

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
          // `demand` is population_density_percentile * 100, so it is a rank
          // against the rest of the grid, not a headcount. Labelled "People
          // nearby" with a bare number it read as one: "87" looked like 87
          // residents in a cell covering 0.74 square kilometres. `supply`
          // really is a count, so it stays bare.
          return {
            html: `
              <div style="min-width:190px">
                <div style="font-weight:600;margin-bottom:6px">Underserved</div>
                <div style="display:flex;justify-content:space-between;gap:12px">
                  <span style="color:var(--muted-foreground)">Population density</span>
                  <span style="font-family:var(--font-mono);font-variant-numeric:tabular-nums">${cell.demand.toFixed(0)}th pctl</span>
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
        const activeMeasure = measureRef.current;
        // The headline has to be the number the color is showing. Leaving the
        // composite up while the hexes are painted by air quality would put a
        // score of 38 on top of a bright cell and read as a rendering bug.
        const headline =
          activeMeasure.id === "aqi"
            ? cell.subscores.aqi
            : compositeScore(cell.subscores, weightsRef.current);
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
                  ${headline == null ? "-" : headline.toFixed(1)}
                  ${
                    // Named only when it is not the score. The score is what
                    // the product is about, so labelling it would caption the
                    // obvious on every hover.
                    activeMeasure.id === "score"
                      ? ""
                      : `<span style="margin-left:6px;font-size:11px;font-weight:400;font-family:var(--font-sans);color:var(--muted-foreground)">${activeMeasure.label}</span>`
                  }
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
      // Before `map.remove()`: the control detaches its own listeners from
      // the map, and doing that after the map is gone is a needless race.
      nav.onRemove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /**
   * The drawing tools.
   *
   * Attached in their own effect keyed on the armed tool, rather than folded
   * into the map's mount effect, so each handler closes over the tool that is
   * actually running and the whole interaction tears itself down when the tool
   * is put away. `deckAnchor` is in the dependencies only as a readiness
   * signal: it is published by the `load` handler, which is the point the map
   * exists to attach to.
   *
   * Corners live in a closure variable as well as in React state. The state is
   * what draws; the closure is what the next click reads, because a handler
   * registered once per tool would otherwise keep seeing an empty array.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !drawMode || !deckAnchor) return;

    let corners: Position[] = [];
    setDraft([]);
    setCursor(null);

    const publish = (next: Position[]) => {
      corners = next;
      setDraft(next);
    };

    // Finishing a shape is a double-click, so the basemap's own double-click
    // zoom has to stand down for the duration or the last corner also zooms.
    map.doubleClickZoom.disable();

    /** Where a ground position falls on screen right now. */
    const project = (position: Position) => map.project(position);

    const onClick = (event: maplibregl.MapMouseEvent) => {
      const point: Position = [event.lngLat.lng, event.lngLat.lat];

      if (drawMode === "radius") {
        // First click is the centre, second sets how far out to look.
        if (corners.length === 0) {
          publish([point]);
          return;
        }
        // Two guards, because they catch different mistakes. The pixel one
        // rejects a double-click on the centre, which at low zoom would
        // otherwise commit a circle several hundred metres wide that the
        // reader never drew. The metric one rejects a circle small enough to
        // contain no cell at all.
        const radiusMeters = distanceMeters(corners[0], point);
        const drift = pixelsApart(project(corners[0]), event.point);
        if (drift < DOUBLE_CLICK_SLOP_PX || radiusMeters < MIN_RADIUS_M) return;

        setStudyArea({ kind: "radius", center: corners[0], radiusMeters });
        return;
      }

      publish([...corners, point]);
    };

    const onMouseMove = (event: maplibregl.MapMouseEvent) => {
      setCursor([event.lngLat.lng, event.lngLat.lat]);
    };

    const finishPolygon = () => {
      const ring = withoutTrailingDuplicate(corners, project);
      if (ring.length < 3) return;
      setStudyArea({ kind: "polygon", ring });
    };

    const onDoubleClick = () => {
      if (drawMode === "polygon") finishPolygon();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawMode(null);
        return;
      }
      if (event.key === "Enter" && drawMode === "polygon") {
        event.preventDefault();
        finishPolygon();
        return;
      }
      // Undo one corner. Cheap to add and the alternative is starting the
      // whole shape again over a single misplaced click.
      if (event.key === "Backspace" && corners.length > 0) {
        event.preventDefault();
        publish(corners.slice(0, -1));
      }
    };

    map.on("click", onClick);
    map.on("mousemove", onMouseMove);
    map.on("dblclick", onDoubleClick);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      map.off("click", onClick);
      map.off("mousemove", onMouseMove);
      map.off("dblclick", onDoubleClick);
      document.removeEventListener("keydown", onKeyDown);
      map.doubleClickZoom.enable();
      setDraft([]);
      setCursor(null);
    };
  }, [drawMode, deckAnchor, setStudyArea, setDrawMode]);

  /**
   * The half-drawn shape, rebuilt as the pointer moves.
   *
   * A polygon shows the corners placed so far plus a rubber band to the
   * cursor; a radius shows the circle the second click would commit. Both are
   * dimmer than a committed boundary, so "not yet" is legible without a label.
   */
  const draftPreview = useMemo(() => {
    if (!drawMode || draft.length === 0) return null;

    if (drawMode === "radius") {
      const center = draft[0];
      const radiusMeters = cursor ? distanceMeters(center, cursor) : 0;
      return {
        kind: "radius" as const,
        center,
        radiusMeters,
        ring: radiusMeters >= MIN_RADIUS_M ? circleRing(center, radiusMeters) : null,
      };
    }

    return {
      kind: "polygon" as const,
      corners: draft,
      path: cursor ? [...draft, cursor] : draft,
    };
  }, [drawMode, draft, cursor]);

  const baseLayers = useMemo(() => {
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
              parameters: FLAT_LAYER_PARAMETERS,
              getHexagon: (d) => d.h3Index,
              getFillColor: (d) => colorIn(valueOf(d), measure.bins),
              // Soft seams preserve the H3 cell boundaries without turning
              // the heatmap into a hard black honeycomb.
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
                getFillColor: [valueOf, measure],
              },
            }),
          ]
        : []),
      // Contours, not a wash. Filling the reachable cells covered the score
      // colours underneath with a second choropleth, which hid the answer the
      // reader was in the middle of reading. The boundary says the same thing
      // and recolours nothing, so this draws over the hexes without competing
      // with them.
      ...(catchmentRegions.length > 0
        ? [
            new PolygonLayer<CatchmentRegion>({
              ...analysisPlacement,
              id: "catchment-bands",
              data: catchmentRegions,
              parameters: FLAT_LAYER_PARAMETERS,
              getPolygon: (region) => region.rings,
              filled: false,
              stroked: true,
              getLineColor: CATCHMENT_LINE_COLOR,
              getLineWidth: CATCHMENT_LINE_WIDTH,
              lineWidthUnits: "pixels",
              lineWidthMinPixels: 1.5,
              opacity: 1,
              pickable: false,
            }),
          ]
        : []),
      ...(comparisonSites.length > 0
        ? [
            new H3HexagonLayer<(typeof comparisonSites)[number]>({
              ...analysisPlacement,
              id: "comparison-cells",
              data: comparisonSites,
              parameters: FLAT_LAYER_PARAMETERS,
              getHexagon: (site) => site.h3_index,
              filled: false,
              stroked: true,
              getLineColor: (_site, info) => [
                ...COMPARE_COLORS[info.index].rgba,
              ],
              lineWidthMinPixels: 2,
              extruded: false,
              pickable: false,
              opacity: 1,
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
              ...analysisPlacement,
              id: "selected-cell",
              data: [{ h3Index: selectedH3 }],
              parameters: FLAT_LAYER_PARAMETERS,
              getHexagon: (d) => d.h3Index,
              filled: false,
              stroked: true,
              getLineColor: RING_COLOR,
              // Constant. The beacon above supplies all the movement, and a
              // ring that also throbbed would add motion without adding
              // information — while dragging this layer, and the thousand-cell
              // ones beside it, into the per-frame path for nothing.
              lineWidthMinPixels: RING_WIDTH,
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
              parameters: FLAT_LAYER_PARAMETERS,
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
              parameters: FLAT_LAYER_PARAMETERS,
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

      // Last in the stack, so the reader's own boundary is never buried under
      // a finding or a catchment band. It is the one thing on the map that is
      // theirs rather than the data's, and losing track of where it runs is
      // what makes a drawn area feel unreliable.
      ...(studyArea
        ? [
            new PolygonLayer<{ ring: Position[] }>({
              ...analysisPlacement,
              id: "study-area",
              parameters: FLAT_LAYER_PARAMETERS,
              data: [{ ring: studyAreaRing(studyArea) }],
              getPolygon: (d) => d.ring,
              filled: true,
              getFillColor: STUDY_AREA_FILL,
              stroked: true,
              getLineColor: STUDY_AREA_LINE,
              getLineWidth: 2,
              lineWidthUnits: "pixels",
              lineWidthMinPixels: 2,
              opacity: 1,
              // Clicking inside the area still scores the cell under the
              // pointer, so the boundary stays out of picking entirely.
              pickable: false,
            }),
          ]
        : []),

      ...(draftPreview?.kind === "polygon"
        ? [
            new PathLayer<{ path: Position[] }>({
              ...analysisPlacement,
              id: "study-area-draft-path",
              parameters: FLAT_LAYER_PARAMETERS,
              data: [{ path: draftPreview.path }],
              getPath: (d) => d.path,
              getColor: STUDY_AREA_DRAFT_LINE,
              getWidth: 2,
              widthUnits: "pixels",
              widthMinPixels: 2,
              pickable: false,
            }),
            // The corners themselves. Without them a single placed click
            // draws nothing at all until the pointer moves, so the first
            // click of every shape looks like it missed.
            new ScatterplotLayer<Position>({
              ...analysisPlacement,
              id: "study-area-draft-corners",
              parameters: FLAT_LAYER_PARAMETERS,
              data: draftPreview.corners,
              getPosition: (d) => d,
              getFillColor: STUDY_AREA_LINE,
              getRadius: 4,
              radiusUnits: "pixels",
              radiusMinPixels: 4,
              pickable: false,
            }),
          ]
        : []),

      ...(draftPreview?.kind === "radius" && draftPreview.ring
        ? [
            new PolygonLayer<{ ring: Position[] }>({
              ...analysisPlacement,
              id: "study-area-draft-radius",
              parameters: FLAT_LAYER_PARAMETERS,
              data: [{ ring: draftPreview.ring }],
              getPolygon: (d) => d.ring,
              filled: true,
              getFillColor: STUDY_AREA_FILL,
              stroked: true,
              getLineColor: STUDY_AREA_DRAFT_LINE,
              getLineWidth: 2,
              lineWidthUnits: "pixels",
              lineWidthMinPixels: 2,
              opacity: 1,
              pickable: false,
            }),
          ]
        : []),

      ...(draftPreview?.kind === "radius"
        ? [
            new ScatterplotLayer<Position>({
              ...analysisPlacement,
              id: "study-area-draft-centre",
              parameters: FLAT_LAYER_PARAMETERS,
              data: [draftPreview.center],
              getPosition: (d) => d,
              getFillColor: STUDY_AREA_LINE,
              getRadius: 4,
              radiusUnits: "pixels",
              radiusMinPixels: 4,
              pickable: false,
            }),
          ]
        : []),
    ];
  }, [
    deckAnchor,
    studyArea,
    draftPreview,
    heatmap.visible,
    heatmap.opacity,
    visibleCells,
    valueOf,
    measure,
    weightsReady,
    selectedH3,
    comparisonSites,
    catchmentRegions,
    mapLayers.underserved.visible,
    mapLayers.underserved.opacity,
    mapLayers.hotspots.visible,
    mapLayers.hotspots.opacity,
    underservedCells,
    regions,
  ]);

  /**
   * The beacon, built on its own.
   *
   * Kept out of `baseLayers` deliberately. While Reach is on this is rebuilt
   * sixty times a second and forever, and folding it into the memo above would
   * drag every other layer — including two carrying a thousand cells each —
   * through a fresh construction and prop diff on every one of those frames.
   * Split out, a frame costs one six-vertex polygon and an array copy.
   */
  const pulseLayer = useMemo(() => {
    if (!deckAnchor || !selectedH3 || !pulseState || pulseState.alpha <= 0) return null;

    // Spread, not written inline — `beforeId` is read by `@deck.gl/mapbox` in
    // interleaved mode but is not part of deck's own layer props, so inline it
    // is rejected as an excess property. Same reason as `baseLayers`.
    const placement = { beforeId: deckAnchor.analysisBeforeId };

    return new PolygonLayer<{ ring: [number, number][] }>({
      ...placement,
      id: "selected-cell-pulse",
      parameters: FLAT_LAYER_PARAMETERS,
      data: [{ ring: expandedHexRing(selectedH3, pulseState.scale) }],
      getPolygon: (d) => d.ring,
      filled: false,
      stroked: true,
      getLineColor: pulseState.color,
      getLineWidth: 2,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 2,
      opacity: 1,
      pickable: false,
    });
  }, [deckAnchor, selectedH3, pulseState]);

  // Appended last, so the beacon is never buried by an overlay. Its whole job
  // is to be seen; anything drawing over it would defeat the point.
  const layers = useMemo(
    () => (pulseLayer ? [...baseLayers, pulseLayer] : baseLayers),
    [baseLayers, pulseLayer],
  );

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

    const counts = new Array<number>(measure.bins.length).fill(0);
    let eligible = 0;
    for (const cell of cellsQuery.data.cells) {
      const index = binIndexIn(valueOf(cell), measure.bins);
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
  }, [cellsQuery.data, weights, weightsReady, valueOf, measure, setHeatmapStats]);

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
        {/* A drawing tool takes over the map's clicks, which is a big enough
            change to the app's main interaction that it has to say so. The
            keys are named because none of them is guessable: nothing else in
            the product finishes on a double-click. */}
        {drawMode ? (
          <p className={`${panelPill} text-muted-foreground`}>
            {drawMode === "polygon" ? (
              <>
                <PencilLineIcon className="size-3.5 shrink-0" />
                Click each corner of the area. Double-click or press Enter to finish,
                Backspace to undo a corner, Escape to cancel
              </>
            ) : (
              <>
                <ScanIcon className="size-3.5 shrink-0" />
                Click the centre of the area, then click again to set how far out
                to look. Escape to cancel
              </>
            )}
          </p>
        ) : studyArea ? (
          /* The only way out of a study area if the Layers card is closed.
             The card still owns the tools; this owns the undo, because the
             thing being undone is on the map rather than in the card. */
          <p className={`pointer-events-auto ${panelPill} text-muted-foreground`}>
            <ScanIcon className="size-3.5 shrink-0" style={{ color: STUDY_AREA_COLOR }} />
            {/* The count is dropped while the grid is in flight rather than
                rendered as "0 of 0", which reads as an area that found
                nothing when in fact nothing has arrived to find yet. */}
            <span>
              Focused on {describeStudyArea(studyArea)}
              {cells.length > 0 ? (
                <>
                  {" — "}
                  <span className="font-mono tabular-nums text-foreground">
                    {areaCells.length}
                  </span>{" "}
                  of {cells.length} sites
                </>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => setStudyArea(null)}
              className="-mr-1 ml-1 rounded-full px-1.5 py-px text-foreground underline underline-offset-2 transition-colors hover:text-primary focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Show all Austin
            </button>
          </p>
        ) : null}

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
            /* Which of the two narrowings emptied the map decides the wording.
               Saying "nothing scored here yet" over a study area the reader
               just drew blames the data for their own boundary. */
            <p className={`${panelPill} text-muted-foreground`}>
              <CircleAlertIcon className="size-3.5 shrink-0" />
              {studyArea && areaCells.length === 0
                ? "Your area does not reach any scored sites. Try a wider one"
                : eligibleOnly
                  ? studyArea
                    ? "Nothing in your area clears every rule for this use case"
                    : "Nowhere clears every rule for this use case"
                  : "Nothing scored here yet"}
            </p>
          ) : null
        ) : null}

        {/* The analysis overlays draw nothing at all while their one request
            is in flight or after it fails, so without this the reader ticks
            a box and watches the map not change. */}
        {analysisOn ? (
          hotspotsQuery.isPending ? (
            <p className={`${panelPill} text-muted-foreground`}>
              <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
              Looking for patterns…
            </p>
          ) : hotspotError ? (
            <p className={`${panelPill} text-destructive ring-destructive/35`}>
              <TriangleAlertIcon className="size-3.5 shrink-0" />
              Could not find patterns. {hotspotError.message}
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

        {/* Last in the column, so the notices above stack on top of it rather
            than landing on it. `index.css` lays the mounted control out
            horizontally; MapLibre builds it as a vertical stack. */}
        <div ref={zoomHostRef} className="wh-zoom-control" />
      </div>

    </div>
  );
}
