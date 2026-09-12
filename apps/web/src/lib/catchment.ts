import { cellsToMultiPolygon } from "h3-js";

import { FOCUS_LINE } from "./focus-mark";

/**
 * Reachability, drawn as one contour.
 *
 * This used to paint every reachable hexagon with a translucent red fill, one
 * shade per time band. It worked as a picture of coverage and failed at the
 * thing the map is for: the score colours underneath are the product, and
 * covering a third of the city with a second choropleth hid them exactly when
 * the reader was comparing a site against its surroundings. So the cells are
 * dissolved into their outline instead — the area is described by its
 * boundary and nothing inside it is recoloured.
 *
 * **One band at a time.** An earlier pass drew every band up to the selected
 * one, nested, on the theory that it read as an isochrone map. In use it read
 * as a bug: moving from 10 to 20 minutes left the 10-minute ring on screen and
 * added a second one around it, so the control looked like it was accumulating
 * outlines rather than answering a question. The panel asks "how far in 20
 * minutes", and the map now answers exactly that.
 */

export interface CatchmentBandLike {
  minutes: number;
  destinationH3Indexes: readonly string[];
}

/**
 * One dissolved boundary. `rings[0]` is the outer ring and the rest are holes
 * — pockets the road network cannot reach inside the time, which are real and
 * worth drawing.
 */
export interface CatchmentRegion {
  minutes: number;
  rings: [number, number][][];
}

/**
 * The shared focus colour, the same as the selected-cell ring — both marks
 * answer "which part of the map am I asking about", so they differ by form (a
 * single hexagon against a dissolved area) rather than by hue. See
 * [`focus-mark`](./focus-mark.ts) for why that hue is what it is.
 *
 * One weight for every band, not a ramp. The old per-band fade existed to
 * separate nested contours; with a single outline on screen it would only mean
 * that asking for a wider area got you a fainter answer.
 */
export const CATCHMENT_LINE_COLOR = FOCUS_LINE;
export const CATCHMENT_LINE_WIDTH = 2;

/**
 * Dissolve everything reachable within `minutes` into its outline.
 *
 * The set is the union of every band at or under the selected time, rebuilt
 * here rather than taken from the payload. The API's bands are cumulative
 * today, but a region built from an exclusive ring would come back as a donut
 * with a spurious inner edge where the previous band ended.
 *
 * Returns an array because one selection can dissolve into several
 * disconnected pieces — an area split by a river with no crossing inside the
 * time is genuinely two shapes, and merging them would draw a boundary across
 * water nobody can cross.
 */
export function buildCatchmentRegions(
  bands: readonly CatchmentBandLike[],
  minutes: number,
): CatchmentRegion[] {
  // Only the selected band. An unmatched `minutes` draws nothing rather than
  // falling back to a neighbouring band, so the outline can never describe a
  // different time from the one the panel is reporting numbers for.
  if (!bands.some((band) => band.minutes === minutes)) return [];

  const members = new Set<string>();
  for (const band of bands) {
    if (band.minutes > minutes) continue;
    for (const h3Index of band.destinationH3Indexes) members.add(h3Index);
  }
  if (members.size === 0) return [];

  // `true` asks for GeoJSON winding and [lng, lat] order, which is what
  // deck.gl's PolygonLayer expects.
  return cellsToMultiPolygon([...members], true).map((polygon) => ({
    minutes,
    rings: polygon as [number, number][][],
  }));
}
