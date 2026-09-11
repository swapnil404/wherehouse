import { useEffect } from "react";

/**
 * Closes a floating panel when Escape is pressed.
 *
 * Escape only, deliberately. This started out also closing on any pointer
 * press outside the panel, which is the conventional popover behaviour and
 * was wrong here: the thing most likely to be outside the panel is the map,
 * and clicking the map is the app's primary action. Opening Layers, ticking
 * an overlay, then clicking a hexagon to score it made the panel vanish
 * every time, so the reader had to reopen it for each change. A panel over a
 * map has to survive the map being used.
 *
 * The listener attaches only while `active`, so a closed panel costs nothing.
 */
export function useEscapeToClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, onClose]);
}
