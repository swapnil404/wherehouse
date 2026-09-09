import { SCORE_BINS } from "@/lib/heatmap-palette";
import { useMapStore } from "@/stores/map-store";

/**
 * Floating score legend, bottom-left of the map.
 *
 * Cartographic convention puts the legend on the map it explains rather than
 * in a settings rail — and it sits above MapLibre's scale control, which owns
 * the very bottom-left corner.
 *
 * Bands are sized to their score span, not given equal pixels: the ramp's
 * interior edges are unequal (see `SCORE_BINS`), and equal widths would
 * misrepresent a 5-point band as the same size as a 46-point one.
 *
 * Per-band cell counts live in the hover title instead of a visible six-row
 * table — the distribution is worth having, but not worth six rows of chrome
 * on a floating card.
 */
export default function HeatmapLegend() {
  const stats = useMapStore((s) => s.heatmapStats);

  const span = SCORE_BINS[SCORE_BINS.length - 1].max - SCORE_BINS[0].min;

  return (
    <div className="pointer-events-none absolute bottom-11 left-4 z-10">
      <div className="pointer-events-auto w-60 rounded-lg border border-border bg-card/95 p-3 shadow-xl backdrop-blur">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            Site score
          </h2>
          {stats ? (
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {stats.total} cells
            </span>
          ) : null}
        </div>

        <div className="mt-2 flex h-2.5 overflow-hidden rounded-sm">
          {SCORE_BINS.map((bin, index) => {
            const count = stats?.counts[index];
            return (
              <div
                key={bin.min}
                style={{
                  flexGrow: bin.max - bin.min,
                  backgroundColor: bin.hex,
                  opacity: bin.alpha / 255,
                }}
                title={
                  count == null
                    ? `${bin.min}–${bin.max}`
                    : `${bin.min}–${bin.max}: ${count} cells (${(
                        (100 * count) /
                        (stats?.total || 1)
                      ).toFixed(0)}%)`
                }
              />
            );
          })}
        </div>

        {/* Interior edges positioned proportionally so each number sits under
            the boundary it marks. */}
        <div className="relative mt-1 h-3 text-[10px] tabular-nums text-muted-foreground">
          <span className="absolute left-0">{SCORE_BINS[0].min}</span>
          {SCORE_BINS.slice(1).map((bin) => (
            <span
              key={bin.min}
              className="absolute -translate-x-1/2"
              style={{ left: `${((bin.min - SCORE_BINS[0].min) / span) * 100}%` }}
            >
              {bin.min}
            </span>
          ))}
          <span className="absolute right-0">100</span>
        </div>

        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {stats
            ? `${stats.eligible} pass every constraint`
            : "Ramp preview — no cells scored yet"}
        </p>
      </div>
    </div>
  );
}
