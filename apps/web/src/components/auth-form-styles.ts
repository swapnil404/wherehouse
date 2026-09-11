/**
 * Shared overrides for the two auth cards.
 *
 * The UI package is tuned for the dashboard: 12px type and 32px-tall controls,
 * because the layer rail fits about thirty of them in a 256px column. The auth
 * screens are one card holding three fields, so they take the roomier stock
 * `login-01` proportions instead: 24px padding, 14px type, 40px controls. Both
 * cards pull from this one set rather than each carrying its own copy.
 *
 * Radius is deliberately absent. It used to be overridden here to `rounded-xl`
 * on the card and `rounded-md` on the controls, back when the package shipped
 * square corners and the app rounded them per-surface. The package now defines
 * one radius scale and these surfaces inherit it, so overriding would put the
 * auth card on a corner radius nothing else in the app uses.
 */
export const authForm = {
  /** `--card-spacing` drives the card's own padding and its header/content padding. */
  card: "text-sm [--card-spacing:--spacing(6)]",
  title: "text-base font-semibold",
  description: "text-sm text-muted-foreground",
  fieldGroup: "gap-5",
  label: "text-sm font-medium",
  input: "h-10 px-3 text-sm md:text-sm",
  button: "h-10 text-sm",
  footnote: "text-sm text-muted-foreground",
  error: "text-sm",
} as const;
