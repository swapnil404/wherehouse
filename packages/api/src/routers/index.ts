import { TRPCError } from "@trpc/server";
import { getActiveCatchment } from "@wherehouse/db";
import { z } from "zod";

import { protectedProcedure, publicProcedure, router } from "../index";
import {
  GeoServiceError,
  getHeatmap,
  getHotspots,
  getPresets,
  scoreBatch,
  scorePoint,
  type PresetName,
} from "../geo/client";

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

const weightsSchema = z.record(z.string(), z.number().finite().nonnegative());

export const PRESET_NAMES = ["warehouse", "retail", "ev"] as const satisfies readonly PresetName[];

/**
 * Guard against the list falling behind the API. Assigning a `PresetName` to
 * the tuple's union fails to compile if the Python side gains a preset that is
 * not listed above — which is how `ev` previously ended up unreachable.
 */
const _assertPresetsExhaustive: (typeof PRESET_NAMES)[number] =
  null as unknown as PresetName;
void _assertPresetsExhaustive;

const presetSchema = z.enum(PRESET_NAMES);
const hotspotMethodSchema = z.enum(["gi_star", "dbscan", "binning"]);
const reachabilityModeSchema = z.enum(["car", "foot"]);
const resolutionEightH3Schema = z.string().regex(
  /^88[0-9a-f]{13}$/i,
  "Expected a resolution-8 H3 index",
);

function mapGeoError(error: unknown): never {
  if (!(error instanceof GeoServiceError)) {
    throw error;
  }

  throw new TRPCError({
    code: error.status === 413
      ? "PAYLOAD_TOO_LARGE"
      : error.status === 422
        ? "UNPROCESSABLE_CONTENT"
        : error.status === 401 || error.status === 403 || error.status >= 500
          ? "BAD_GATEWAY"
          : "BAD_REQUEST",
    message: error.message,
    cause: error,
  });
}

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
    };
  }),
  geo: router({
    catchment: protectedProcedure
      .input(z.object({
        h3Index: resolutionEightH3Schema,
        mode: reachabilityModeSchema,
      }))
      .query(async ({ input }) => {
        const catchment = await getActiveCatchment(input.h3Index, input.mode);
        if (!catchment) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No catchment data exists for this H3 cell in the active dataset",
          });
        }

        return catchment;
      }),
    heatmap: protectedProcedure
      .input(z.object({ preset: presetSchema.default("warehouse") }))
      .query(async ({ input }) => {
        try {
          return await getHeatmap(input.preset);
        } catch (error) {
          return mapGeoError(error);
        }
      }),
    hotspots: protectedProcedure
      .input(z.object({
        method: hotspotMethodSchema.default("gi_star"),
        preset: presetSchema.default("warehouse"),
        weights: weightsSchema.nullish(),
        k: z.number().int().min(1).max(4).default(2),
        threshold: z.number().min(0).max(100).default(70),
        eps_km: z.number().min(0.1).max(10).default(1.5),
        min_samples: z.number().int().min(2).max(50).default(4),
      }))
      .mutation(async ({ input }) => {
        try {
          return await getHotspots(input);
        } catch (error) {
          return mapGeoError(error);
        }
      }),
    presets: protectedProcedure.query(async () => {
      try {
        return await getPresets();
      } catch (error) {
        return mapGeoError(error);
      }
    }),
    score: protectedProcedure
      .input(z.object({
        point: pointSchema,
        preset: presetSchema.default("warehouse"),
        weights: weightsSchema.nullish(),
      }))
      .mutation(async ({ input }) => {
        try {
          return await scorePoint(input);
        } catch (error) {
          return mapGeoError(error);
        }
      }),
    scoreBatch: protectedProcedure
      .input(z.object({
        points: z.array(pointSchema).min(1).max(5000),
        preset: presetSchema.default("warehouse"),
        weights: weightsSchema.nullish(),
      }))
      .mutation(async ({ input }) => {
        try {
          return await scoreBatch(input);
        } catch (error) {
          return mapGeoError(error);
        }
      }),
  }),
});
export type AppRouter = typeof appRouter;
