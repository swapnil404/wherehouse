"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@wherehouse/ui/lib/utils";

/**
 * Sliding on/off switch.
 *
 * Distinct from `Checkbox` by role, not taste. A checkbox asks "which of
 * these", and the layer panel is exactly that — a list where several rows are
 * on at once. A switch asks "is this running", which is the shape of a single
 * binary that turns a feature and its map overlay on. Mixing the two is only
 * inconsistent if they mean the same thing, and they do not.
 *
 * **Glass, not a solid pill.** Every floating surface in this app is
 * translucent over a blur (`panelSurface`), and a switch sitting on one of
 * those cards is chrome on chrome — an opaque track would be the only solid
 * object on a panel built entirely out of glass. The off state is a barely
 * tinted well with a light border, so the card's own backdrop carries through
 * it.
 *
 * **On is the accent red, not a green.** Green is the conventional "on" and
 * this theme does not have one: `--success` exists only for the pass/fail
 * marks in the constraint checklist, and borrowing it here would make "this
 * feature is on" look like "this site passed a rule" two sections apart on the
 * same panel. The accent already means "active" everywhere else — presets,
 * tabs, analysis methods — so the switch says the same thing in the same
 * colour.
 *
 * Three details below are load-bearing and each one failed silently before it
 * was fixed. None of them is visible in a type check or a build.
 */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        // Geometry is fixed and stated once. Nothing state-dependent touches
        // the box: both states carry the same 1px border and only its *colour*
        // changes, and the thumb is out of flow (below), so there is no flex
        // child whose sizing could feed back into the track.
        "group relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border",
        "border-white/15 bg-white/[0.06] backdrop-blur-md",
        // Both states declare **two** shadows in the same order, and the off
        // state's outer one is a zero-size transparent placeholder. CSS cannot
        // interpolate between box-shadow lists of different lengths — it jumps
        // discretely — so without the placeholder the accent glow popped into
        // existence on toggle and read as the control changing size rather
        // than lighting up.
        "shadow-[0_0_0_0_rgb(255_0_0/0),inset_0_1px_2px_rgb(0_0_0/0.45)]",
        "transition-[background-color,border-color,box-shadow] duration-200 ease-out outline-none",
        "hover:border-white/25",
        "focus-visible:ring-1 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-checked:border-accent/70 data-checked:bg-accent/75",
        "data-checked:shadow-[0_0_8px_-2px_var(--accent),inset_0_1px_2px_rgb(0_0_0/0.2)]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          // Absolutely positioned rather than a flex child. The thumb exactly
          // fills the track's 14px well, so in flow it was one `flex-shrink`
          // away from being squeezed into an oval by anything else that
          // claimed space. Out of flow it cannot be resized by the track at
          // all, in either state.
          //
          // The numbers close: the padding box is 34x18 inside the 1px border,
          // so 2px of inset on the left and `translate-x-4` (16px) of travel
          // lands the 14px thumb 2px from the right. `top-1/2` less half the
          // thumb's own height centres it on the same 2px margin.
          "pointer-events-none absolute top-1/2 left-[2px] size-3.5 -translate-y-1/2 rounded-full",
          "bg-white/85 shadow-[0_1px_2px_rgb(0_0_0/0.55)]",
          // `translate`, **not** `transform`. Tailwind v4 compiles
          // `translate-x-4` to the standalone `translate` property rather than
          // a `transform: translateX()`, and they are two different animatable
          // properties: transitioning `transform` here produced valid CSS that
          // animated nothing, so the thumb teleported across the track.
          "transition-[translate,background-color] duration-200 ease-out",
          "group-data-checked:translate-x-4 group-data-checked:bg-white",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
