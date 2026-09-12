import { measureMeta } from "@/lib/heatmap-palette";
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
 * Bands are sized to their span, not given equal pixels: the score ramp's
 * interior edges are unequal (see `SCORE_BINS`), and equal widths would
 * misrepresent a 5-point band as the same size as a 46-point one. The air
 * quality ramp *is* evenly cut, so the same rule renders it as six equal
 * blocks without a special case.
 *
 * Per-band cell counts live in the hover title instead of a visible six-row
 * table — the distribution is worth having, but not worth six rows of chrome
 * on a floating card.
 */
export default function HeatmapLegend() {
  const stats = useMapStore((s) => s.heatmapStats);
  const visible = useMapStore((s) => s.layers.heatmap.visible);
  const measure = measureMeta(useMapStore((s) => s.gridMeasure));

  if (!visible) return null;

  const bins = measure.bins;
  const minScore = bins[0].min;
  const maxScore = bins[bins.length - 1].max;

  return (
    /* Back on the left edge with everything else. The offset here existed
       only to clear the zoom bar, which now sits at the bottom centre; the
       scale bar is all that is left in this corner and it occupies the
       bottom strip, below `bottom-11`. */
    <div className="pointer-events-none absolute bottom-11 left-4 z-10">
      <div className={`pointer-events-auto w-60 p-3 ${panelSurface}`}>
        <div className="flex items-baseline justify-between gap-2">
          <SectionLabel>{measure.label}</SectionLabel>
          {stats ? (
            <span className={text.numeric}>{stats.total} cells</span>
          ) : null}
        </div>

        <div className="mt-2 flex h-2.5 overflow-hidden rounded-sm">
          {bins.map((bin, index) => {
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

        {/* Three stable ticks remain legible in the compact legend. Exact bin
            ranges and counts are still available by hovering each segment. */}
        <div className={`mt-1 flex justify-between ${text.numeric}`}>
          <span>{minScore}</span>
          <span>{(minScore + maxScore) / 2}</span>
          <span>{maxScore}</span>
        </div>

        {/* The score ramp needs no words: the header gives the cell count and
            the whole product is about that number. Air quality does, because
            the scale is a rank within Austin rather than an AQI reading, and
            a reader who knows what AQI numbers usually mean would otherwise
            read the bright end exactly backwards. */}
        {measure.note ? (
          <p className={`mt-2 ${text.hint}`}>{measure.note}</p>
        ) : null}

        {stats ? null : (
          <p className={`mt-2 ${text.hint}`}>Colour key. Nothing scored yet.</p>
        )}
      </div>
    </div>
  );
}
