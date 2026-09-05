import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import MapView from "@/components/map-view";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/_auth/dashboard")({
  component: RouteComponent,
});

function RouteComponent() {
  const { session } = Route.useRouteContext();

  const trpc = useTRPC();
  const privateData = useQuery(trpc.privateData.queryOptions());

  return (
    <div className="relative h-full w-full">
      <MapView />
      <div className="pointer-events-none absolute top-4 left-4 rounded-md bg-neutral-950/80 px-3 py-2 text-sm">
        <p>Welcome {session?.user.name}</p>
        <p>API: {privateData.data?.message}</p>
      </div>
    </div>
  );
}
