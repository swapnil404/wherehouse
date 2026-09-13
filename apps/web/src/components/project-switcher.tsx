import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@wherehouse/ui/components/dropdown-menu";
import { Skeleton } from "@wherehouse/ui/components/skeleton";
import { ChevronsUpDownIcon, FolderIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { PRESET_LABELS, type PresetName } from "@/lib/cells";
import { nextSequentialName } from "@/lib/saved-sites";
import { useProjects } from "@/lib/use-projects";
import { useMapStore } from "@/stores/map-store";

/**
 * Which workspace the session is in, in the header, because a project silently
 * supplies the preset and weights the whole map is drawn from. Somewhere less
 * permanent and the reader would have no standing answer to "why is this map
 * showing retail".
 *
 * Switching only. Renaming and deleting live in the saved-sites panel, where
 * there is room for a real text field — editing inside a menu means fighting
 * the menu for the keyboard.
 */
export default function ProjectSwitcher() {
  const { projects, active, isLoading, openProject, createProject } = useProjects();
  const preset = useMapStore((state) => state.preset);
  const presets = useMapStore((state) => state.presets);
  const customWeights = useMapStore((state) => state.customWeights);
  const adopted = useRef(false);

  /**
   * Reopen the app into the project you last worked in, rather than into the
   * default preset with a project name in the header claiming otherwise. Runs
   * once: after this the session's own switches are what move the map, and
   * re-applying would stomp any weight edits made since.
   */
  useEffect(() => {
    if (adopted.current || !active) return;
    adopted.current = true;
    openProject(active);
  }, [active, openProject]);

  if (isLoading) return <Skeleton className="h-8 w-40 rounded-md" />;

  const handleCreate = () => {
    createProject.mutate({
      name: nextSequentialName("Project", projects),
      // Starts from what is on screen. Making a project is something you do
      // *because* of the map you have tuned, so an empty one would throw away
      // the setup that prompted it.
      preset,
      weights: (customWeights ?? presets?.[preset] ?? {}) as Record<string, number>,
    });
  };

  if (projects.length === 0) {
    return (
      <button
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-50"
        disabled={createProject.isPending}
        onClick={handleCreate}
        type="button"
      >
        <PlusIcon className="size-3.5" aria-hidden />
        {createProject.isPending ? "Creating…" : "New project"}
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-w-0 shrink items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-xs transition-colors hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
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
          onValueChange={(id) => {
            const next = projects.find((item) => item.id === id);
            if (next) openProject(next);
          }}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
