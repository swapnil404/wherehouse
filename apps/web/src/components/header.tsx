import { Link } from "@tanstack/react-router";
import { HexagonIcon } from "lucide-react";

import UserMenu from "./user-menu";

const LINKS = [
  { to: "/", label: "Home" },
  { to: "/dashboard", label: "Dashboard" },
] as const;

/**
 * App header.
 *
 * Colors and state come from theme tokens rather than raw values, and the bar
 * matches the left rail's `bg-card` + `border-border` so the chrome reads as
 * one surface wrapping the map.
 *
 * Kept at `h-12`: the dashboard is a full-bleed map, so every pixel of header
 * is map the user does not get.
 */
export default function Header() {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4">
      <div className="flex min-w-0 items-center gap-5">
        <Link
          to="/"
          className="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-80"
        >
          <HexagonIcon className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-sm font-semibold tracking-tight">Wherehouse</span>
        </Link>

        <nav className="flex items-center gap-0.5">
          {LINKS.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              // `/` is a prefix of every route, so without an exact test Home
              // would render active while sitting on the dashboard.
              activeOptions={{ exact: to === "/" }}
              // State colors go in active/inactiveProps rather than being
              // layered over the base class: Link concatenates className, so
              // putting `text-muted-foreground` in the base and
              // `text-foreground` here would leave both applied and let CSS
              // source order decide the winner.
              className="rounded-md px-2.5 py-1 text-sm transition-colors"
              activeProps={{ className: "bg-background font-medium text-foreground shadow-sm" }}
              inactiveProps={{ className: "text-muted-foreground hover:text-foreground" }}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>

      <UserMenu />
    </header>
  );
}
