import { Checkbox } from "@wherehouse/ui/components/checkbox";
import { Label } from "@wherehouse/ui/components/label";
import { Slider } from "@wherehouse/ui/components/slider";

import { LoaderCircleIcon, SlidersHorizontalIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import {
  HOTSPOT_COLORS,
  HOTSPOT_METHODS,
  methodMeta,
  type HotspotMethod,
} from "@/lib/hotspots";
import { ANALYSIS_META, useMapStore, type AnalysisLayerId } from "@/stores/map-store";

import { text } from "./panel-styles";

function Swatch({ hex }: { hex: string }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-[2px]"
      style={{ backgroundColor: hex }}
    />
  );
}

function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className={text.caption}>{label}</span>
        <span className={`font-mono ${text.numeric}`}>{format(value)}</span>
      </div>
      <Slider
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) => {
          if (typeof next === "number") onChange(next);
        }}
      />
    </div>
  );
}

/**
 * A painted-class count, or an honest stand-in for one.
 *
 * A bare dash was used for every not-a-number case, which read as "zero
 * found" and hid the two that are not: the request is still running, or it
 * failed. Neither is a finding about Austin.
 */
function Tally({ value }: { value?: number }) {
  const status = useMapStore((s) => s.hotspotStatus);
  if (status.error) return <span className="text-destructive">n/a</span>;
  if (status.pending) return <span aria-label="Loading">…</span>;
  return <span>{value ?? "-"}</span>;
}

/** Matches the "Adjust priorities" affordance, so both hidden knob sets open the same way. */
function FineTune({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!children) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md text-[11px] font-medium transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <SlidersHorizontalIcon className="size-3" />
        {open ? "Done" : "Fine-tune"}
      </button>
      {open ? <div className="mt-1">{children}</div> : null}
    </div>
  );
}

function AnalysisRow({ id, children }: { id: AnalysisLayerId; children?: React.ReactNode }) {
  const meta = ANALYSIS_META.find((m) => m.id === id)!;
  const layer = useMapStore((s) => s.layers[id]);
  const toggleLayer = useMapStore((s) => s.toggleLayer);
  const status = useMapStore((s) => s.hotspotStatus);

  return (
    <div className="py-1">
      <div className="flex items-center gap-2.5">
        <Checkbox
          id={`analysis-${id}`}
          checked={layer.visible}
          onCheckedChange={() => toggleLayer(id)}
        />
        <Label htmlFor={`analysis-${id}`} className={`flex-1 cursor-pointer ${text.body}`}>
          {meta.label}
        </Label>
      </div>
      <p className={`mt-1 pl-6.5 ${text.hint}`}>{meta.hint}</p>

      {/* Both overlays are drawn from one `/v1/hotspots` call, so a failure
          or a wait belongs here rather than being inferred from the tallies
          below going blank. */}
      {layer.visible && status.error ? (
        <p className="mt-1.5 flex items-start gap-1.5 pl-6.5 text-[11px] leading-snug text-destructive">
          <TriangleAlertIcon className="mt-px size-3 shrink-0" />
          Could not work this out. {status.error}
        </p>
      ) : layer.visible && status.pending ? (
        <p className={`mt-1.5 flex items-center gap-1.5 pl-6.5 ${text.hint}`}>
          <LoaderCircleIcon className="size-3 shrink-0 animate-spin" />
          Working…
        </p>
      ) : null}

      {layer.visible ? <div className="pl-6.5">{children}</div> : null}
    </div>
  );
}

/**
 * Server-computed analysis: Gi* / DBSCAN / binning clusters and the
 * underserved view.
 *
 * Kept out of the layer rail's tile list because the controls belong next to
 * the toggle they affect, and because these are the only overlays whose
 * parameters cost a round trip — the section is where that cost is made
 * visible rather than hidden behind a slider that silently refetches.
 */
