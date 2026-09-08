import { SCORE_BINS } from "@/lib/heatmap-palette";

/**
 * Discrete swatches, not a continuous gradient — the ramp is binned, and the
 * legend should say so. Reads left (low) to right (high), matching the
 * inverted ramp where brightness means a better site.
 */
export default function HeatmapLegend({ hasData }: { hasData: boolean }) {
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-sm" role="presentation">
        {SCORE_BINS.map((bin) => (
          <div
            key={bin.min}
            className="flex-1"
            style={{
              backgroundColor: bin.hex,
              opacity: bin.alpha / 255,
            }}
            title={`${bin.min}–${bin.max}`}
          />
        ))}
      </div>

      <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </div>

      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        {hasData
          ? "Brighter cells score higher. Lowest band is dimmed so empty areas recede."
          : "Ramp preview — no cells scored yet."}
      </p>
    </div>
  );
}
