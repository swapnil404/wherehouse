import { createMiddleware } from "@tanstack/react-start";
import { createAuth } from "@wherehouse/auth";

export const authMiddleware = createMiddleware().server(async ({ next, request }) => {
  const session = await createAuth().api.getSession({
    headers: request.headers,
  });
  return next({
    context: { session },
  });
});
