import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import Header from "@/components/header";
import { getUser } from "@/functions/get-user";

export const Route = createFileRoute("/_auth")({
  component: AuthLayout,
  beforeLoad: async ({ context }) => {
    const session = await getUser();
    if (!session) {
      throw redirect({
        to: "/login",
      });
    }
    // Begin the one project read as soon as authentication succeeds. Header
    // and dashboard consumers reuse this same in-flight cache entry.
    void context.queryClient.prefetchQuery({
      ...context.trpc.projects.list.queryOptions(),
      staleTime: 10 * 60 * 1000,
    });
    return { session };
  },
  loader: async ({ context }) => {
    if (!context.session) {
      throw redirect({
        to: "/login",
      });
    }
  },
});

function AuthLayout() {
  return (
    <div className="grid h-full grid-rows-[auto_1fr]">
      <Header />
      <Outlet />
    </div>
  );
}
