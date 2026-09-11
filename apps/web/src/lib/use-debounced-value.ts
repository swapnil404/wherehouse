import { useEffect, useState } from "react";

/**
 * Trailing-edge debounce.
 *
 * The weight sliders re-color the heatmap with no network call, which is the
 * whole point of computing the composite in the browser. The cluster layers
 * cannot do that — Gi* and DBSCAN run server-side over the whole grid — so
 * feeding live slider values straight into that request would fire one round
 * trip per pointer move. Debouncing the value the request is keyed on keeps
 * the heatmap instant while the clusters catch up once the drag settles.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
