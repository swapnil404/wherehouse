import { env } from "@wherehouse/env/web";
import type {
  CircleLayerSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
} from "maplibre-gl";

/**
 * Display overlays served as PMTiles from Neon Object Storage.
 *
 * These are context, not scoring. The pipeline builds them from the same source
 * snapshots as the H3 facts (`just tiles-prepare && just tiles-build`), but
 * nothing here feeds a score — a cell's zoning subscore comes from the API, and
 * the zoning polygons below only show *why* it looks the way it does.
 */

/** Trailing slash trimmed so the archive URLs below can join with a plain `/`. */
export const PMTILES_BASE_URL =
  env.VITE_PMTILES_BASE_URL?.replace(/\/+$/, "") ?? null;

export type TileLayerId = "zoning" | "flood" | "buildings" | "roads" | "poi";

export interface LegendEntry {
  label: string;
  hex: string;
}

export interface TileLayerSpec {
  id: TileLayerId;
  /** Row label in the layer rail. */
  label: string;
  /** Archive basename in the bucket, matching `tiles.py`'s `LAYERS` keys. */
  archive: string;
  /**
   * The MapLibre source id. The layer *inside* the archive is not restated
   * here — Tippecanoe named it for the archive, and `style["source-layer"]`
   * already carries it.
   */
  sourceId: string;
  style:
    FillLayerSpecification | LineLayerSpecification | CircleLayerSpecification;
  /** The paint property the rail's opacity slider drives. */
  opacityProperty: "fill-opacity" | "line-opacity" | "circle-opacity";
  /**
   * Extra paint passes drawn *underneath* `style`, bottom-first.
   *
   * One rail row can therefore be more than one MapLibre layer — the POI dots
   * plus the glow behind them — while a single toggle and a single opacity
   * slider still drive the whole thing. `opacityScale` is multiplied into the
   * slider value, which is what keeps a halo behind its dot at every setting
   * instead of only at 100%.
   */
  underlays?: {
    spec: CircleLayerSpecification | FillLayerSpecification | LineLayerSpecification;
    opacityProperty: "fill-opacity" | "line-opacity" | "circle-opacity";
    opacityScale: number;
  }[];
  /**
   * Seeds the store's slider and the style's initial paint value, so the two
   * cannot drift. Fills sit lower than line work: a wash has to let the score
   * hexes underneath read through it, a hairline does not.
   */
  defaultOpacity: number;
  /** Required whenever the layer paints more than one color (see below). */
  legend?: LegendEntry[];
  /** Shown in the rail when the layer only appears past a zoom threshold. */
  hint?: string;
}

/**
 * Zoning gets three hues plus a neutral residual, and that count is a measured
 * limit rather than a preference.
 *
 * The score heatmap already owns the palette's blue as its sequential ramp (see
 * `heatmap-palette.ts`), so these start at the second categorical slot. Zoning
 * polygons are adjacent on screen in every combination, so they have to clear
 * the all-pairs separation floors, not just the adjacent-pair ones — and no
 * fourth categorical hue does. Measured against the basemap surface `#0e0e0e`,
 * every candidate for a fourth slot fails: yellow vs orange ΔE 4.8 (deutan) /
 * 10.6 (normal), green vs orange 2.7, magenta vs aqua 1.6, red vs orange 7.1
 * (normal). The three below pass every gate — worst all-pairs CVD ΔE 9.4, worst
 * normal-vision ΔE 24.6, all ≥ 3:1 against the surface.
 *
 * So `agricultural` folds into `other`. Austin has very little of it, and an
 * honest grey residual beats a fourth hue nobody can reliably tell from the
 * industrial one.
 */
export const ZONING_COLORS = {
  industrial: "#d95926",
  commercial: "#9085e9",
  residential: "#199e70",
  other: "#898781",
} as const;

/**
 * Flood is a hazard state, not a series, so it takes reserved status colors.
 * SFHA is the 1%-annual-chance floodplain (FEMA A/V zones) and reads critical;
 * everything else in the layer is the surrounding moderate-risk area.
 */
export const FLOOD_COLORS = {
  sfha: "#d03b3b",
  moderate: "#ec835a",
} as const;

/** POI roles used by the ingestion classifier and written into `poi.pmtiles`. */
export const POI_COLORS = {
  competitor: "#e66767",
  complementary: "#45b98c",
  anchor: "#f0b95a",
} as const;

/**
 * Roads and buildings carry no data value — they are there so a hex can be
 * placed against a street and a footprint. Muted ink, never a series hue, so
 * they cannot be mistaken for an encoded category.
 */
const CONTEXT_INK = "#898781";

