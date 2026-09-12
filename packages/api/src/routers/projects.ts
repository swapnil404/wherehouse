import { TRPCError } from "@trpc/server";
import {
  createProject,
  createSavedSite,
  deleteProject,
  deleteSavedSite,
  getProject,
  listProjects,
  ProjectNotFoundError,
  SavedSiteLimitError,
  SavedSiteNotFoundError,
  updateProject,
  updateSavedSite,
} from "@wherehouse/db/projects";
import { z } from "zod";

import { protectedProcedure, router } from "../index";

const idSchema = z.string().uuid();
const nameSchema = z.string().trim().min(1).max(80);
const descriptionSchema = z.string().trim().max(500).nullable();
const notesSchema = z.string().trim().max(2_000).nullable();
const presetSchema = z.enum(["warehouse", "retail", "ev"]);
const weightsSchema = z.record(z.string(), z.number().finite().nonnegative());
const h3Schema = z.string().regex(/^88[0-9a-f]{13}$/i).nullable();
const scoreSnapshotSchema = z.record(z.string(), z.unknown());

function mapProjectError(error: unknown): never {
  if (error instanceof SavedSiteLimitError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof ProjectNotFoundError || error instanceof SavedSiteNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  throw error;
}

export const projectsRouter = router({
  list: protectedProcedure.query(({ ctx }) => listProjects(ctx.session.user.id)),

  byId: protectedProcedure
    .input(z.object({ projectId: idSchema }))
    .query(async ({ ctx, input }) => {
      const found = await getProject(ctx.session.user.id, input.projectId);
      if (!found) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      return found;
    }),

  create: protectedProcedure
    .input(z.object({
      name: nameSchema,
      description: descriptionSchema.optional(),
      preset: presetSchema.default("warehouse"),
      weights: weightsSchema.default({}),
    }))
    .mutation(({ ctx, input }) => createProject(ctx.session.user.id, input)),

  update: protectedProcedure
    .input(z.object({
      projectId: idSchema,
      name: nameSchema.optional(),
      description: descriptionSchema.optional(),
      preset: presetSchema.optional(),
      weights: weightsSchema.optional(),
    }).refine(
      ({ projectId: _projectId, ...updates }) => Object.keys(updates).length > 0,
      "Provide at least one field to update",
    ))
    .mutation(async ({ ctx, input: { projectId, ...updates } }) => {
      try {
        return await updateProject(ctx.session.user.id, projectId, updates);
      } catch (error) {
        return mapProjectError(error);
      }
    }),

  delete: protectedProcedure
    .input(z.object({ projectId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await deleteProject(ctx.session.user.id, input.projectId);
      } catch (error) {
        return mapProjectError(error);
      }
    }),

  savedSites: router({
    create: protectedProcedure
      .input(z.object({
        projectId: idSchema,
        name: nameSchema,
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        h3Cell: h3Schema.optional(),
        notes: notesSchema.optional(),
        scoreSnapshot: scoreSnapshotSchema,
      }))
      .mutation(async ({ ctx, input: { projectId, ...site } }) => {
        try {
          return await createSavedSite(ctx.session.user.id, projectId, site);
        } catch (error) {
          return mapProjectError(error);
        }
      }),

    update: protectedProcedure
      .input(z.object({
        siteId: idSchema,
        name: nameSchema.optional(),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        h3Cell: h3Schema.optional(),
        notes: notesSchema.optional(),
        scoreSnapshot: scoreSnapshotSchema.optional(),
      }).refine(
        ({ siteId: _siteId, ...updates }) => Object.keys(updates).length > 0,
        "Provide at least one field to update",
      ))
      .mutation(async ({ ctx, input: { siteId, ...updates } }) => {
        try {
          return await updateSavedSite(ctx.session.user.id, siteId, updates);
        } catch (error) {
          return mapProjectError(error);
        }
      }),

    delete: protectedProcedure
      .input(z.object({ siteId: idSchema }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await deleteSavedSite(ctx.session.user.id, input.siteId);
        } catch (error) {
          return mapProjectError(error);
        }
      }),
  }),
});
