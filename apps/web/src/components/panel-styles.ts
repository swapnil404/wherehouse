/**
 * Shared chrome for everything that floats over or docks beside the map.
 *
 * These strings existed before as copy-paste: the same
 * `rounded-lg border border-border bg-card/95 p-3 shadow-xl backdrop-blur`
 * appeared in the legend, the preset picker and the score panel, and the same
 * uppercase micro-heading appeared inline in four files. Any edit had to be
 * made in every copy or the surfaces drifted, which is how the app ended up
 * with three slightly different floating cards.
 *
 * Two things changed in the values themselves:
 *
 * `bg-card/95` plus `backdrop-blur` was a contradiction. At 95% opacity there
 * is nothing left to blur, so the filter cost a compositor layer and bought
 * nothing. The panels now sit at 80% over `--popover`, which is the same fill
 * the map's own tooltips use, with a real blur behind them. Floating chrome
 * and map-spawned chrome become the same material.
 *
 * `shadow-xl` is a black blur, and a black blur on a near-black basemap is
 * invisible except as mud around the edge. Elevation on this surface comes
 * from the hairline ring and the blur instead, with a long soft shadow only
 * to lift the card off the map rather than to draw a box around it.
 */

/** Floating card over the map: legend, preset picker, score panel. */
export const panelSurface =
  "rounded-lg bg-popover/80 ring-1 ring-border backdrop-blur-md shadow-xl";

/** Small floating status pill, bottom-centre of the map. */
export const panelPill =
  "flex items-center gap-1.5 rounded-full bg-popover/80 px-3 py-1.5 text-xs ring-1 ring-border backdrop-blur-md";

/**
 * Type scale.
 *
 * The rail previously mixed `text-[10px]`, `text-[11px]`, `text-xs` and
 * `text-sm` with no rule about which meant what, so a section heading and a
 * caveat could land on the same size while two captions differed by a pixel.
 * Four steps, each with one job:
 *
 *   label    section headings, uppercase
 *   body     control labels, the things you click
 *   caption  values, counts, legend entries
 *   hint     caveats and secondary explanation
 *
 * `hint` is `text-muted-foreground` at full strength rather than the old
 * `text-muted-foreground/70`. That dilution measured 3.63:1 against the rail,
 * below the 4.5:1 AA floor, at 11px where the floor actually matters.
 */
export const text = {
  label: "text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground",
  body: "text-[13px] text-foreground",
  caption: "text-[11px] text-muted-foreground",
  hint: "text-[11px] leading-snug text-muted-foreground",
  /** Any number that sits in a column and updates live. */
  numeric: "text-[11px] tabular-nums text-muted-foreground",
} as const;

/**
 * Selected state for the segmented controls (preset picker, hotspot method).
 *
 * Carried by an accent ring over a faint accent wash, with the label left at
 * `--foreground`. The obvious alternative, the theme's own
 * `bg-accent` / `text-accent-foreground` pairing, is a solid fill of the
 * accent red with white text, and that measures 4.00:1. These labels are
 * 12px, so they need 4.5:1. Keeping the text on the card instead of on the
 * fill puts it at 19.8:1 and still spends the accent on the thing the accent
 * is for, which is showing you which one is live.
 */
export const segment = {
  base: "rounded-md px-3 py-1.5 text-xs transition-colors",
  active: "bg-accent/15 font-medium text-foreground ring-1 ring-accent",
  inactive: "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
} as const;
