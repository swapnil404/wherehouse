import { Checkbox } from "@wherehouse/ui/components/checkbox";
import { Label } from "@wherehouse/ui/components/label";
import { Slider } from "@wherehouse/ui/components/slider";

import {
  HOTSPOT_COLORS,
  HOTSPOT_METHODS,
  methodMeta,
  type HotspotMethod,
} from "@/lib/hotspots";
import { ANALYSIS_META, useMapStore, type AnalysisLayerId } from "@/stores/map-store";

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
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {format(value)}
        </span>
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

function AnalysisRow({ id, children }: { id: AnalysisLayerId; children?: React.ReactNode }) {
  const meta = ANALYSIS_META.find((m) => m.id === id)!;
  const layer = useMapStore((s) => s.layers[id]);
  const toggleLayer = useMapStore((s) => s.toggleLayer);

  return (
    <div className="py-1">
      <div className="flex items-center gap-2.5">
        <Checkbox
          id={`analysis-${id}`}
          checked={layer.visible}
          onCheckedChange={() => toggleLayer(id)}
        />
        <Label htmlFor={`analysis-${id}`} className="flex-1 cursor-pointer text-sm">
          {meta.label}
        </Label>
      </div>
      <p className="mt-0.5 pl-6.5 text-[11px] text-muted-foreground/70">{meta.hint}</p>
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
    <div>
      <h2 className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        Analysis
      </h2>

      <div className="mt-2">
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
                      ? "rounded-md border border-border bg-accent px-1.5 py-1 text-[10px] font-medium text-accent-foreground"
                      : "rounded-md border border-transparent px-1.5 py-1 text-[10px] text-muted-foreground hover:border-border"
                  }
                >
                  {option.id === "gi_star" ? "Gi*" : option.id === "dbscan" ? "DBSCAN" : "Bins"}
                </button>
              );
            })}
          </div>

          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground/70">
            {meta.blurb}
          </p>

          {/* Only the parameters the active method actually reads. Showing
              DBSCAN's epsilon while Gi* is selected would imply it does
              something, and the request would ignore it. */}
          {params.method === "gi_star" ? (
            <ParamSlider
              label="Neighbourhood"
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
                label="Candidate score"
                value={params.threshold}
                min={0}
                max={100}
                step={5}
                format={(v) => `≥ ${v}`}
                onChange={(threshold) => setParams({ threshold })}
              />
              <p className="text-[11px] leading-snug text-muted-foreground/70">
                {candidates === null ? (
                  "Waiting for the grid…"
                ) : candidates === 0 ? (
                  <span className="text-destructive">
                    No cell scores this high
                    {maxScore == null ? "" : ` — the grid tops out at ${maxScore.toFixed(1)}`}.
                  </span>
                ) : (
                  `${candidates} candidate cell${candidates === 1 ? "" : "s"}${
                    maxScore == null ? "" : ` · top score ${maxScore.toFixed(1)}`
                  }`
                )}
              </p>
              <ParamSlider
                label="Cluster radius"
                value={params.epsKm}
                min={0.5}
                max={5}
                step={0.5}
                format={(v) => `${v.toFixed(1)} km`}
                onChange={(epsKm) => setParams({ epsKm })}
              />
              <ParamSlider
                label="Minimum cells"
                value={params.minSamples}
                min={2}
                max={20}
                step={1}
                format={(v) => `${v}`}
                onChange={(minSamples) => setParams({ minSamples })}
              />
            </>
          ) : null}

          <ul className="mt-2 space-y-1">
            {meta.painted.map((painted) => (
              <li key={painted.classification} className="flex items-center gap-2">
                <Swatch
                  hex={painted.tone === "hot" ? HOTSPOT_COLORS.hot : HOTSPOT_COLORS.cold}
                />
                <span className="flex-1 text-[11px] text-muted-foreground">
                  {painted.label}
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {stats ? stats.counts[painted.classification] : "—"}
                </span>
              </li>
            ))}
          </ul>

          {params.method === "dbscan" && stats ? (
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground/70">
              {stats.clusters === 0
                ? "No clusters — lower the candidate score, widen the radius, or reduce the minimum cells."
                : `${stats.clusters} cluster${stats.clusters === 1 ? "" : "s"} found`}
            </p>
          ) : null}
        </AnalysisRow>

        <AnalysisRow id="underserved">
          <ul className="mt-2 space-y-1">
            <li className="flex items-center gap-2">
              <Swatch hex={HOTSPOT_COLORS.underserved} />
              <span className="flex-1 text-[11px] text-muted-foreground">
                High demand, low supply
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {stats ? stats.underserved : "—"}
              </span>
            </li>
          </ul>
          {/* The API is explicit that this is general retail and services.
              There is no charger-supply data, so it must never be read as EV
              underservice even while the EV preset is active. */}
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground/70">
            General retail and services only — not EV charging supply.
          </p>
        </AnalysisRow>
      </div>
    </div>
  );
}