/**
 * Bottom-to-top draw order, which is also the order the rows appear in the
 * rail. Fills first, line work last: roads over a zoning wash stay legible,
 * the reverse does not.
 */
export const TILE_LAYERS: readonly TileLayerSpec[] = [
  {
    id: "zoning",
    label: "Zoning",
    archive: "zoning",
    sourceId: "wh-zoning",
    opacityProperty: "fill-opacity",
    defaultOpacity: 0.5,
    style: {
      id: "wh-zoning-fill",
      type: "fill",
      source: "wh-zoning",
      "source-layer": "zoning",
      paint: {
        "fill-color": [
          "match",
          ["get", "zone_class"],
          "industrial",
          ZONING_COLORS.industrial,
          "commercial",
          ZONING_COLORS.commercial,
          "residential",
          ZONING_COLORS.residential,
          // `agricultural` and `other` both land here — see ZONING_COLORS.
          ZONING_COLORS.other,
        ],
      },
    },
    legend: [
      { label: "Industrial", hex: ZONING_COLORS.industrial },
      { label: "Commercial", hex: ZONING_COLORS.commercial },
      { label: "Residential", hex: ZONING_COLORS.residential },
      { label: "Other / agricultural", hex: ZONING_COLORS.other },
    ],
  },
  {
    id: "flood",
    label: "Flood zones",
    archive: "flood",
    sourceId: "wh-flood",
    opacityProperty: "fill-opacity",
    defaultOpacity: 0.6,
    style: {
      id: "wh-flood-fill",
      type: "fill",
      source: "wh-flood",
      "source-layer": "flood",
      paint: {
        // Compared as a string: `in_sfha` is written as a real boolean, but
        // `to-string` also covers an archive rebuilt from a source that
        // encodes it as text, and a miss here would silently paint the whole
        // floodplain as moderate risk.
        "fill-color": [
          "match",
          ["to-string", ["get", "in_sfha"]],
          ["true", "True", "1"],
          FLOOD_COLORS.sfha,
          FLOOD_COLORS.moderate,
        ],
      },
    },
    legend: [
      { label: "1% annual chance (SFHA)", hex: FLOOD_COLORS.sfha },
      { label: "Outside SFHA", hex: FLOOD_COLORS.moderate },
    ],
  },
  {
    id: "buildings",
    label: "Building footprints",
    archive: "buildings",
    sourceId: "wh-buildings",
    opacityProperty: "fill-opacity",
    defaultOpacity: 0.45,
    style: {
      id: "wh-buildings-fill",
      type: "fill",
      source: "wh-buildings",
      "source-layer": "buildings",
      // Matches the archive's own minimum zoom (`tiles.py` builds buildings at
      // z13–17). Without it MapLibre would overzoom the z13 tiles down to the
      // city view, which is both wasteful and unreadable.
      minzoom: 13,
      paint: {
        "fill-color": CONTEXT_INK,
      },
    },
    hint: "Visible from zoom 13",
  },
  {
    id: "roads",
    label: "Roads",
    archive: "roads",
    sourceId: "wh-roads",
    opacityProperty: "line-opacity",
    defaultOpacity: 0.7,
    style: {
      id: "wh-roads-line",
      type: "line",
      source: "wh-roads",
      "source-layer": "roads",
      layout: { "line-cap": "round", "line-join": "round" },
      // `tiles.py` keeps every OSM way carrying a `highway` tag, and most of
      // them are not drivable roads: a single z12 tile over central Austin
      // holds 24,372 features, 12,394 of them footways, plus cycleways, steps
      // and paths. Drawn as hairlines they turn the city into grey static and
      // imply a street grid that is not there. The second group — construction,
      // proposed, planned — is worse than noise on a siting map, because it
      // draws access that does not exist yet.
      //
      // This filter keeps 44% of the features in that tile. It runs
      // client-side because it costs nothing there; the archive still ships
      // them, and excluding them in `_roads` before Tippecanoe would cut the
      // 22 MB roads archive by about half. That is the real fix.
      filter: [
        "!",
        [
          "in",
          ["get", "road_class"],
          [
            "literal",
            [
              "footway",
              "path",
              "steps",
              "cycleway",
              "bridleway",
              "corridor",
              "elevator",
              "platform",
              "construction",
              "proposed",
              "planned",
            ],
          ],
        ],
      ],
      paint: {
        "line-color": CONTEXT_INK,
        // `road_class` is the raw OSM `highway` tag, so the match arms are
        // whitelists and anything unlisted falls to the default.
        //
        // Service ways get their own arm and stay sub-pixel until the street
        // scale. They survive the filter above because a driveway or a loading
        // aisle is genuine access context up close, but there are 5,975 of
        // them in that same z12 tile — at city zoom they are texture, not
        // information.
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8,
          [
            "match",
            ["get", "road_class"],
            ["motorway", "trunk"],
            1.2,
            "service",
            0,
            0.3,
          ],
          12,
          [
            "match",
            ["get", "road_class"],
            ["motorway", "trunk"],
            2.4,
            ["primary", "secondary"],
            1.4,
            "service",
            0.15,
            0.5,
          ],
          16,
          [
            "match",
            ["get", "road_class"],
            ["motorway", "trunk"],
            6,
            ["primary", "secondary"],
            3.5,
            ["tertiary", "residential"],
            2,
            1,
          ],
        ],
      },
    },
  },
  {
    id: "poi",
    label: "Points of interest",
    archive: "poi",
    sourceId: "wh-poi",
    opacityProperty: "circle-opacity",
    defaultOpacity: 0.9,
    style: {
      id: "wh-poi-circle",
      type: "circle",
      source: "wh-poi",
      "source-layer": "poi",
      minzoom: 10,
      paint: {
        "circle-color": [
          "match",
          ["get", "poi_kind"],
          "competitor",
          POI_COLORS.competitor,
          "complementary",
          POI_COLORS.complementary,
          "anchor",
          POI_COLORS.anchor,
          "#898781",
        ],
        // Was 2px at z10, which is a single pixel of color once the dark
        // stroke is drawn over it — effectively invisible at the zoom the
        // map opens on. The glow underlay does most of the work of making
        // these findable; the dot only has to stay crisp.
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          3.5,
          13,
          5,
          17,
          8,
        ],
        "circle-stroke-color": "#0e0e0e",
        "circle-stroke-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          0.5,
          15,
          1.5,
        ],
      },
    },
    // A blurred, larger, dimmer copy of each dot drawn underneath it. Points
    // this small lose against a dark basemap and a score wash; a soft halo
    // gives them enough area to register without inflating the dot itself,
    // which would start merging neighbours into blobs.
    underlays: [
      {
        opacityProperty: "circle-opacity",
        // Faint on purpose. At full strength the halos read as the data and
        // the dots as noise inside them, which inverts the encoding.
        opacityScale: 0.3,
        spec: {
          id: "wh-poi-glow",
          type: "circle",
          source: "wh-poi",
          "source-layer": "poi",
          minzoom: 10,
          paint: {
            "circle-color": [
              "match",
              ["get", "poi_kind"],
              "competitor",
              POI_COLORS.competitor,
              "complementary",
              POI_COLORS.complementary,
              "anchor",
              POI_COLORS.anchor,
              "#898781",
            ],
            // `circle-blur` of 1 fades the edge across the whole radius, so
            // this reads as a glow rather than a second flat ring.
            "circle-blur": 1,
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              10,
              9,
              13,
              12,
              17,
              18,
            ],
          },
        },
      },
    ],
    legend: [
      { label: "Competitor", hex: POI_COLORS.competitor },
      { label: "Complementary", hex: POI_COLORS.complementary },
      { label: "Anchor", hex: POI_COLORS.anchor },
    ],
    // The archive itself starts at z10, so this is a property of the data and
    // not of the style — it cannot be lowered without a rebuild.
    hint: "Visible from zoom 10",
  },
] as const;

