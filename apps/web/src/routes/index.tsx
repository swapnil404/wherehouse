import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  // Into the welcome page rather than straight onto the map: it is where a
  // session either states what it is looking for or declines to. The header
  // wordmark leads back here too, so starting over is always one click away.
  beforeLoad: () => {
    throw redirect({ to: "/welcome" });
  },
});
