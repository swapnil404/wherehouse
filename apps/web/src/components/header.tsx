import { Link } from "@tanstack/react-router";
import { HexagonIcon } from "lucide-react";

import UserMenu from "./user-menu";

/**
 * App header.
 *
 * The nav list is gone rather than restyled. It held "Home" and "Dashboard",
 * but `routes/index.tsx` is a `beforeLoad` redirect straight to `/dashboard`,
 * so both entries resolved to the same screen and one of them flashed a
 * redirect on the way. With the wordmark also pointing home that was three
 * controls for one destination. Put the list back when a second real route
 * exists; until then the wordmark is the whole of it.
 *
 * Kept at `h-12`: the dashboard is a full-bleed map, so every pixel of header
 * is map the user does not get.
 */
export default function Header() {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4">
      <Link
        to="/dashboard"
        className="flex shrink-0 items-center gap-2 rounded-md transition-opacity hover:opacity-80 focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <HexagonIcon className="size-4 text-primary" aria-hidden />
        <span className="text-[13px] font-semibold tracking-tight">Wherehouse</span>
      </Link>

      <UserMenu />
    </header>
  );
}
