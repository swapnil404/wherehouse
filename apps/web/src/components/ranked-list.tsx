import { ChevronLeftIcon, ChevronRightIcon, CircleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { SCORE_BINS, binIndexIn } from "@/lib/heatmap-palette";
import { compositeScore } from "@/lib/cells";
import { describeStudyArea } from "@/lib/study-area";
import { useMapStore } from "@/stores/map-store";

import { text } from "./panel-styles";
import SiteExportActions from "./site-export-actions";

/**
 * How many rows are on screen at once.
 *
 * Five, so the shortlist stays a glance rather than a scroll. The dock opens
 * narrow and sits beside a map that is the actual subject; a column of
 * twenty-five scores competes with it, five does not.
 */
const PAGE_SIZE = 5;

/**
 * The shortlist: best cells in the grid under the live weights.
 *
 * This is the app's missing answer. Everything else here scores a location
 * the reader has already found; nothing told them where to look. Without it
 * the only way to find the best site was to hunt the brightest hex by eye.
 *
 * Each row carries the same ramp colour its hexagon has on the map, so the
 * list and the map share one visual key: a reader who spots a row can find
 * the cell, and vice versa. The score column is the only number, and it is
 * mono so the rows form a column rather than a ragged edge.
 *
 * Ineligible cells are marked, not hidden. They can outrank everything on raw
 * score while failing a hard constraint, and silently dropping them would
 * make the shortlist disagree with the map behind it. "Only workable sites"
 * in the rail is the control for that, and it narrows both at once.
 */
export default function RankedList() {
  const ranked = useMapStore((s) => s.rankedCells);
  const selection = useMapStore((s) => s.selection);
  const focusCell = useMapStore((s) => s.focusCell);
  const eligibleOnly = useMapStore((s) => s.eligibleOnly);
  const setEligibleOnly = useMapStore((s) => s.setEligibleOnly);
  const stats = useMapStore((s) => s.heatmapStats);
  const preset = useMapStore((s) => s.preset);
  const presets = useMapStore((s) => s.presets);
  const customWeights = useMapStore((s) => s.customWeights);
  const studyArea = useMapStore((s) => s.studyArea);
  const studyAreaSites = useMapStore((s) => s.studyAreaSites);
  const studyAreaScoreStatus = useMapStore((s) => s.studyAreaScoreStatus);

  const [page, setPage] = useState(0);

  // A new use case is a different question, so the reader should be looking
  // at its best answers, not still parked on page four of the previous one.
  useEffect(() => {
    setPage(0);
  }, [preset]);

  const total = ranked?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Weight edits reorder and can shorten the list underneath the reader, so
  // the page is clamped on render rather than trusted.
  const current = Math.min(page, pageCount - 1);
  const start = current * PAGE_SIZE;
  const rows = ranked?.slice(start, start + PAGE_SIZE) ?? [];

  const selectedH3 = selection?.cell?.h3_index ?? null;
  const weights = customWeights ?? presets?.[preset] ?? {};
  const areaSitesByH3 = new Map(
    (studyAreaSites ?? []).map((site) => [site.h3_index, site]),
  );
  const areaExportSites = (ranked ?? [])
    .slice(0, 4)
    .map((cell) => areaSitesByH3.get(cell.h3Index))
    .filter((site): site is NonNullable<typeof site> => site !== undefined)
    .sort(
      (a, b) =>
        (compositeScore(b.subscores, weights) ?? -1) -
        (compositeScore(a.subscores, weights) ?? -1),
    );

  const filter = (
    /* The eligibility filter, on the list it filters. It used to be a
       checkbox in the settings rail, a screen away from its own effect.
       Two options with live counts state the trade directly: this many
       places in total, this many that break no hard rule. */
    <div className="flex items-center gap-1 border-b border-border p-1.5">
      <FilterButton active={!eligibleOnly} onClick={() => setEligibleOnly(false)}>
        Everywhere
        <Count>{stats?.total}</Count>
      </FilterButton>
      <FilterButton active={eligibleOnly} onClick={() => setEligibleOnly(true)}>
        Workable
        <Count>{stats?.eligible}</Count>
      </FilterButton>
    </div>
  );

  const areaExport = studyArea ? (
    <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] font-medium text-foreground">
          {describeStudyArea(studyArea)}
        </p>
        <p className={text.hint}>
          {studyAreaScoreStatus.pending
            ? "Fetching full subscores and rules..."
            : studyAreaScoreStatus.error
              ? studyAreaScoreStatus.error
              : `${studyAreaSites?.length ?? 0} cells batch scored`}
        </p>
      </div>
      {areaExportSites.length > 0 ? (
        <SiteExportActions
          preset={preset}
          sites={areaExportSites}
          scope={{
            label: describeStudyArea(studyArea),
            cellCount: studyAreaSites?.length ?? 0,
            area: studyArea,
          }}
          variant="toolbar"
          weights={weights}
        />
      ) : null}
    </div>
  ) : null;

  if (ranked === null) {
    return (
      <div>
        {filter}
        {areaExport}
        <p className={`p-4 ${text.hint}`}>
        {eligibleOnly
          ? "Nowhere clears every rule for this use case. Untick “Only workable sites” to see the rest."
          : "Your best sites appear here once scoring finishes."}
        </p>
      </div>
    );
  }

  return (
    <div>
      {filter}
      {areaExport}
      <ol className="flex flex-col p-2">
        {rows.map((cell, index) => {
          // Always the score ramp, even when the map is painted by air
          // quality. This list is ranked by composite score, so a swatch from
          // the other ramp would colour a row by something it is not sorted on.
          const bin = SCORE_BINS[binIndexIn(cell.score, SCORE_BINS)];
          const active = cell.h3Index === selectedH3;

          return (
            <li key={cell.h3Index}>
              <button
                type="button"
                onClick={() => focusCell(cell.h3Index)}
                aria-current={active || undefined}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                  active
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-foreground/5"
                }`}
              >
                <span
                  className={`w-5 shrink-0 text-right font-mono text-[11px] tabular-nums ${
                    active ? "text-accent-foreground" : "text-muted-foreground"
                  }`}
                >
                  {start + index + 1}
                </span>

                {/* Same ramp step the cell is painted with on the map. */}
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: bin.hex, opacity: bin.alpha / 255 }}
                />

                <span className="flex-1 font-mono text-[13px] tabular-nums">
                  {cell.score.toFixed(1)}
                </span>

                {cell.eligible ? null : (
                  <CircleAlertIcon
                    className="size-3.5 shrink-0 text-warning"
                    aria-label="Breaks at least one hard rule"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <p className={`px-4 pb-3 ${text.hint}`}>
        Best {ranked.length} for this use case. Click one to find it on the map.
      </p>

      {pageCount > 1 ? (
        <Pager
          from={start + 1}
          to={start + rows.length}
          total={total}
          atStart={current === 0}
          atEnd={current >= pageCount - 1}
          onPrev={() => setPage(current - 1)}
          onNext={() => setPage(current + 1)}
        />
      ) : null}
    </div>
  );
}

/**
 * Range label and the two arrows at the foot of the shortlist, where paging
 * controls conventionally sit and where they no longer interrupt the path
 * from filters into results.
 *
 * Rendered only when there is more than one page: a disabled pair of arrows
 * over a three-row list is chrome describing nothing.
 */
function Pager({
  from,
  to,
  total,
  atStart,
  atEnd,
  onPrev,
  onNext,
}: {
  from: number;
  to: number;
  total: number;
  atStart: boolean;
  atEnd: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-1.5">
      <span className={`font-mono ${text.numeric}`}>
        {from}-{to} of {total}
      </span>

      <div className="flex items-center gap-0.5">
        <PagerButton label="Previous five" disabled={atStart} onClick={onPrev}>
          <ChevronLeftIcon className="size-3.5" />
        </PagerButton>
        <PagerButton label="Next five" disabled={atEnd} onClick={onNext}>
          <ChevronRightIcon className="size-3.5" />
        </PagerButton>
      </div>
    </div>
  );
}

/** Count chip on a filter option, matching the one on the collapsed card. */
function Count({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-foreground/10 px-1.5 py-px font-mono text-[10px] tabular-nums">
      {children ?? "-"}
    </span>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors ${
        active
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function PagerButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}
