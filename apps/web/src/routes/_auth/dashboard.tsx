import { createFileRoute } from "@tanstack/react-router";

import MapView from "@/components/map-view";

export const Route = createFileRoute("/_auth/dashboard")({
  component: RouteComponent,
});

function RouteComponent() {
  return <MapView />;
}
