import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { isProd } from "../config/env.js";
import { UPLOADS_DIR } from "../integrations/storage/local-disk.adapter.js";
import { appLog } from "../lib/logging/index.js";
import { loggerOptions } from "../lib/logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { registerRoutes } from "./routes/index.js";
import { registerSchemas } from "./swagger-schemas.js";

/**
 * Builds the Fastify app: security headers, CORS for the web origin, JWT,
 * multipart uploads, rate limiting, the global error handler, and routes.
 * Stateless — scale horizontally. It never runs the graph; it only enqueues.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions, trustProxy: true });

  // OpenAPI spec + Swagger UI — registered before routes so the spec is populated.
  // Only exposed in non-production environments.
  if (!isProd) {
    await app.register(swagger, {
      openapi: {
        openapi: "3.0.3",
        info: {
          title: "Visora API",
          description: "Social media scheduling & autonomous content pipeline",
          version: "1.0.0",
        },
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "JWT",
              description: "Access token from /v1/auth/login",
            },
          },
        },
        tags: [
          { name: "auth", description: "Authentication — register, login, token refresh" },
          { name: "posts", description: "Content pipeline — create, review, approve, publish" },
          { name: "assets", description: "Media library — upload and retrieve images" },
          { name: "logs", description: "Pipeline execution logs — real-time node events, status, and SSE streaming" },
          { name: "workspaces", description: "Workspaces — the brands/products inside your organization" },
          { name: "invites", description: "Self-serve email invites onto a workspace" },
          { name: "llm-configs", description: "Bring-your-own-key LLM configs, scoped to your own organization" },
          { name: "admin", description: "Organization admin — users and content, scoped to your own tenant" },
          { name: "platform", description: "Platform operator only — tenant provisioning and shared infrastructure" },
        ],
      },
    });

    await app.register(swaggerUi, {
      routePrefix: "/docs",
      uiConfig: { docExpansion: "list", deepLinking: true, tryItOutEnabled: true },
    });
  }

  await app.register(helmet, {
    // CSP is intentionally disabled: this server only serves JSON + Swagger UI (dev).
    // End-user CSP is handled by the Next.js web layer.
    contentSecurityPolicy: false,
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

  // Structured request logging — runs after auth preHandlers so req.auth is populated.
  app.addHook("onResponse", (req, reply, done) => {
    const auth = req.auth;
    const user = auth?.userId
      ? { id: auth.userId, name: auth.userName, email: auth.userEmail }
      : undefined;

    const level = reply.statusCode >= 500 ? "error"
      : reply.statusCode >= 400 ? "warn"
      : "info";

    const meta = {
      method: req.method,
      url: req.url,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
      ...(user ? { user } : {}),
    };

    if (level === "error") {
      appLog.error("http request", meta);
    } else if (level === "warn") {
      appLog.warn("http request", meta);
    } else {
      appLog.info("http request", meta);
    }

    done();
  });

  app.setErrorHandler(errorHandler);
  registerSchemas(app);
  await registerRoutes(app);

  return app;
}
