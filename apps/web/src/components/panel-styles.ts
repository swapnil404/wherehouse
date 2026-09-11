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
 * The translucent fill and backdrop blur stay inside a crisp, low-contrast
 * border. That follows the reference theme's card treatment without losing
 * the glass material that separates map controls from the basemap.
 */

/** Floating card over the map: legend, preset picker, score panel. */
export const panelSurface =
  "rounded-lg border border-white/10 bg-black/70 backdrop-blur-xl shadow-xl";

/** Small floating status pill, bottom-centre of the map. */
export const panelPill =
  "flex items-center gap-1.5 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-xs backdrop-blur-xl";

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
 * Active options use the theme's solid accent red everywhere, so presets,
 * tabs, filters, and analysis methods share one unmistakable selected state.
 */
export const segment = {
  base: "rounded-md px-3 py-1.5 text-xs transition-colors",
  active: "bg-accent font-medium text-accent-foreground",
  inactive: "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
} as const;
