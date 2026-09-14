import { createFileRoute } from "@tanstack/react-router";

import Header from "@/components/header";
import MapView from "@/components/map-view";

export const Route = createFileRoute("/_auth/dashboard")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="grid h-full grid-rows-[auto_1fr]">
      <Header />
      <MapView />
    </div>
  );
}
