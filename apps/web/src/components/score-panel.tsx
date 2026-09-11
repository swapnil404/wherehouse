import {
  CheckIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

import score0 from "@/assets/score-font/0.png";
import score1 from "@/assets/score-font/1.png";
import score2 from "@/assets/score-font/2.png";
import score3 from "@/assets/score-font/3.png";
import score4 from "@/assets/score-font/4.png";
import score5 from "@/assets/score-font/5.png";
import score6 from "@/assets/score-font/6.png";
import score7 from "@/assets/score-font/7.png";
import score8 from "@/assets/score-font/8.png";
import score9 from "@/assets/score-font/9.png";
import scoreDot from "@/assets/score-font/dot.png";
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

const SCORE_GLYPHS = {
  "0": score0,
  "1": score1,
  "2": score2,
  "3": score3,
  "4": score4,
  "5": score5,
  "6": score6,
  "7": score7,
  "8": score8,
  "9": score9,
  ".": scoreDot,
} as const;

function ScoreValue({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-4xl font-semibold">-</span>;
  }

  const formatted = value.toFixed(1);

  return (
    <span
      aria-label={formatted}
      className="inline-flex h-10 items-end gap-0.5"
      role="img"
    >
      {[...formatted].map((glyph, index) => (
        <img
          alt=""
          aria-hidden="true"
          className="h-10 w-auto select-none invert dark:invert-0"
          draggable={false}
          key={`${glyph}-${index}`}
          src={SCORE_GLYPHS[glyph as keyof typeof SCORE_GLYPHS]}
        />
      ))}
    </span>
  );
}

/** Signed contribution bar, centred on the baseline. */
function DeltaBar({ delta, scale }: { delta: number; scale: number }) {
  const width = scale > 0 ? (Math.abs(delta) / scale) * 50 : 0;
  const positive = delta >= 0;

  return (
    <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/8">
      <div className="absolute inset-y-0 left-1/2 w-px bg-white/25" />
      <div
        className={`absolute inset-y-0 rounded-full ${positive ? "bg-foreground" : "bg-accent"}`}
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
  const failedRuleCount = data?.constraints.filter((constraint) => !constraint.pass).length ?? 0;

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
          <div className="flex items-end justify-between gap-4">
            <div>
              <SectionLabel as="p">Score</SectionLabel>
              <div className="flex items-end gap-3">
                <ScoreValue value={data.score} />
                {percentile != null ? (
                  <div className="mb-0.5 border-l border-white/10 pl-2 leading-none">
                    <span className="block text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
                      Grade
                    </span>
                    <span className="mt-1 block font-mono text-sm font-medium text-foreground">
                      {gradeFor(percentile)}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="w-28 pb-0.5">
              <p className="text-xs font-normal text-muted-foreground">Eligibility</p>
              <div aria-hidden="true" className="mt-2 flex gap-1">
                {data.constraints.map((constraint) => (
                  <span
                    className={`h-1 flex-1 rounded-[1px] ${
                      constraint.pass ? "bg-foreground/25" : "bg-accent"
                    }`}
                    key={constraint.id}
                  />
                ))}
              </div>
              <p
                className={`mt-1.5 text-[11px] font-medium tabular-nums ${
                  data.eligible ? "text-foreground" : "text-accent"
                }`}
              >
                {data.eligible
                  ? `${data.constraints.length}/${data.constraints.length} clear`
                  : `${failedRuleCount}/${data.constraints.length} failed`}
              </p>
            </div>
          </div>

          {percentile != null ? (
            <p className={`mt-1 ${text.hint}`}>
              Beats {percentile.toFixed(0)}% of {analytics!.cellCount} cells scored in Austin
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
          <a
            className="mt-1.5 block text-[9px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            href="https://fontstruct.com/fontstructions/show/2095104/nothing-font-5x7"
            rel="noreferrer"
            target="_blank"
          >
            Score numerals: Nothing Font (5x7) by CTFonts
          </a>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Click anywhere in Austin to score it.
        </p>
      )}
    </div>
  );
}
