import { cellToLatLng } from "h3-js";

/**
 * User-drawn study areas.
 *
 * A study area is *the reader's own geometry*, not data we loaded, and that
 * distinction drives every decision in this file. It is drawn in its own hue
 * rather than borrowing the score ramp's, it is tested against cell centroids
 * rather than cell boundaries, and it filters the grid the client already
 * holds instead of asking the server to re-cut it.
 *
 * Centroid containment is the honest test. Scoring already snaps a clicked
 * point to its containing cell (§7), so a cell is either in the reader's area
 * or it is not; splitting hexes on the boundary would imply a precision the
 * res-8 grid does not have. The worst case is a cell whose centre falls just
 * outside a line drawn through it, which is about 460 m of ambiguity — the
 * same figure the catchment copy already owns up to.
 */

/** `[lng, lat]` — the order deck.gl, MapLibre and GeoJSON all agree on. */
export type Position = [number, number];

export type DrawMode = "polygon" | "radius";

export type StudyArea =
  | { kind: "polygon"; ring: Position[] }
  | { kind: "radius"; center: Position; radiusMeters: number };

/**
 * Cyan, and nothing else on this map is cyan.
 *
 * The score ramp owns dark-red through white, the analysis overlays own white
 * and grey outlines, the catchment bands own red, and the tile layers own
 * orange, purple, green and amber. A drawn boundary has to be legible on top
 * of any of them while never being mistaken for one, so it takes the one
 * channel the palette had left rather than competing inside a crowded one.
 */
export const STUDY_AREA_COLOR = "#4dd9e6";
const STUDY_AREA_RGB: [number, number, number] = [77, 217, 230];

export const STUDY_AREA_LINE: [number, number, number, number] = [...STUDY_AREA_RGB, 255];
/** Barely there. The boundary carries the meaning; the fill only says "inside". */
export const STUDY_AREA_FILL: [number, number, number, number] = [...STUDY_AREA_RGB, 26];
/** The in-progress shape is dimmer than the committed one, so "not yet" reads. */
export const STUDY_AREA_DRAFT_LINE: [number, number, number, number] = [...STUDY_AREA_RGB, 170];

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

/** Great-circle distance. Austin spans ~40 km, so the sphere is plenty. */
export function distanceMeters(a: Position, b: Position): number {
  const dLat = (b[1] - a[1]) * DEG;
  const dLng = (b[0] - a[0]) * DEG;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Ray casting, in raw degrees.
 *
 * Treating lng/lat as a plane is wrong in general and fine here: the coverage
 * area is one city, far from both poles and the antimeridian, so the error
 * against a proper spherical test is orders of magnitude below the 460 m the
 * centroid test already concedes.
 */
function pointInRing(point: Position, ring: readonly Position[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = yi > y !== yj > y;
    if (straddles && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const CIRCLE_SEGMENTS = 72;

/**
 * A radius as a ring, for drawing.
 *
 * Longitude degrees narrow with latitude, so the cosine term is not optional:
 * without it a circle drawn at Austin's 30°N renders about 15% too wide and
 * stops matching the cells the radius test actually selects.
 */
export function circleRing(center: Position, radiusMeters: number): Position[] {
  const [lng, lat] = center;
  const dLat = radiusMeters / EARTH_RADIUS_M / DEG;
  const dLng = dLat / Math.cos(lat * DEG);

  const ring: Position[] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i += 1) {
    const theta = (i / CIRCLE_SEGMENTS) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  return ring;
}

/** The outline to draw, whichever kind of area this is. */
export function studyAreaRing(area: StudyArea): Position[] {
  return area.kind === "polygon"
    ? area.ring
    : circleRing(area.center, area.radiusMeters);
}

export function studyAreaContains(area: StudyArea, position: Position): boolean {
  return area.kind === "radius"
    ? distanceMeters(area.center, position) <= area.radiusMeters
    : pointInRing(position, area.ring);
}

/**
 * Narrow a set of cells to those whose centroid falls inside the area.
 *
 * Generic over anything carrying an `h3Index`, so the heatmap cells, the
 * hotspot classifications and the underserved cells can all be cut by the
 * same boundary without three copies of the containment test.
 */
export function cellsInStudyArea<T extends { h3Index: string }>(
  cells: T[],
  area: StudyArea | null,
): T[] {
  if (!area) return cells;
  return cells.filter((cell) => {
    const [lat, lng] = cellToLatLng(cell.h3Index);
    return studyAreaContains(area, [lng, lat]);
  });
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * How far a double-click may drift and still count as one spot, in pixels.
 *
 * The browser's own double-click tolerance is a few pixels, and the map's
 * `dblclick` inherits it.
 */
export const DOUBLE_CLICK_SLOP_PX = 8;

export function pixelsApart(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Two clicks at one spot.
 *
 * MapLibre fires `click` twice before `dblclick`, so finishing a polygon by
 * double-clicking lands a second corner on top of the last real one.
 *
 * The test has to run in **screen space**, which is why this takes a
 * projection rather than comparing ground distance. A pixel is about 65 m at
 * zoom 11 and 260 m at zoom 9, so a double-click that drifts two pixels puts
 * those two corners a few hundred metres apart — any fixed metric tolerance is
 * either too tight to catch it when zoomed out or loose enough to swallow a
 * deliberate corner when zoomed in. Pixels are the units the gesture actually
 * happened in.
 */
export function withoutTrailingDuplicate(
  ring: readonly Position[],
  project: (position: Position) => ScreenPoint,
): Position[] {
  if (ring.length < 2) return [...ring];

  const last = ring[ring.length - 1];
  const previous = ring[ring.length - 2];
  return pixelsApart(project(last), project(previous)) < DOUBLE_CLICK_SLOP_PX
    ? ring.slice(0, -1)
    : [...ring];
}

/**
 * Below this a radius selects nothing, so committing one would blank the map
 * and read as a broken tool rather than an empty answer.
 */
export const MIN_RADIUS_M = 150;

/** Metric throughout, matching the map's own scale bar. */
export function formatDistance(meters: number): string {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km`
    : `${Math.round(meters / 10) * 10} m`;
}

/** What the area is, in one phrase, for the map's status line. */
export function describeStudyArea(area: StudyArea): string {
  return area.kind === "radius"
    ? `${formatDistance(area.radiusMeters)} around a point`
    : `a ${area.ring.length}-corner shape`;
}
