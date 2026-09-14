import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@wherehouse/ui/components/dropdown-menu";
import { Skeleton } from "@wherehouse/ui/components/skeleton";
import {
  ChevronsUpDownIcon,
  FolderIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { PRESET_LABELS, type PresetName } from "@/lib/cells";
import { nextSequentialName, sameWeights, toWeights } from "@/lib/saved-sites";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useProjects } from "@/lib/use-projects";
import { useMapStore } from "@/stores/map-store";

/**
 * Which workspace the session is in, and the only place the map and the active
 * project are kept in step.
 *
 * It lives in the header because a project supplies the preset, weights,
 * filtering, reach, and study area the map is drawn from; somewhere less
 * permanent and the reader would have no standing answer to what is on screen.
 *
 * Both directions of that synchronisation are owned here, and this component is
 * mounted exactly once, which is what makes a single owner possible. `useProjects`
 * is called from three places and any effect inside it would run three times.
 */

const CHROME =
  "flex min-w-0 shrink items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-xs";

/**
 * How long the map has to sit still before its setup is written to the project.
 *
 * The weight sliders fire on every pointer move — that is the point of scoring
 * in the browser — so persisting eagerly would mean one round trip per pixel of
 * drag. Long enough to coalesce a drag, short enough that a reload right after
 * tuning does not lose it.
 */
// Let a person finish tuning several priorities before syncing the resulting
// setup. Switching projects still flushes an unsettled edit immediately.
const SETUP_WRITE_DELAY_MS = 4_000;

type Mode = "idle" | "renaming" | "confirmDelete";

