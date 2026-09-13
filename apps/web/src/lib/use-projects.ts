import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@wherehouse/api/routers/index";
import { toast } from "sonner";

import { useMapStore } from "@/stores/map-store";
import { useProjectStore } from "@/stores/project-store";
import { useTRPC } from "@/utils/trpc";

import type { PresetName } from "./cells";
import { toWeights } from "./saved-sites";

export type Project = inferRouterOutputs<AppRouter>["projects"]["list"][number];
export type SavedSite = Project["savedSites"][number];

/**
 * The session's projects, and the one it is working in.
 *
 * Server state stays in the query cache and the active id stays in a store, so
 * "which project" and "what is in it" cannot drift apart. Everything a caller
 * needs is derived from those two, including the resolution of a `null` active
 * id to the most recently touched project — a rule that lives here rather than
 * in each consumer so the header and the saved list can never disagree about
 * which project is open.
 *
 * Mutations invalidate rather than patch the cache. A project's `updatedAt`
 * reorders the list and its site count gates the save button, so a hand-patched
 * cache would have to reproduce server ordering and limit logic to stay honest.
 */
export function useProjects() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const storedId = useProjectStore((state) => state.activeProjectId);
  const setActiveProjectId = useProjectStore((state) => state.setActiveProjectId);
  const applyProjectSetup = useMapStore((state) => state.applyProjectSetup);

  const list = useQuery(trpc.projects.list.queryOptions());
  const projects = list.data ?? [];

  // Ordered by `updatedAt` on the server, so index 0 is the one most recently
  // worked in — the right default when the session has not chosen yet, and the
  // right fallback when the chosen one has just been deleted.
  const active = projects.find((item) => item.id === storedId) ?? projects[0] ?? null;

  /**
   * Deliberately not awaited by the mutations below.
   *
   * React Query keeps a mutation `isPending` until its `onSuccess` settles, so
   * returning this promise makes "Saving…" cover the write *and* a full re-read
   * of every project and its sites. The write is the part the button is about;
   * the refetch is bookkeeping for a list that may not even be on screen, and
   * charging the user's feedback for it is what made saving feel like it had
   * hung. The refetch still happens — the button just stops claiming to be
   * waiting on it.
   */
  const invalidate = () => {
    void queryClient.invalidateQueries(trpc.projects.list.queryFilter());
  };

  const reportFailure = (error: unknown) => {
    toast.error(error instanceof Error ? error.message : "Something went wrong");
  };

  const openProject = (project: Project) => {
    setActiveProjectId(project.id);
    applyProjectSetup(
      project.preset as PresetName,
      toWeights(project.weights as Record<string, number>),
    );
  };

  const createProject = useMutation(
    trpc.projects.create.mutationOptions({
      onSuccess: (project) => {
        // Switching to what you just made is the only sensible outcome; a new
        // project that leaves you in the old one is a dead click. Set before
        // invalidating so the header names it without waiting on the refetch.
        setActiveProjectId(project.id);
        invalidate();
      },
      onError: reportFailure,
    }),
  );

  const updateProject = useMutation(
    trpc.projects.update.mutationOptions({ onSuccess: invalidate, onError: reportFailure }),
  );

  const deleteProject = useMutation(
    trpc.projects.delete.mutationOptions({
      onSuccess: (_result, variables) => {
        // Fall back to whatever the refreshed list puts first rather than
        // pinning a dead id, which would render an empty saved list for a
        // project that no longer exists.
        if (variables.projectId === storedId) setActiveProjectId(null);
        invalidate();
      },
      onError: reportFailure,
    }),
  );

  const saveSite = useMutation(
    trpc.projects.savedSites.create.mutationOptions({
      onSuccess: invalidate,
      onError: reportFailure,
    }),
  );

  const updateSite = useMutation(
    trpc.projects.savedSites.update.mutationOptions({
      onSuccess: invalidate,
      onError: reportFailure,
    }),
  );

  const deleteSite = useMutation(
    trpc.projects.savedSites.delete.mutationOptions({
      onSuccess: invalidate,
      onError: reportFailure,
    }),
  );

  return {
    projects,
    active,
    isLoading: list.isPending,
    openProject,
    setActiveProjectId,
    createProject,
    updateProject,
    deleteProject,
    saveSite,
    updateSite,
    deleteSite,
  };
}
