import { cellToBoundary, cellToLatLng } from "h3-js";

/**
 * A locator beacon on the scored cell, for as long as Reach is on.
 *
 * The reach contour is white and so is the selection ring, and the contour can
 * enclose a third of the city — so the one hexagon the whole panel is about
 * became the hardest thing on the map to point at. This keeps pointing at it.
 *
 * **It runs only while Reach is on.** That is the situation it exists for, and
 * it is also what keeps it honest against WCAG 2.2.2: motion that starts on
 * its own and outlasts five seconds needs a way to stop it, and the switch
 * that started it is exactly that. With Reach off there is nothing to get lost
 * in, so the cell keeps its plain steady ring.
 *
 * **Rings travel outward rather than flashing on and off.** A marker that
 * blinks is invisible half the time, which is the opposite of findable if the
 * reader's eye lands during an off beat. The selection ring underneath never
 * moves or fades — only these do — so the cell stays marked at every instant.
 */

/** One ring's lifetime. Slow enough to read as a beacon, not a strobe. */
export const PULSE_PERIOD_MS = 1200;

/** Resting ring, which the beacon draws on top of and never replaces. */
export const RING_WIDTH = 3;
export const RING_COLOR: [number, number, number, number] = [255, 255, 255, 255];

export interface PulseFrame {
  /** Hexagon radius multiplier for the travelling ring. */
  scale: number;
  /** Alpha of the travelling ring, 0-255. */
  alpha: number;
}

/**
 * One frame of the beacon, from milliseconds since it started.
 *
 * Takes elapsed time rather than a 0-1 progress because the animation has no
 * end to measure against any more — it wraps on the period for as long as the
 * switch is on. Negative input is folded back into range so a clock that jumps
 * backwards cannot produce a ring at negative scale.
 *
 * Alpha decays on a square rather than linearly: a ring fading at a constant
 * rate reads as a solid shape losing contrast, while an eased one reads as
 * something travelling away.
 */
export function pulseFrame(elapsedMs: number): PulseFrame {
  const wrapped = ((elapsedMs % PULSE_PERIOD_MS) + PULSE_PERIOD_MS) % PULSE_PERIOD_MS;
  const t = wrapped / PULSE_PERIOD_MS;
  const fade = (1 - t) ** 2;

  return { scale: 1 + 0.75 * t, alpha: Math.round(230 * fade) };
}

/**
 * The cell's own outline, pushed out from its centre.
 *
 * Scaled here rather than with `H3HexagonLayer`'s `coverage` prop, which only
 * applies in that layer's flat rendering mode — whether it is used at all is
 * decided per dataset by `highPrecision: 'auto'`, so relying on it would make
 * the beacon quietly stop working on some grids and not others.
 *
 * Scaling in degrees stretches the shape very slightly against the ground at
 * Austin's latitude. That is invisible on a hexagon 460 m across, and this is
 * a pointer rather than a measurement.
 */
export function expandedHexRing(h3Index: string, scale: number): [number, number][] {
  const [lat, lng] = cellToLatLng(h3Index);

  // `true` gives GeoJSON [lng, lat] order, which is what deck.gl expects.
  return cellToBoundary(h3Index, true).map(([x, y]) => [
    lng + (x - lng) * scale,
    lat + (y - lat) * scale,
  ]);
}
