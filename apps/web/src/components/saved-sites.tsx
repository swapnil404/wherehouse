import { Textarea } from "@wherehouse/ui/components/textarea";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CrosshairIcon,
  TrashIcon,
} from "lucide-react";
import { useState } from "react";

import { PRESET_LABELS, type PresetName, type Weights } from "@/lib/cells";
import { MAX_SAVED_SITES, parseSnapshot, snapshotDrift } from "@/lib/saved-sites";
import { useProjects, type SavedSite } from "@/lib/use-projects";
import { useMapStore } from "@/stores/map-store";

import { text } from "./panel-styles";

/**
 * The active project's saved sites — the only list in this app that does not
 * move when the weights do.
 *
 * Each row shows the score the site had when it was saved, and says so. If
 * today's priorities would score it differently the row shows both numbers,
 * which is the entire reason the snapshot is stored rather than recomputed:
 * the alternative is a list that quietly rewrites its own history every time a
 * slider moves, leaving the reader's notes arguing with the figures beside
 * them.
 */
export default function SavedSites() {
  const { active, projects, updateProject, updateSite, deleteSite } = useProjects();
  const preset = useMapStore((state) => state.preset);
  const presets = useMapStore((state) => state.presets);
  const customWeights = useMapStore((state) => state.customWeights);
  const focusCell = useMapStore((state) => state.focusCell);
  const [expanded, setExpanded] = useState<string | null>(null);
  /**
   * Note text the reader has typed but not committed, kept here rather than in
   * the row because the row's notes field unmounts every time it collapses.
   *
   * An uncontrolled field seeded from `site.notes` looked fine and was quietly
   * destructive. Collapsing saved on blur, reopening re-seeded the field from
   * whatever the cache held at that instant — often the pre-save value — and
   * the next blur committed *that* back over the note that had just been
   * written. A note could be typed, saved, and erased by its own field without
   * the reader touching the text again.
   *
   * Keyed by site id and never cleared: what the reader typed is the truth
   * until they change it, so it outlives the collapse, the refetch and the
   * reorder that follows a save.
   */
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  if (!active) {
    return (
      <div className="p-4">
        <p className={text.body}>No project yet</p>
        <p className={`mt-1 ${text.hint}`}>
          {projects.length === 0
            ? "Create one from the header to start keeping sites. A project remembers the use case and priorities you saved it with."
            : "Pick a project from the header to see its saved sites."}
        </p>
      </div>
    );
  }

  const weights = customWeights ?? presets?.[preset] ?? {};
  const full = active.savedSites.length >= MAX_SAVED_SITES;

  const commitNote = (site: SavedSite) => {
    const draft = noteDrafts[site.id];
    // Untouched fields commit nothing. This is what stops a field that merely
    // gained and lost focus from writing anything at all.
    if (draft === undefined) return;
    const notes = draft.trim();
    if (notes === (site.notes ?? "")) return;
    updateSite.mutate({ siteId: site.id, notes });
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <input
          aria-label="Project name"
          className="min-w-0 flex-1 truncate rounded-sm bg-transparent text-[13px] font-medium text-foreground outline-none focus:bg-white/5 focus:px-1"
          defaultValue={active.name}
          key={active.id}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name && name !== active.name) {
              updateProject.mutate({ projectId: active.id, name });
            } else {
              event.target.value = active.name;
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.currentTarget.value = active.name;
              event.currentTarget.blur();
            }
          }}
        />
        {/* Deleting a project lives in the header switcher, which confirms
            first. A one-click trash icon here removed the project and cascaded
            through every site in it with nothing to stop a misclick. */}
        <span className={`shrink-0 font-mono ${text.numeric}`}>
          {active.savedSites.length}/{MAX_SAVED_SITES}
        </span>
      </div>

      <p className={`border-b border-border px-3 py-2 ${text.hint}`}>
        Saved under {PRESET_LABELS[active.preset as PresetName] ?? active.preset}
        {full ? " · project is full" : null}
      </p>

      {active.savedSites.length === 0 ? (
        <p className={`p-4 ${text.hint}`}>
          Nothing saved yet. Score a site and use Save on its breakdown to keep
          it here with the score it had at the time.
        </p>
      ) : (
        <ul>
          {active.savedSites.map((site) => (
            <SavedSiteRow
              expanded={expanded === site.id}
              key={site.id}
              onDelete={() => deleteSite.mutate({ siteId: site.id })}
              onFocus={() => {
                if (site.h3Cell) focusCell(site.h3Cell);
              }}
              note={noteDrafts[site.id] ?? site.notes ?? ""}
              onNoteChange={(value) =>
                setNoteDrafts((drafts) => ({ ...drafts, [site.id]: value }))
              }
              onNoteCommit={() => commitNote(site)}
              onRename={(name) => updateSite.mutate({ siteId: site.id, name })}
              onToggle={() =>
                setExpanded((open) => (open === site.id ? null : site.id))
              }
              preset={preset}
              site={site}
              weights={weights}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SavedSiteRow({
  site,
  preset,
  weights,
  expanded,
  note,
  onToggle,
  onFocus,
  onRename,
  onNoteChange,
  onNoteCommit,
  onDelete,
}: {
  site: SavedSite;
  preset: PresetName;
  weights: Weights;
  expanded: boolean;
  note: string;
  onToggle: () => void;
  onFocus: () => void;
  onRename: (name: string) => void;
  onNoteChange: (value: string) => void;
  onNoteCommit: () => void;
  onDelete: () => void;
}) {
  const snapshot = parseSnapshot(site.scoreSnapshot);
  const drift = snapshot ? snapshotDrift(snapshot, preset, weights) : null;
  const failedLabel = snapshot
    ? `Failed ${snapshot.failedRules} hard rule${snapshot.failedRules === 1 ? "" : "s"} when saved`
    : "";

  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex items-center gap-1.5 px-2 py-2">
        <button
          aria-expanded={expanded}
          aria-label={expanded ? "Hide details" : "Show details"}
          className="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          onClick={onToggle}
          type="button"
        >
          {expanded ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5" />
          )}
        </button>

        <input
          aria-label="Site name"
          className="min-w-0 flex-1 truncate rounded-sm bg-transparent text-[12px] text-foreground outline-none focus:bg-white/5 focus:px-1"
          defaultValue={site.name}
          key={site.id}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name && name !== site.name) onRename(name);
            else event.target.value = site.name;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.currentTarget.value = site.name;
              event.currentTarget.blur();
            }
          }}
        />

        <span className="shrink-0 text-right font-mono text-sm tabular-nums">
          {snapshot ? snapshot.score.toFixed(1) : "—"}
        </span>

        <button
          aria-label={`Show ${site.name} on the map`}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-30"
          disabled={!site.h3Cell}
          onClick={onFocus}
          type="button"
        >
          <CrosshairIcon className="size-3.5" />
        </button>
      </div>

      {/* The drift line is the snapshot earning its keep, so it stays in the
          collapsed row rather than hiding behind the chevron. */}
      {drift?.scoreChanged && drift.liveScore !== null ? (
        <p className={`px-2 pb-1.5 pl-7 ${text.hint}`}>
          Now {drift.liveScore.toFixed(1)} under your current priorities
          {drift.presetChanged ? " and use case" : null}
        </p>
      ) : null}

      {expanded ? (
        <div className="space-y-2 px-2 pb-2 pl-7">
          {snapshot ? (
            <p className={text.hint}>
              {snapshot.eligible ? "Passed every hard rule when saved" : failedLabel}
            </p>
          ) : null}
          {/* Controlled, against the draft above. `defaultValue` here would
              re-read the cache on every reopen, which is the bug this replaced. */}
          <Textarea
            aria-label="Notes"
            className="min-h-16 text-[11px]"
            onBlur={onNoteCommit}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="Why this one?"
            value={note}
          />
          <button
            className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-destructive"
            onClick={onDelete}
            type="button"
          >
            <TrashIcon className="size-3" aria-hidden />
            Remove from project
          </button>
        </div>
      ) : null}
    </li>
  );
}