export default function AnalysisPanel() {
  const params = useMapStore((s) => s.hotspotParams);
  const setParams = useMapStore((s) => s.setHotspotParams);
  const stats = useMapStore((s) => s.hotspotStats);
  // The heatmap already computed every cell's composite under the live
  // weights, so the threshold slider can be captioned against the real
  // distribution instead of an abstract 0-100. Without this the default of
  // 70 read as reasonable while sitting above the highest score on the grid.
  const sortedScores = useMapStore((s) => s.heatmapStats?.analytics?.sortedScores ?? null);

  const meta = methodMeta(params.method);
  const maxScore = sortedScores?.length ? sortedScores[sortedScores.length - 1] : null;

  /** Cells scoring at or above `threshold`, by binary search on the sorted composites. */
  const cellsAtOrAbove = (threshold: number): number | null => {
    if (!sortedScores) return null;
    let lo = 0;
    let hi = sortedScores.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedScores[mid] < threshold) lo = mid + 1;
      else hi = mid;
    }
    return sortedScores.length - lo;
  };

  const candidates = cellsAtOrAbove(params.threshold);

  return (
    // The heading lives on the rail's disclosure now, so the section does not
    // announce itself twice.
    <div>
      <div>
        <AnalysisRow id="hotspots">
          <div className="mt-2 grid grid-cols-3 gap-1">
            {HOTSPOT_METHODS.map((option) => {
              const active = option.id === params.method;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setParams({ method: option.id as HotspotMethod })}
                  className={
                    active
                      ? "rounded-md bg-accent/15 px-1.5 py-1 text-[11px] font-medium text-foreground ring-1 ring-accent"
                      : "rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <p className={`mt-2 ${text.hint}`}>{meta.blurb}</p>

          <ul className="mt-2 space-y-1">
            {meta.painted.map((painted) => (
              <li key={painted.classification} className="flex items-center gap-2">
                <Swatch
                  hex={painted.tone === "hot" ? HOTSPOT_COLORS.hot : HOTSPOT_COLORS.cold}
                />
                <span className={`flex-1 ${text.caption}`}>{painted.label}</span>
                <span className={`font-mono ${text.numeric}`}>
                  <Tally value={stats?.counts[painted.classification]} />
                </span>
              </li>
            ))}
          </ul>

          {params.method === "dbscan" && stats ? (
            <p className={`mt-2 ${text.hint}`}>
              {stats.clusters === 0
                ? "Nothing grouped up. Try a lower minimum score, a wider spread, or a smaller group size."
                : `${stats.clusters} area${stats.clusters === 1 ? "" : "s"} found`}
            </p>
          ) : null}

          {/* The knobs behind a door. Each is a real parameter of the method
              and each has a defensible default, so the resting state should
              be the default rather than four sliders asking the reader to
              have an opinion about a neighbourhood radius in kilometres.
              Only the parameters the active method reads are shown: offering
              a spread control while "Proven" is selected would imply it does
              something, and the request would ignore it. */}
          <FineTune>
            {params.method === "gi_star" ? (
              <ParamSlider
                label="How far to look around each place"
                value={params.k}
                min={1}
                max={4}
                step={1}
                format={(v) => `${v} ring${v === 1 ? "" : "s"}`}
                onChange={(k) => setParams({ k })}
              />
            ) : null}

            {params.method === "dbscan" ? (
              <>
                <ParamSlider
                  label="Minimum score to count"
                  value={params.threshold}
                  min={0}
                  max={100}
                  step={5}
                  format={(v) => `${v}+`}
                  onChange={(threshold) => setParams({ threshold })}
                />
                <p className={`mt-1 ${text.hint}`}>
                  {candidates === null ? (
                    "Waiting for scores…"
                  ) : candidates === 0 ? (
                    <span className="text-destructive">
                      Nowhere scores this high
                      {maxScore == null ? "." : `. The best is ${maxScore.toFixed(1)}.`}
                    </span>
                  ) : (
                    `${candidates} place${candidates === 1 ? "" : "s"} qualify${
                      maxScore == null ? "" : `, best is ${maxScore.toFixed(1)}`
                    }`
                  )}
                </p>
                <ParamSlider
                  label="How spread out a group can be"
                  value={params.epsKm}
                  min={0.5}
                  max={5}
                  step={0.5}
                  format={(v) => `${v.toFixed(1)} km`}
                  onChange={(epsKm) => setParams({ epsKm })}
                />
                <ParamSlider
                  label="Smallest group worth showing"
                  value={params.minSamples}
                  min={2}
                  max={20}
                  step={1}
                  format={(v) => `${v} places`}
                  onChange={(minSamples) => setParams({ minSamples })}
                />
              </>
            ) : null}
          </FineTune>
        </AnalysisRow>

        <AnalysisRow id="underserved">
          <ul className="mt-2 space-y-1">
            <li className="flex items-center gap-2">
              <Swatch hex={HOTSPOT_COLORS.underserved} />
              <span className={`flex-1 ${text.caption}`}>Lots of people, few businesses</span>
              <span className={`font-mono ${text.numeric}`}>
                <Tally value={stats?.underserved} />
              </span>
            </li>
          </ul>
          {/* The API is explicit that this is general retail and services.
              There is no charger-supply data, so it must never be read as EV
              underservice even while the EV preset is active. */}
          <p className={`mt-2 ${text.hint}`}>
Counts shops and services generally, not charging points.
          </p>
        </AnalysisRow>
      </div>
    </div>
  );
}
