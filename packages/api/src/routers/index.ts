import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, publicProcedure, router } from "../index";
import {
  GeoServiceError,
  getHeatmap,
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
    heatmap: protectedProcedure
      .input(z.object({ preset: presetSchema.default("warehouse") }))
      .query(async ({ input }) => {
        try {
          return await getHeatmap(input.preset);
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
