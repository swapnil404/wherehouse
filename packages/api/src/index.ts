import { initTRPC, TRPCError } from "@trpc/server";

import type { Context } from "./context";
import { GeoServiceError } from "./geo/client";

export const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    const geoError = error.cause instanceof GeoServiceError ? error.cause : null;

    return {
      ...shape,
      data: {
        ...shape.data,
        geoCode: geoError?.code ?? null,
        geoDetail: geoError?.detail ?? null,
      },
    };
  },
});

export const router = t.router;

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
      cause: "No session",
    });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});
