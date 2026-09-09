import {
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

import {
  SUBSCORE_LABELS,
  type SubscoreKey,
  type Subscores,
  type Weights,
} from "@/lib/cells";
import {
  computeWaterfall,
  gradeFor,
  percentileOf,
  type GridAnalytics,
} from "@/lib/score-analytics";

/**
 * Floating score panel.
 *
 * Structural props rather than the tRPC mutation object, so the panel can be
 * driven by a real query, a fixture, or nothing at all.
 *
 * Everything beyond the raw score comes from the grid the map already has —
 * the grade is a percentile within the loaded dataset and the breakdown is
 * measured against its per-layer means, so no extra request is needed to say
 * whether a number is good.
 */

interface ScoreData {
  h3_index: string;
  score: number | null;
  eligible: boolean;
  subscores: Subscores;
  constraints: readonly {
    id: string;
    label: string;
    actual?: unknown;
    required?: unknown;
    pass: boolean;
  }[];
}

interface ScorePanelProps {
  isPending: boolean;
  error: { message: string } | null;
  data: ScoreData | null;
  analytics: GridAnalytics | null;
  weights: Weights | null;
}

/** Signed contribution bar, centred on the baseline. */
function DeltaBar({ delta, scale }: { delta: number; scale: number }) {
  const width = scale > 0 ? (Math.abs(delta) / scale) * 50 : 0;
  const positive = delta >= 0;

  return (
    <div className="relative h-1.5 flex-1 rounded-full bg-muted/60">
      <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
      <div
        className="absolute inset-y-0 rounded-full"
        style={{
          width: `${width}%`,
          [positive ? "left" : "right"]: "50%",
          // Ramp brightest step for gains, status-critical for drags: the two
          // read as opposite without relying on hue alone, since each is also
          // signed by which side of the baseline it sits on.
          backgroundColor: positive ? "#86b6ef" : "#d03b3b",
        }}
      />
    </div>
  );
}

function formatConstraintValue(value: unknown): string {
  if (Array.isArray(value))
    return value.map(formatConstraintValue).join(" or ");
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function ScorePanel({
  isPending,
  error,
  data,
  analytics,
  weights,
}: ScorePanelProps) {
  const ready = data && analytics && weights;
  const percentile =
    ready && data.score != null
      ? percentileOf(data.score, analytics.sortedScores)
      : null;
  const waterfall = ready
    ? computeWaterfall(data.subscores, analytics.subscoreMeans, weights)
    : null;
  const scale = waterfall
    ? Math.max(...waterfall.contributions.map((c) => Math.abs(c.delta)), 0.01)
    : 0;

  return (
    // `top-20` below xl drops the panel under the centred preset picker: at a
    // map width under ~1068px a centred picker and a 20rem right-aligned panel
    // would otherwise overlap. At xl and above there is room for both at top-4.
    <aside className="scrollbar-subtle pointer-events-auto absolute top-20 right-16 max-h-[calc(100%-6rem)] w-80 max-w-[calc(100%-5rem)] overflow-y-auto rounded-lg border border-border bg-card/95 p-4 shadow-xl backdrop-blur xl:top-4 xl:max-h-[calc(100%-2rem)]">
      {isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircleIcon className="size-4 shrink-0 animate-spin" />
          Scoring this location…
        </p>
      ) : error ? (
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
            <TriangleAlertIcon className="size-4 shrink-0" />
            Location unavailable
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
        </div>
      ) : data ? (
        <div>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                Site score
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tabular-nums">
                  {data.score == null ? "—" : data.score.toFixed(1)}
                </span>
                {percentile != null ? (
                  <span className="text-lg font-medium text-muted-foreground">
                    {gradeFor(percentile)}
                  </span>
                ) : null}
              </div>
            </div>
            {/* Icon + label, never color alone — this is a status cue, and hue
                on its own does not survive colorblindness or a grayscale print. */}
            <span
              className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs"
              style={
                data.eligible
                  ? { backgroundColor: "#0ca30c1f", color: "#4ade80" }
                  : { backgroundColor: "#fab2191f", color: "#fbbf24" }
              }
            >
              {data.eligible ? (
                <CircleCheckIcon className="size-3.5 shrink-0" />
              ) : (
                <CircleAlertIcon className="size-3.5 shrink-0" />
              )}
              {data.eligible ? "Eligible" : "Constraints failed"}
            </span>
          </div>

          {percentile != null ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Better than {percentile.toFixed(0)}% of {analytics!.cellCount}{" "}
              Austin cells
            </p>
          ) : null}

          {waterfall ? (
            <div className="mt-4">
              <p className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                Why
              </p>
              <div className="mt-1 flex items-baseline justify-between text-[11px] text-muted-foreground">
                <span>Average cell</span>
                <span className="tabular-nums">
                  {waterfall.baseline.toFixed(1)}
                </span>
              </div>

              <div className="mt-1.5 space-y-1.5">
                {waterfall.contributions.map((c) => (
                  <div
                    key={c.key}
                    className="flex items-center gap-2 text-[11px]"
                  >
                    <span className="w-20 shrink-0 truncate text-muted-foreground">
                      {SUBSCORE_LABELS[c.key as SubscoreKey]}
                    </span>
                    <DeltaBar delta={c.delta} scale={scale} />
                    <span
                      className="w-10 shrink-0 text-right tabular-nums"
                      style={{ color: c.delta >= 0 ? "#86b6ef" : "#e66767" }}
                    >
                      {c.delta >= 0 ? "+" : ""}
                      {c.delta.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-baseline justify-between border-t border-border pt-1.5 text-[11px]">
                <span className="text-muted-foreground">This site</span>
                <span className="font-medium tabular-nums">
                  {waterfall.total.toFixed(1)}
                </span>
              </div>
            </div>
          ) : null}

          <div className="mt-4">
            <p className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              Constraints
            </p>
            <div className="mt-1.5 space-y-1.5">
              {data.constraints.map((constraint) => (
                <div
                  key={constraint.id}
                  className="flex items-start gap-2 text-xs"
                >
                  {constraint.pass ? (
                    <CheckIcon
                      className="mt-0.5 size-3.5 shrink-0"
                      style={{ color: "#0ca30c" }}
                    />
                  ) : (
                    <XIcon
                      className="mt-0.5 size-3.5 shrink-0"
                      style={{ color: "#d03b3b" }}
                    />
                  )}
                  <span className="min-w-0 text-muted-foreground">
                    <span className="block">{constraint.label}</span>
                    <span className="block text-[10px] text-muted-foreground/70">
                      Actual: {formatConstraintValue(constraint.actual)} ·
                      Required: {formatConstraintValue(constraint.required)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-3 truncate font-mono text-[10px] text-muted-foreground/60">
            {data.h3_index}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Click anywhere in Austin to score that location.
        </p>
      )}
    </aside>
  );
}
