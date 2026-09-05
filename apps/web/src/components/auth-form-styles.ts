/**
 * The shared UI package is generated in shadcn's `base-lyra` style: square
 * corners, 12px type, 32px-tall controls. The auth screens follow the stock
 * `login-01` proportions instead — rounded card, 24px padding, 14px type,
 * 40px-tall controls — so the overrides live here once and both the login and
 * sign-up cards pull from the same set rather than drifting apart.
 */
export const authForm = {
  /** `--card-spacing` drives the card's own padding and its header/content padding. */
  card: "rounded-xl text-sm [--card-spacing:--spacing(6)]",
  title: "text-base font-bold",
  description: "text-sm",
  fieldGroup: "gap-6",
  label: "text-sm font-semibold",
  input: "h-10 rounded-md px-3 text-sm md:text-sm",
  button: "h-10 rounded-md text-sm",
  footnote: "text-sm",
  error: "text-sm",
} as const;
