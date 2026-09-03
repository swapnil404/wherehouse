import { createFileRoute } from "@tanstack/react-router";
import { createAuth } from "@wherehouse/auth";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const auth = createAuth();
        return auth.handler(request);
      },
      POST: ({ request }) => {
        const auth = createAuth();
        return auth.handler(request);
      },
    },
  },
});
