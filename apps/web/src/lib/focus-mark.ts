/**
 * The colour of "the part of the map you are asking about".
 *
 * Three marks share it — the scored cell's ring, the beacon pinging that ring,
 * and the reach contour around it. They answer one question between them and
 * differ by form, not hue: a hexagon, a travelling ring, a dissolved boundary.
 * Defined once here rather than three times so they cannot drift apart.
 *
 * **White, with one known overlap, kept deliberately.** The compare tray's
 * second slot is `#f4f4f5`, so a compared site can be outlined in near-white
 * beside a white selection ring inside a white reach contour. That was raised
 * and Dave chose to keep white: the three marks are rarely all on screen at
 * once, and white is the neutral that reads over every ramp on the map without
 * claiming a hue that means something else.
 *
 * This was briefly changed to a saturated yellow and changed back, so if the
 * overlap comes up again the options have already been walked: every other
 * channel is spoken for — the score ramp owns red through white, the air
 * quality ramp owns blue, drawn study areas own cyan, the analysis overlays own
 * white and grey, and the tile layers own orange, violet, green and amber —
 * which leaves yellow as the only free one. Change it here if it ever needs to
 * move; nothing downstream hardcodes it.
 */
export const FOCUS_RGB: [number, number, number] = [255, 255, 255];

/** Deck.gl line colour, fully opaque. */
export const FOCUS_LINE: [number, number, number, number] = [...FOCUS_RGB, 255];

/** Deck.gl line colour at a given alpha, for the beacon's fading rings. */
export function focusLineAt(alpha: number): [number, number, number, number] {
  return [...FOCUS_RGB, alpha];
}
