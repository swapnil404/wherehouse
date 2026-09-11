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

import { text } from "./panel-styles";
import SectionLabel from "./section-label";

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
      {/* Accent for gains, destructive for drags. Both are theme tokens now,
          so the bar cannot drift from the rest of the chrome the way the two
          hand-picked hexes here previously did. Neither leans on hue alone:
          each is also signed by the side of the baseline it grows from. */}
      <div
        className={`absolute inset-y-0 rounded-full ${positive ? "bg-primary" : "bg-destructive"}`}
        style={{ width: `${width}%`, [positive ? "left" : "right"]: "50%" }}
      />
    </div>
  );
}

function formatConstraintValue(value: unknown): string {
  if (Array.isArray(value))
    return value.map(formatConstraintValue).join(" or ");
  if (value === null || value === undefined) return "-";
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

  // No positioning or elevation here any more. This is the body of the
  // results dock's "This site" tab, so the dock owns width, scrolling and
  // surface. That also retires the `top-20` / `xl:top-4` breakpoint dance,
  // which only existed because a floating panel and the centred preset
  // picker fought for the same strip of map below ~1068px.
  return (
    <div className="p-4">
      {isPending ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <LoaderCircleIcon className="size-4 shrink-0 animate-spin" />
          Scoring…
        </p>
      ) : error ? (
        <div>
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-destructive">
            <TriangleAlertIcon className="size-4 shrink-0" />
            Location unavailable
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">{error.message}</p>
        </div>
      ) : data ? (
        <div>
          <div className="flex items-end justify-between gap-3">
            <div>
              <SectionLabel as="p">Score</SectionLabel>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-3xl font-medium tracking-tight tabular-nums">
                  {data.score == null ? "-" : data.score.toFixed(1)}
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
              className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${
                data.eligible
                  ? "bg-success/12 text-success ring-1 ring-success/25"
                  : "bg-warning/12 text-warning ring-1 ring-warning/25"
              }`}
            >
              {data.eligible ? (
                <CircleCheckIcon className="size-3.5 shrink-0" />
              ) : (
                <CircleAlertIcon className="size-3.5 shrink-0" />
              )}
              {data.eligible ? "Workable" : "Breaks a rule"}
            </span>
          </div>

          {percentile != null ? (
            <p className={`mt-1 ${text.hint}`}>
              Beats {percentile.toFixed(0)}% of the {analytics!.cellCount} places scored in Austin
            </p>
          ) : null}

          {waterfall ? (
            <div className="mt-4">
              <SectionLabel as="p">Why this score</SectionLabel>
              <div className={`mt-1.5 flex items-baseline justify-between ${text.caption}`}>
                <span>Typical place</span>
                <span className="font-mono tabular-nums">{waterfall.baseline.toFixed(1)}</span>
              </div>

              <div className="mt-1.5 space-y-1.5">
                {waterfall.contributions.map((c) => (
                  <div
                    key={c.key}
                    className="flex items-center gap-2 text-[11px]"
                  >
                    <span className="w-24 shrink-0 truncate text-muted-foreground">
                      {SUBSCORE_LABELS[c.key as SubscoreKey]}
                    </span>
                    <DeltaBar delta={c.delta} scale={scale} />
                    <span
                      className={`w-10 shrink-0 text-right font-mono tabular-nums ${
                        c.delta >= 0 ? "text-primary" : "text-destructive"
                      }`}
                    >
                      {c.delta >= 0 ? "+" : ""}
                      {c.delta.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-baseline justify-between border-t border-border pt-1.5 text-[11px]">
                <span className="text-muted-foreground">This site</span>
                <span className="font-mono font-medium tabular-nums">
                  {waterfall.total.toFixed(1)}
                </span>
              </div>
            </div>
          ) : null}

          <div className="mt-4">
            <SectionLabel as="p">Hard rules</SectionLabel>
            <div className="mt-1.5 space-y-1.5">
              {data.constraints.map((constraint) => (
                <div
                  key={constraint.id}
                  className="flex items-start gap-2 text-xs"
                >
                  {constraint.pass ? (
                    <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-success" />
                  ) : (
                    <XIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  )}
                  <span className="min-w-0 text-muted-foreground">
                    <span className="block">{constraint.label}</span>
                    <span className="mt-0.5 block font-mono text-[10.5px] text-muted-foreground">
                      {formatConstraintValue(constraint.actual)} vs{" "}
                      {formatConstraintValue(constraint.required)} required
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-4 truncate border-t border-border pt-2.5 font-mono text-[10.5px] text-muted-foreground">
            {data.h3_index}
          </p>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Click anywhere in Austin to score it.
        </p>
      )}
    </div>
  );
}