export default function ProjectSwitcher() {
  const {
    projects,
    active,
    isLoading,
    openProject,
    setActiveProjectId,
    createProject,
    updateProject,
    deleteProject,
  } = useProjects();
  const preset = useMapStore((state) => state.preset);
  const presets = useMapStore((state) => state.presets);
  const customWeights = useMapStore((state) => state.customWeights);
  const eligibleOnly = useMapStore((state) => state.eligibleOnly);
  const catchmentOn = useMapStore((state) => state.catchmentOn);
  const catchmentMode = useMapStore((state) => state.catchmentMode);
  const catchmentMinutes = useMapStore((state) => state.catchmentMinutes);
  const drawMode = useMapStore((state) => state.drawMode);
  const studyArea = useMapStore((state) => state.studyArea);
  const setupRevision = useMapStore((state) => state.setupRevision);

  const mapSettings = useMemo(
    () => ({
      eligibleOnly,
      catchment: {
        enabled: catchmentOn,
        mode: catchmentMode,
        minutes: catchmentMinutes,
      },
      searchScope: (drawMode === "polygon" || studyArea ? "draw" : "city") as "draw" | "city",
      studyArea,
    }),
    [eligibleOnly, catchmentOn, catchmentMode, catchmentMinutes, drawMode, studyArea],
  );

  const [mode, setMode] = useState<Mode>("idle");
  /**
   * The rename field's text, seeded once when rename is picked.
   *
   * Held here rather than left to an uncontrolled input reading `active.name`,
   * because that input mounts fresh on every rename and would re-read the name
   * from the cache each time — including during the moment after a rename when
   * the cache still holds the previous one.
   */
  const [nameDraft, setNameDraft] = useState("");
  const appliedProjectId = useRef<string | null>(null);
  /** The last `setupRevision` this component has already dealt with. */
  const handledRevision = useRef(0);

  /**
   * Project → map.
   *
   * Keyed on *which* project is open rather than firing once, because "once" is
   * wrong in both directions. It has to run on first load, so reopening the app
   * lands in the project you last worked in instead of the default preset with a
   * project name in the header claiming otherwise. And it has to run again when
   * the open project changes underneath the session — deleting the active
   * project promotes a successor, and a one-shot effect would leave the header
   * naming the successor while the map still used the deleted project's setup.
   *
   * Comparing ids rather than objects is what keeps it from re-running on a
   * refetch or on a write-back below, either of which replaces the object while
   * leaving the same project open — and re-applying then would stomp the very
   * edits being saved.
   */
  useEffect(() => {
    if (!active || appliedProjectId.current === active.id) return;

    // An edit still inside the debounce window belongs to the project being
    // left, and this render still holds it — the incoming setup is not applied
    // until `openProject` below. Without this, tuning a project and switching
    // away inside a second would discard the tuning silently.
    //
    // Skipped when the outgoing project is gone from the list, which is what a
    // deletion looks like from here: writing to it would only raise a
    // not-found toast about a project the user just removed on purpose.
    const outgoingId = appliedProjectId.current;
    const outgoing = outgoingId
      ? projects.find((project) => project.id === outgoingId)
      : undefined;
    if (outgoing && setupRevision !== handledRevision.current) {
      updateProject.mutate({
        projectId: outgoing.id,
        preset,
        weights: (customWeights ?? {}) as Record<string, number>,
        mapSettings,
      });
    }

    appliedProjectId.current = active.id;
    // The setup about to be applied is this project's own, so nothing is
    // pending persistence until the user changes something from here.
    handledRevision.current = setupRevision;
    openProject(active);
  }, [
    active,
    openProject,
    projects,
    preset,
    customWeights,
    mapSettings,
    setupRevision,
    updateProject,
  ]);

  /**
   * Map → project.
   *
   * Without this a project is write-once: it captures the setup it was created
   * with and then quietly ignores every preset switch and slider drag after,
   * so reopening it restores a configuration the user abandoned hours ago.
   */
  const mapSetup = useMemo(
    () => JSON.stringify({ preset, weights: customWeights ?? {}, mapSettings }),
    [preset, customWeights, mapSettings],
  );
  // Purely a coalescing gate. The weight sliders fire on every pointer move, so
  // without it a single drag would be one round trip per pixel.
  const settled = useDebouncedValue(mapSetup, SETUP_WRITE_DELAY_MS) === mapSetup;

  useEffect(() => {
    if (!active || appliedProjectId.current !== active.id) return;
    // Nothing the *user* has touched since this project was opened. This is the
    // check that makes switching projects safe, and it cannot be replaced by
    // comparing the map to the project: at the moment of a switch the map still
    // holds the outgoing project's setup, which reads as a pending edit and
    // would be written straight into the incoming project.
    if (setupRevision === handledRevision.current) return;
    if (!settled) return;

    // Claimed before the request, not after it lands, so a re-render caused by
    // the mutation cannot re-send the same change. A failed write is not
    // retried — it surfaces as a toast, and the next edit bumps the revision
    // and tries again.
    handledRevision.current = setupRevision;

    const weights = customWeights ?? {};
    const storedSettings = active.mapSettings;
    if (
      preset === active.preset
      && sameWeights(toWeights(active.weights as Record<string, number>), weights)
      && storedSettings.eligibleOnly === mapSettings.eligibleOnly
      && storedSettings.catchment?.enabled === mapSettings.catchment.enabled
      && storedSettings.catchment?.mode === mapSettings.catchment.mode
      && storedSettings.catchment?.minutes === mapSettings.catchment.minutes
      && (storedSettings.searchScope ?? "city") === mapSettings.searchScope
      && JSON.stringify(storedSettings.studyArea ?? null) === JSON.stringify(mapSettings.studyArea)
    ) {
      return;
    }

    updateProject.mutate({
      projectId: active.id,
      preset,
      // `{}` means "whatever this preset defines", which is what
      // `applyProjectSetup` reads back as untouched. Resolving it to the
      // preset's current numbers would pin the project to today's values and
      // make an unmodified preset indistinguishable from a deliberate copy.
      weights: weights as Record<string, number>,
      mapSettings,
    });
  }, [active, preset, customWeights, mapSettings, setupRevision, settled, updateProject]);

  if (isLoading) return <Skeleton className="h-8 w-40 rounded-md" />;

  const handleCreate = () => {
    createProject.mutate({
      name: nextSequentialName("Project", projects),
      // Starts from what is on screen. Making a project is something you do
      // *because* of the map you have tuned, so an empty one would throw away
      // the setup that prompted it.
      preset,
      weights: (customWeights ?? presets?.[preset] ?? {}) as Record<string, number>,
      mapSettings,
    });
  };

  if (projects.length === 0) {
    return (
      <button
        className={`${CHROME} shrink-0 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-50`}
        disabled={createProject.isPending}
        onClick={handleCreate}
        type="button"
      >
        <PlusIcon className="size-3.5" aria-hidden />
        {createProject.isPending ? "Creating…" : "New project"}
      </button>
    );
  }

  if (mode === "renaming" && active) {
    const commit = () => {
      const name = nameDraft.trim();
      setMode("idle");
      if (name && name !== active.name) {
        updateProject.mutate({ projectId: active.id, name });
      }
    };

    return (
      <div className={`${CHROME} bg-white/5`}>
        <PencilIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          aria-label="Project name"
          autoFocus
          className="w-36 min-w-0 bg-transparent font-medium outline-none"
          onBlur={commit}
          onChange={(event) => setNameDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") setMode("idle");
          }}
          value={nameDraft}
        />
      </div>
    );
  }

  if (mode === "confirmDelete" && active) {
    const siteCount = active.savedSites.length;
    return (
      <div className={`${CHROME} border-destructive/40 bg-destructive/10`}>
        {/* Names the blast radius. Deleting a project cascades to its saved
            sites, so a bare "are you sure" would understate it. */}
        <span className="truncate text-muted-foreground">
          Delete {active.name}
          {siteCount > 0 ? ` and its ${siteCount} site${siteCount === 1 ? "" : "s"}` : null}?
        </span>
        <button
          className="shrink-0 rounded-sm px-1.5 py-0.5 font-medium text-destructive transition-colors hover:bg-destructive/20"
          onClick={() => {
            setMode("idle");
            deleteProject.mutate({ projectId: active.id });
          }}
          type="button"
        >
          Delete
        </button>
        <button
          className="shrink-0 rounded-sm px-1.5 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setMode("idle")}
          type="button"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`${CHROME} transition-colors hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none`}
        aria-label={`Active project: ${active?.name ?? "none"}`}
      >
        <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="max-w-32 truncate font-medium">{active?.name}</span>
        {active ? (
          <span className="rounded-full bg-white/10 px-1.5 py-px font-mono text-[10px] text-muted-foreground tabular-nums">
            {active.savedSites.length}
          </span>
        ) : null}
        <ChevronsUpDownIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuRadioGroup
          value={active?.id ?? ""}
          // Selects only. Handing the map over is the effect above's job, so
          // there is one path that does it and one place it can go wrong.
          onValueChange={setActiveProjectId}
        >
          {/* Inside the radio group, not above it. Base UI's group label reads
              its group from context and throws outright without one, and menu
              content only mounts on open — so a label one level too high is an
              error the moment the menu is clicked, not a layout nit. It also
              belongs here on the merits: it names these options. */}
          <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.09em] text-muted-foreground">
            Projects
          </DropdownMenuLabel>
          {projects.map((project) => (
            <DropdownMenuRadioItem key={project.id} value={project.id}>
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">
                {PRESET_LABELS[project.preset as PresetName] ?? project.preset}
                {" · "}
                {project.savedSites.length}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={createProject.isPending} onClick={handleCreate}>
          <PlusIcon className="size-3.5" aria-hidden />
          New project
        </DropdownMenuItem>

        {/* Rename and delete act on one project, and as flat siblings of "New
            project" they gave no clue which — with three projects listed above,
            "Delete project" was a guess. Naming the target in a heading and
            reducing the items to bare verbs says it once, unambiguously, and
            reads shorter than repeating "project" three times.

            The heading is a group label, which Base UI resolves through context
            and which throws if it is not inside a group — hence the wrapper. */}
        {active ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {/* Same uppercase treatment as the "Projects" heading above, so
                  it reads as a section rather than as one more selectable
                  project — the rows list names in normal case. */}
              <DropdownMenuLabel className="truncate text-[10px] uppercase tracking-[0.09em] text-muted-foreground">
                {active.name}
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => {
                  setNameDraft(active.name);
                  setMode("renaming");
                }}
              >
                <PencilIcon className="size-3.5" aria-hidden />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setMode("confirmDelete")}
                variant="destructive"
              >
                <Trash2Icon className="size-3.5" aria-hidden />
                Delete
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
