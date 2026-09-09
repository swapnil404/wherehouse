import { Label } from "@wherehouse/ui/components/label";
import { Slider } from "@wherehouse/ui/components/slider";
import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";

import { SUBSCORE_KEYS, SUBSCORE_LABELS, type Weights } from "@/lib/cells";
import { useMapStore } from "@/stores/map-store";

/**
 * Six weight sliders over the active preset.
 *
 * Recoloring is entirely local: the grid arrives as weight-independent
 * subscores, so a drag is one weighted average per cell and a repaint — no
 * request. That is the property that makes dragging feel live, and it is why
 * the API deliberately never sends a composite score.
 *
 * Raw slider values are stored; the displayed percentage is renormalized
 * against their sum, since only the ratios between weights affect the score.
 */
export default function WeightEditor({
  presetWeights,
}: {
  /** The active preset's weights from the API, or `null` while loading. */
  presetWeights: Weights | null;
}) {
  const customWeights = useMapStore((s) => s.customWeights);
  const setWeight = useMapStore((s) => s.setWeight);
  const resetWeights = useMapStore((s) => s.resetWeights);

  const effective = customWeights ?? presetWeights;
  const loading = effective == null;
  const total = SUBSCORE_KEYS.reduce((sum, key) => sum + (effective?.[key] ?? 0), 0);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h2 className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
          Weights
        </h2>
        {customWeights ? (
          <button
            type="button"
            onClick={resetWeights}
            className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <RotateCcwIcon className="size-3" />
            Reset
          </button>
        ) : (
          <span className="text-[10px] text-muted-foreground/70">preset</span>
        )}
      </div>

      <div className="mt-2 space-y-2">
        {SUBSCORE_KEYS.map((key) => {
          const raw = effective?.[key] ?? 0;
          const share = total > 0 ? (100 * raw) / total : 0;

          return (
            <div key={key}>
              <div className="flex items-baseline justify-between gap-2">
                <Label
                  htmlFor={`weight-${key}`}
                  className="truncate text-[11px] text-muted-foreground"
                >
                  {SUBSCORE_LABELS[key]}
                </Label>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {loading ? "—" : `${share.toFixed(0)}%`}
                </span>
              </div>
              <Slider
                id={`weight-${key}`}
                aria-label={`${SUBSCORE_LABELS[key]} weight`}
                disabled={loading}
                // Stored as 0-1 to match the API's scale; stepped at 0.01 so a
                // drag is smooth without producing noise in the ratios.
                value={raw}
                min={0}
                max={1}
                step={0.01}
                onValueChange={(value) => {
                  if (typeof value === "number" && effective) {
                    setWeight(key, value, effective);
                  }
                }}
              />
            </div>
          );
        })}
      </div>

      {total === 0 && !loading ? (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-destructive">
          <TriangleAlertIcon className="mt-px size-3 shrink-0" />
          All weights are zero — raise at least one to score.
        </p>
      ) : null}
    </div>
  );
}
