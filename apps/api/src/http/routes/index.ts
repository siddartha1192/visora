import type { FastifyInstance } from "fastify";
import { assertMembership, authenticate } from "../middleware/auth.js";
import * as auth from "../controllers/auth.controller.js";
import * as posts from "../controllers/post.controller.js";
import * as assets from "../controllers/asset.controller.js";

/**
 * Route table. Public auth routes are open; everything else runs the
 * authenticate + assertMembership preHandlers, so both JWT and API-key callers
 * reach the same handlers with a resolved workspace context.
 */
export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true, service: "visora-api" }));

  app.register(
    async (r) => {
      r.post("/register", auth.register);
      r.post("/login", auth.login);
      r.post("/refresh", auth.refresh);
    },
    { prefix: "/v1/auth" },
  );

  // Authenticated API surface (JWT or API key).
  app.register(
    async (r) => {
      r.addHook("preHandler", authenticate);
      r.addHook("preHandler", assertMembership);

      r.get("/auth/me", auth.me);

      r.post("/posts", posts.create);
      r.get("/posts", posts.list);
      r.get("/posts/:id", posts.getOne);
      r.post("/posts/:id/cancel", posts.cancel);

      r.post("/assets", assets.upload);
      r.get("/assets/:id", assets.getOne);
    },
    { prefix: "/v1" },
  );
}