/**
 * Opacity is deliberately absent from every `paint` above: the store owns it,
 * and the canvas writes it with `setPaintProperty` the moment the layer is
 * added. Duplicating the value here would let the slider and the first paint
 * disagree.
 */

/**
 * Id of the lowest MapLibre layer a spec contributes — an underlay when it has
 * one, otherwise the primary style. The score hexes anchor to this, so it has
 * to be the true bottom of the stack rather than just `style.id`.
 */
export function bottomLayerId(layer: TileLayerSpec): string {
  return layer.underlays?.[0]?.spec.id ?? layer.style.id;
}

/** Every MapLibre layer a spec contributes, bottom-first. */
export function styleLayersOf(layer: TileLayerSpec) {
  return [
    ...(layer.underlays ?? []).map((u) => ({
      spec: u.spec,
      opacityProperty: u.opacityProperty,
      opacityScale: u.opacityScale,
    })),
    { spec: layer.style, opacityProperty: layer.opacityProperty, opacityScale: 1 },
  ];
}

/** URL for MapLibre's `pmtiles://` protocol handler. */
export function archiveUrl(layer: TileLayerSpec): string {
  if (!PMTILES_BASE_URL)
    throw new Error("VITE_PMTILES_BASE_URL is not configured");
  return `pmtiles://${PMTILES_BASE_URL}/${layer.archive}.pmtiles`;
}
