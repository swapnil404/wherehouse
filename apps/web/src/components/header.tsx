import { Link } from "@tanstack/react-router";
import { MapPinIcon } from "lucide-react";

import ProjectSwitcher from "./project-switcher";
import UserMenu from "./user-menu";

/**
 * App header.
 *
 * The nav list is gone rather than restyled. It held "Home" and "Dashboard",
 * which both resolved to the same screen, and one of them flashed a redirect on
 * the way. Two real destinations exist now — the welcome page and the map — but
 * the wordmark reaches the first and the map is where you already are, so a list
 * would still be naming a screen nobody needs a link to.
 *
 * Kept at `h-12`: the dashboard is a full-bleed map, so every pixel of header
 * is map the user does not get.
 */
export default function Header() {
  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center border-b border-white/10 bg-black/95 px-3 shadow-[0_1px_24px_rgb(0_0_0/0.35)] backdrop-blur-xl sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* To the welcome page, not the map. The map is the screen you are
            almost certainly on when you can see this, so pointing the wordmark
            at it makes the app's one always-visible control a no-op. The
            welcome page is the way back to starting over. */}
        <Link
          to="/welcome"
          aria-label="Wherehouse home"
          className="flex shrink-0 items-center rounded-md outline-none transition-opacity hover:opacity-80 focus-visible:ring-1 focus-visible:ring-ring/50"
        >
          <span className="font-display text-sm font-semibold uppercase tracking-[0.09em]">Wherehouse</span>
        </Link>

        <span className="hidden h-5 w-px bg-white/10 sm:block" aria-hidden />
        <div className="hidden min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <MapPinIcon className="size-3.5 text-primary/80" aria-hidden />
          <span className="truncate">Austin, Texas</span>
          <span className="text-white/20">/</span>
          <span className="truncate text-foreground/75">Site intelligence</span>
        </div>

        {/* Next to the location, not next to the account: a project supplies
            the preset and weights the map is drawn from, so it belongs with
            the other statements about what is on screen. */}
        <span className="hidden h-5 w-px bg-white/10 sm:block" aria-hidden />
        <ProjectSwitcher />
      </div>

      <UserMenu />
    </header>
  );
}
