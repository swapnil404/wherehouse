import { CheckIcon, XIcon } from "lucide-react";

/**
 * Floating score panel.
 *
 * Structural props rather than the tRPC mutation object, so the panel can be
 * driven by a fixture, a real query, or nothing at all.
 *
 * The spec's dial, contribution waterfall and plain-English drivers are a
 * later pass — this keeps the existing subscore grid and constraint checklist.
 */

interface ScoreData {
  score: number;
  eligible: boolean;
  subscores: Record<string, number>;
  constraints: readonly { id: string; label: string; pass: boolean }[];
}

interface ScorePanelProps {
  isPending: boolean;
  error: { message: string } | null;
  data: ScoreData | null;
}

export default function ScorePanel({ isPending, error, data }: ScorePanelProps) {
  return (
    <aside className="pointer-events-auto absolute top-4 right-16 w-80 max-w-[calc(100%-5rem)] rounded-lg border border-border bg-card/95 p-4 shadow-xl backdrop-blur">
      {isPending ? (
        <p className="text-sm text-muted-foreground">Scoring this location…</p>
      ) : error ? (
        <div>
          <p className="text-sm font-medium text-destructive">Location unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
        </div>
      ) : data ? (
        <div>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                Site score
              </p>
              <p className="text-3xl font-semibold tabular-nums">{data.score}</p>
            </div>
            <span
              className="rounded-full px-2 py-1 text-xs"
              style={
                data.eligible
                  ? { backgroundColor: "#0ca30c1f", color: "#4ade80" }
                  : { backgroundColor: "#fab2191f", color: "#fbbf24" }
              }
            >
              {data.eligible ? "Eligible" : "Constraints failed"}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            {Object.entries(data.subscores).map(([name, value]) => (
              <div key={name} className="flex items-baseline justify-between rounded bg-muted/50 px-2 py-1.5">
                <span className="text-muted-foreground capitalize">{name}</span>
                <span className="font-medium tabular-nums">{value}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-1.5">
            {data.constraints.map((constraint) => (
              <div key={constraint.id} className="flex items-start gap-2 text-xs">
                {constraint.pass ? (
                  <CheckIcon className="mt-0.5 size-3.5 shrink-0" style={{ color: "#0ca30c" }} />
                ) : (
                  <XIcon className="mt-0.5 size-3.5 shrink-0" style={{ color: "#d03b3b" }} />
                )}
                <span className="text-muted-foreground">{constraint.label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Click anywhere in Austin to score that location.
        </p>
      )}
    </aside>
  );
}
