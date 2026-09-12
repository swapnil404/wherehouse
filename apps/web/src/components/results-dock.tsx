import { ListOrderedIcon, PanelRightCloseIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { compositeScore } from "@/lib/cells";
import { MAX_COMPARE_SITES } from "@/lib/compare";
import { useMapStore } from "@/stores/map-store";

import { panelSurface } from "./panel-styles";
import PriorityEditor from "./priority-editor";
import RankedList from "./ranked-list";
import ScorePanel from "./score-panel";

type Tab = "ranked" | "site" | "tune";

/**
 * Floating results card, top-right of the map.
 *
 * Floating and content-sized rather than a full-height column. A docked
 * column is the right shape for content that fills one, and this does not:
 * the shortlist is five rows, so the dock spent most of its height on empty
 * card and charged 320px of map for it. This is as tall as whichever tab is
 * open and no taller.
 *
 * It still owns a fixed corner rather than hovering wherever it likes. The
 * original floating score panel collided with MapLibre's navigation control
 * and with the preset picker, and carried two hard-coded offsets plus a
 * breakpoint override to dodge them. That is fixed at the source instead:
 * navigation moved to the bottom-right and the picker to the top-left, so
 * this corner is genuinely free and nothing has to dodge anything.
 *
 * Three tabs, because the card now holds both the answer and the controls
 * that shape it. "Where should I look" is the shortlist, the one the product
 * exists for. "What about this one" is the score panel, which has nothing to
 * say until a click. "Tune" is what the score means, which used to be the
 * top of a settings rail on the far side of the window from the ranking it
 * reorders. Put here, a priority change and the reshuffle it causes are the
 * same glance.
 *
 * Rendered outside the map's client-only boundary, so the card is present on
 * first paint rather than appearing when the deck.gl chunk lands.
 */
export default function ResultsDock() {
  // Collapsed by default: the map is the subject, and the shortlist is worth
  // covering part of it only once the reader goes looking for it.
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("ranked");

  const ranked = useMapStore((s) => s.rankedCells);
  const selection = useMapStore((s) => s.selection);
  const selectionOrigin = useMapStore((s) => s.selectionOrigin);
  const analytics = useMapStore((s) => s.heatmapStats?.analytics ?? null);
  const preset = useMapStore((s) => s.preset);
  const presets = useMapStore((s) => s.presets);
  const customWeights = useMapStore((s) => s.customWeights);
  const comparisonSites = useMapStore((s) => s.comparisonSites);
  const toggleComparisonSite = useMapStore((s) => s.toggleComparisonSite);

  const weights = customWeights ?? presets?.[preset] ?? null;

  /**
   * Changes once per scoring request: first when it starts, again when the
   * cell lands. Keyed on both so a second map click re-opens the tab even if
   * the reader had switched back to the shortlist, while a weight edit, which
   * touches neither field, leaves the current tab alone.
   */
  const requestKey = selection
    ? `${selection.isPending}:${selection.cell?.h3_index ?? ""}`
    : null;

  /**
   * A map click opens the card as well as switching tab.
   *
   * Necessary because it starts collapsed: clicking a hexagon would otherwise
   * draw the selection ring and nothing else, and the detail the click asked
   * for would sit behind a button the reader has no reason to press. A
   * shortlist click is excluded, so walking the list does not fight the
   * reader for the tab.
   */
  useEffect(() => {
    if (requestKey && selectionOrigin === "map") {
      setTab("site");
      setOpen(true);
    }
  }, [requestKey, selectionOrigin]);

  if (!open) {
    return (
      /* Labelled, not a bare icon. This is the only route into the results
         and it is the app's resting state, so an unlabelled glyph in the
         corner made the single most important thing on screen a guess. The
         count doubles as proof there is something behind it. */
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`absolute top-4 right-4 z-20 flex items-center gap-2 py-1.5 pr-2.5 pl-3 text-xs font-medium transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none ${panelSurface}`}
      >
        <ListOrderedIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        Top sites
        {ranked ? (
          <span className="rounded-full bg-foreground/10 px-1.5 py-px font-mono text-[10px] tabular-nums">
            {ranked.length}
          </span>
        ) : null}
      </button>
    );
  }

  const scored =
    selection?.cell && weights
      ? { ...selection.cell, score: compositeScore(selection.cell.subscores, weights) }
      : null;
  const selectedComparison = selection?.cell
    ? comparisonSites.some((site) => site.h3_index === selection.cell?.h3_index)
    : false;
  const compareState = selectedComparison
    ? "added"
    : comparisonSites.length >= MAX_COMPARE_SITES
      ? "full"
      : "available";

  return (
    // `max-h` with `flex-col` rather than a set height: the card hugs the
    // shortlist's five rows, and only the much longer "This site" tab grows
    // far enough to start scrolling inside itself.
    <aside
      className={`absolute top-4 right-4 z-20 flex max-h-[calc(100%-2rem)] w-80 flex-col ${panelSurface}`}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border p-1.5">
        <TabButton active={tab === "ranked"} onClick={() => setTab("ranked")}>
          Shortlist
        </TabButton>
        <TabButton active={tab === "site"} onClick={() => setTab("site")}>
          This site
        </TabButton>
        <TabButton active={tab === "tune"} onClick={() => setTab("tune")}>
          Tune
        </TabButton>

        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Hide results"
          className="ml-auto rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <PanelRightCloseIcon className="size-4" />
        </button>
      </div>

      <div className="scrollbar-subtle min-h-0 overflow-y-auto">
        {tab === "ranked" ? (
          <RankedList />
        ) : tab === "tune" ? (
          <div className="p-4">
            <PriorityEditor presetWeights={presets?.[preset] ?? null} alwaysOpen />
          </div>
        ) : (
          <ScorePanel
            isPending={selection?.isPending ?? false}
            error={selection?.error ?? null}
            data={scored}
            analytics={analytics}
            weights={weights}
            compareState={compareState}
            onToggleCompare={() => {
              if (selection?.cell) toggleComparisonSite(selection.cell);
            }}
          />
        )}
      </div>
    </aside>
  );
}

function TabButton({
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
      className={`rounded-md px-2 py-1 text-xs transition-colors ${
        active
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
