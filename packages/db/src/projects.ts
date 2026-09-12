import { and, desc, eq, sql } from "drizzle-orm";

import { createDb } from "./index";
import { project, savedSite } from "./schema";

export const MAX_SAVED_SITES_PER_PROJECT = 5;

export class ProjectNotFoundError extends Error {
  constructor() {
    super("Project not found");
    this.name = "ProjectNotFoundError";
  }
}

export class SavedSiteNotFoundError extends Error {
  constructor() {
    super("Saved site not found");
    this.name = "SavedSiteNotFoundError";
  }
}

export class SavedSiteLimitError extends Error {
  constructor() {
    super(`A project can save at most ${MAX_SAVED_SITES_PER_PROJECT} sites`);
    this.name = "SavedSiteLimitError";
  }
}

export interface CreateProjectInput {
  name: string;
  description?: string | null;
  preset: string;
  weights: Record<string, number>;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  preset?: string;
  weights?: Record<string, number>;
}

export interface CreateSavedSiteInput {
  name: string;
  latitude: number;
  longitude: number;
  h3Cell?: string | null;
  notes?: string | null;
  scoreSnapshot: Record<string, unknown>;
}

export interface UpdateSavedSiteInput {
  name?: string;
  latitude?: number;
  longitude?: number;
  h3Cell?: string | null;
  notes?: string | null;
  scoreSnapshot?: Record<string, unknown>;
}

export async function listProjects(userId: string) {
  return createDb().query.project.findMany({
    where: eq(project.userId, userId),
    with: {
      savedSites: {
        orderBy: desc(savedSite.updatedAt),
      },
    },
    orderBy: desc(project.updatedAt),
  });
}

export async function getProject(userId: string, projectId: string) {
  return createDb().query.project.findFirst({
    where: and(eq(project.id, projectId), eq(project.userId, userId)),
    with: {
      savedSites: {
        orderBy: desc(savedSite.updatedAt),
      },
    },
  });
}

export async function createProject(userId: string, input: CreateProjectInput) {
  const [created] = await createDb()
    .insert(project)
    .values({ userId, ...input })
    .returning();
  return created;
}

export async function updateProject(
  userId: string,
  projectId: string,
  input: UpdateProjectInput,
) {
  const [updated] = await createDb()
    .update(project)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(project.id, projectId), eq(project.userId, userId)))
    .returning();

  if (!updated) throw new ProjectNotFoundError();
  return updated;
}

export async function deleteProject(userId: string, projectId: string) {
  const [deleted] = await createDb()
    .delete(project)
    .where(and(eq(project.id, projectId), eq(project.userId, userId)))
    .returning({ id: project.id });

  if (!deleted) throw new ProjectNotFoundError();
  return deleted;
}

export async function createSavedSite(
  userId: string,
  projectId: string,
  input: CreateSavedSiteInput,
) {
  return createDb().transaction(async (transaction) => {
    // Serialise saves for this project so two simultaneous fifth-site requests
    // cannot both pass the limit check.
    await transaction.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${projectId}::text, 0::bigint))
    `);

    const [ownedProject] = await transaction
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.userId, userId)))
      .limit(1);
    if (!ownedProject) throw new ProjectNotFoundError();

    const [siteCount] = await transaction
      .select({ count: sql<number>`count(*)::int` })
      .from(savedSite)
      .where(eq(savedSite.projectId, projectId));
    if ((siteCount?.count ?? 0) >= MAX_SAVED_SITES_PER_PROJECT) {
      throw new SavedSiteLimitError();
    }

    const [created] = await transaction
      .insert(savedSite)
      .values({ projectId, ...input })
      .returning();
    await transaction
      .update(project)
      .set({ updatedAt: new Date() })
      .where(eq(project.id, projectId));
    return created;
  });
}

export async function updateSavedSite(
  userId: string,
  siteId: string,
  input: UpdateSavedSiteInput,
) {
  const database = createDb();
  const [ownedSite] = await database
    .select({ id: savedSite.id, projectId: savedSite.projectId })
    .from(savedSite)
    .innerJoin(project, eq(project.id, savedSite.projectId))
    .where(and(eq(savedSite.id, siteId), eq(project.userId, userId)))
    .limit(1);
  if (!ownedSite) throw new SavedSiteNotFoundError();

  const [updated] = await database
    .update(savedSite)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(savedSite.id, siteId))
    .returning();
  if (!updated) throw new SavedSiteNotFoundError();

  await database
    .update(project)
    .set({ updatedAt: new Date() })
    .where(eq(project.id, ownedSite.projectId));
  return updated;
}

export async function deleteSavedSite(userId: string, siteId: string) {
  const database = createDb();
  const [ownedSite] = await database
    .select({ id: savedSite.id, projectId: savedSite.projectId })
    .from(savedSite)
    .innerJoin(project, eq(project.id, savedSite.projectId))
    .where(and(eq(savedSite.id, siteId), eq(project.userId, userId)))
    .limit(1);
  if (!ownedSite) throw new SavedSiteNotFoundError();

  const [deleted] = await database
    .delete(savedSite)
    .where(eq(savedSite.id, siteId))
    .returning({ id: savedSite.id });
  if (!deleted) throw new SavedSiteNotFoundError();

  await database
    .update(project)
    .set({ updatedAt: new Date() })
    .where(eq(project.id, ownedSite.projectId));
  return deleted;
}
