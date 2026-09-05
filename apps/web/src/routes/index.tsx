import { createFileRoute } from "@tanstack/react-router";

import MapView from "@/components/map-view";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return <MapView />;
}
