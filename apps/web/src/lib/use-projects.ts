import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@wherehouse/api/routers/index";
import { toast } from "sonner";

import { useMapStore } from "@/stores/map-store";
import { useProjectStore } from "@/stores/project-store";
import { useTRPC } from "@/utils/trpc";

import type { PresetName } from "./cells";
import { resolveActiveProject, toWeights } from "./saved-sites";

export type Project = inferRouterOutputs<AppRouter>["projects"]["list"][number];
export type SavedSite = Project["savedSites"][number];

/**
 * The session's projects, and the one it is working in.
 *
 * Server state stays in the query cache and the active id stays in a store, so
 * "which project" and "what is in it" cannot drift apart. Resolving the two
 * into an active project lives in `resolveActiveProject` so the header and the
 * saved list can never disagree about which project is open.
 *
 * **Every mutation patches the cache before invalidating.** Invalidation alone
 * leaves a window between the write landing and the re-read arriving in which
 * the UI still describes the world as it was, and in this feature that window
 * is not cosmetic: for as long as it is open the freshly created project is
 * absent from the list, so a save aims at whichever project sorts first, and
 * the freshly saved site is absent from its project, so the Save button offers
 * itself again and a second click burns another of the five slots on a
 * duplicate. The patch is about *membership* — which projects exist, which
 * sites are in them — and does not try to reproduce the server's `updatedAt`
 * ordering. The refetch that follows reconciles that.
 */
export function useProjects() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const storedId = useProjectStore((state) => state.activeProjectId);
  const setActiveProjectId = useProjectStore((state) => state.setActiveProjectId);
  const applyProjectSetup = useMapStore((state) => state.applyProjectSetup);

  const list = useQuery(trpc.projects.list.queryOptions());
  const projects = list.data ?? [];
  const active = resolveActiveProject(projects, storedId);

  const listKey = trpc.projects.list.queryKey();

  const patchList = (update: (projects: Project[]) => Project[]) => {
    queryClient.setQueryData<Project[]>(listKey, (current) =>
      current ? update(current) : current,
    );
  };

  const patchProject = (projectId: string, update: (project: Project) => Project) => {
    patchList((current) =>
      current.map((project) => (project.id === projectId ? update(project) : project)),
    );
  };

  /**
   * Deliberately not awaited by the mutations below.
   *
   * React Query keeps a mutation `isPending` until its `onSuccess` settles, so
   * returning this promise makes "Saving…" cover the write *and* a full re-read
   * of every project and its sites. The write is the part the button is about.
   * The cache patch that precedes each call is what makes that safe — without
   * it, dropping the await would just move the lie from the spinner to the
   * list.
   */
  const invalidate = () => {
    void queryClient.invalidateQueries(trpc.projects.list.queryFilter());
  };

  const reportFailure = (error: unknown) => {
    toast.error(error instanceof Error ? error.message : "Something went wrong");
  };

  /** Hands the map over to a project's use case and priorities. */
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
        // Into the cache *and* selected, in that order, so the very next render
        // resolves the new id to the new project. Switching to what you just
        // made is the only sensible outcome; a new project that leaves you in
        // the old one is a dead click.
        patchList((current) => [{ ...project, savedSites: [] }, ...current]);
        setActiveProjectId(project.id);
        invalidate();
      },
      onError: reportFailure,
    }),
  );

  const updateProject = useMutation(
    trpc.projects.update.mutationOptions({
      /**
       * Optimistic for the same reason `updateSite` is: the rename field reads
       * the project's name when it mounts, and it mounts fresh every time the
       * menu's Rename is picked. Patching only on success leaves a window in
       * which the header and that field still show the *old* name, so renaming
       * twice in quick succession seeds the second edit from the stale value
       * and writes it back over the first.
       */
      onMutate: ({ projectId, ...updates }) => {
        const previous = queryClient.getQueryData<Project[]>(listKey);
        patchProject(projectId, (current) => ({ ...current, ...updates }));
        return { previous };
      },
      onError: (error, _variables, context) => {
        if (context?.previous) queryClient.setQueryData(listKey, context.previous);
        reportFailure(error);
      },
      onSuccess: (project) => {
        // Reconciles against the server row, keeping the existing sites: the
        // update endpoint returns the project alone, and splicing it in whole
        // would empty the saved list.
        patchProject(project.id, (current) => ({ ...current, ...project }));
      },
      onSettled: invalidate,
    }),
  );

  const deleteProject = useMutation(
    trpc.projects.delete.mutationOptions({
      onSuccess: (_result, variables) => {
        patchList((current) =>
          current.filter((project) => project.id !== variables.projectId),
        );
        // Clearing the id rather than picking a successor here: with the id
        // null, resolution falls to the most recently worked-in project that
        // survives, and the switcher notices the change and hands the map over.
        if (variables.projectId === storedId) setActiveProjectId(null);
        invalidate();
      },
      onError: reportFailure,
    }),
  );

  const saveSite = useMutation(
    trpc.projects.savedSites.create.mutationOptions({
      onSuccess: (site) => {
        patchProject(site.projectId, (current) => ({
          ...current,
          savedSites: [site, ...current.savedSites],
        }));
        invalidate();
      },
      onError: reportFailure,
    }),
  );

  const updateSite = useMutation(
    trpc.projects.savedSites.update.mutationOptions({
      /**
       * Applied before the request leaves, unlike every other mutation here,
       * which patches on success.
       *
       * The notes field is an uncontrolled textarea inside a row that collapses,
       * so it unmounts the moment the row closes and re-reads the cache when it
       * reopens. Patching on success leaves a window a second or so wide in
       * which the cache still holds the *previous* note — collapse and reopen
       * inside it and the text the user just typed is replaced by the text it
       * was about to overwrite, which reads exactly like the save silently
       * failing. Nothing here is worth showing a spinner for, so the cache
       * carries the typed value immediately and the server confirms it.
       */
      onMutate: ({ siteId, ...updates }) => {
        const previous = queryClient.getQueryData<Project[]>(listKey);
        patchList((current) =>
          current.map((project) => ({
            ...project,
            savedSites: project.savedSites.map((site) =>
              site.id === siteId ? { ...site, ...updates } : site,
            ),
          })),
        );
        return { previous };
      },
      onError: (error, _variables, context) => {
        // Put the old text back rather than leaving the field showing an edit
        // the server rejected.
        if (context?.previous) queryClient.setQueryData(listKey, context.previous);
        reportFailure(error);
      },
      onSuccess: (site) => {
        patchProject(site.projectId, (current) => ({
          ...current,
          savedSites: current.savedSites.map((existing) =>
            existing.id === site.id ? { ...existing, ...site } : existing,
          ),
        }));
      },
      onSettled: invalidate,
    }),
  );

  const deleteSite = useMutation(
    trpc.projects.savedSites.delete.mutationOptions({
      onSuccess: (_result, variables) => {
        // The delete endpoint returns only the id, so the owning project is
        // found by searching rather than read off the response.
        patchList((current) =>
          current.map((project) => ({
            ...project,
            savedSites: project.savedSites.filter((site) => site.id !== variables.siteId),
          })),
        );
        invalidate();
      },
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
