import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@wherehouse/api/routers/index";

export const { TRPCProvider, useTRPC, useTRPCClient } =
  createTRPCContext<AppRouter>();
