import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { createTRPCClient, httpBatchLink, httpLink, splitLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@wherehouse/api/routers/index";
import { toast } from "sonner";

import Loader from "./components/loader";
import { routeTree } from "./routeTree.gen";
import { TRPCProvider } from "./utils/trpc";

function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // Background probes report their own state in their own UI. Letting
        // them through here means a cold analysis sidecar papers the screen
        // with retry toasts for a request the user never made.
        if (query.meta?.silent) return;
        toast.error(error.message, {
          action: {
            label: "retry",
            onClick: () => {
              query.invalidate();
            },
          },
        });
      },
    }),
    defaultOptions: { queries: { staleTime: 60 * 1000 } },
  });
}

function withCredentials(url: RequestInfo | URL, options?: RequestInit) {
  return fetch(url, { ...options, credentials: "include" });
}

/**
 * Batching, except for the warmup probe.
 *
 * `geo.health` waits on a service that is deliberately allowed to be asleep,
 * so it can sit for seconds at a time. Batched, it drags whatever shares its
 * HTTP request down with it — a save or a project list issued in the same tick
 * finishes no sooner than the probe does, and a probe whose socket dies takes
 * the whole batch with it. That turns "the analysis engine is warming up" into
 * "saving hangs and random things error", which is precisely the failure the
 * probe exists to explain.
 *
 * One slow request that blocks nothing is the entire point, so it gets its own.
 */
const trpcClient = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.path === "geo.health",
      true: httpLink({ url: "/api/trpc", fetch: withCredentials }),
      false: httpBatchLink({ url: "/api/trpc", fetch: withCredentials }),
    }),
  ],
});

export const getRouter = () => {
  const queryClient = createQueryClient();
  const trpc = createTRPCOptionsProxy({
    client: trpcClient,
    queryClient,
  });

  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    context: { trpc, queryClient },
    defaultPendingComponent: () => <Loader />,
    defaultNotFoundComponent: () => <div>Not Found</div>,
    Wrap: ({ children }) => (
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    ),
  });

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  });

  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
