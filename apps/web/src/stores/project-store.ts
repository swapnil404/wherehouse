import { create } from "zustand";

/**
 * Which project the session is working in.
 *
 * Only the id lives here. The project itself — its name, preset, weights and
 * saved sites — is server state owned by the `projects.list` query, and keeping
 * a second copy in a store is how the header and the saved list end up
 * disagreeing about how many sites a project holds.
 *
 * `null` means "not chosen yet" rather than "no project". Resolving that to an
 * actual project is `useProjects`'s job, because the answer depends on a query
 * this store cannot see.
 */
interface ProjectStore {
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  activeProjectId: null,
  setActiveProjectId: (activeProjectId) => set({ activeProjectId }),
}));
