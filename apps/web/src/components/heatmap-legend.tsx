import { SCORE_BINS } from "@/lib/heatmap-palette";
import { useMapStore } from "@/stores/map-store";

import { panelSurface, text } from "./panel-styles";
import SectionLabel from "./section-label";

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
  const visible = useMapStore((s) => s.layers.heatmap.visible);

  if (!visible) return null;

  const span = SCORE_BINS[SCORE_BINS.length - 1].max - SCORE_BINS[0].min;

  return (
    /* Back on the left edge with everything else. The offset here existed
       only to clear the zoom bar, which now sits at the bottom centre; the
       scale bar is all that is left in this corner and it occupies the
       bottom strip, below `bottom-11`. */
    <div className="pointer-events-none absolute bottom-11 left-4 z-10">
      <div className={`pointer-events-auto w-60 p-3 ${panelSurface}`}>
        <div className="flex items-baseline justify-between gap-2">
          <SectionLabel>Score</SectionLabel>
          {stats ? (
            <span className={`font-mono ${text.numeric}`}>{stats.total} places</span>
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
                    ? `${bin.min} to ${bin.max}`
                    : `${bin.min} to ${bin.max}: ${count} cells (${(
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
        <div className={`relative mt-1 h-3 font-mono ${text.numeric}`}>
          <span className="absolute left-0">{SCORE_BINS[0].min}</span>
          {SCORE_BINS.slice(1).map((bin) => (
            <span
              key={bin.min}
              className="absolute -translate-x-1/2"
              style={{
                left: `${((bin.min - SCORE_BINS[0].min) / span) * 100}%`,
              }}
            >
              {bin.min}
            </span>
          ))}
          <span className="absolute right-0">100</span>
        </div>

        {/* Only the empty state needs words. With a grid loaded the header
            already gives the cell count, and the eligibility tally belongs
            beside the checkbox that controls it, not under a colour ramp. */}
        {stats ? null : (
          <p className={`mt-2 ${text.hint}`}>Colour key. Nothing scored yet.</p>
        )}
      </div>
    </div>
  );
}
