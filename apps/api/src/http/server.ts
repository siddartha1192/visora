import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { isProd } from "../config/env.js";
import { UPLOADS_DIR } from "../integrations/storage/local-disk.adapter.js";
import { loggerOptions } from "../lib/logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { registerRoutes } from "./routes/index.js";

/**
 * Builds the Fastify app: security headers, CORS for the web origin, JWT,
 * multipart uploads, rate limiting, the global error handler, and routes.
 * Stateless — scale horizontally. It never runs the graph; it only enqueues.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions, trustProxy: true });

  await app.register(helmet, {
    // Allow the Next.js dev server (different port) to load images from this API.
    crossOriginResourcePolicy: { policy: isProd ? "same-origin" : "cross-origin" },
  });
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(multipart);
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  // Serve locally-stored images when running without S3 (dev / no AWS keys).
  if (!isProd) {
    await app.register(staticFiles, {
      root: UPLOADS_DIR,
      prefix: "/uploads/",
      decorateReply: false,
    });
  }

  app.setErrorHandler(errorHandler);
  await registerRoutes(app);

  return app;
}
