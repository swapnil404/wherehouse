import { useEffect, type RefObject } from "react";

/**
 * Closes a floating panel on Escape or on a pointer press outside it.
 *
 * Both are expected of anything that overlays a map: the panel covers the
 * thing the reader came for, so getting rid of it has to be as cheap as
 * opening it, and hunting for the close button is not cheap.
 *
 * `pointerdown` rather than `click`, so the panel is gone before the press
 * resolves and a drag that starts outside the panel pans the map from the
 * first frame instead of the second. Listeners attach only while `active`,
 * so a closed panel costs nothing.
 */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!active) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };

    const onPointerDown = (event: PointerEvent) => {
      const node = ref.current;
      if (node && !node.contains(event.target as Node)) onDismiss();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [ref, active, onDismiss]);
}
