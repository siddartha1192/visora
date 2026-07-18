import type { FastifyInstance } from "fastify";
import { assertMembership, authenticate } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import * as auth from "../controllers/auth.controller.js";
import * as posts from "../controllers/post.controller.js";
import * as assets from "../controllers/asset.controller.js";
import * as logs from "../controllers/log.controller.js";
import * as admin from "../controllers/admin.controller.js";
import * as prompts from "../controllers/prompt.controller.js";

const bearer = [{ bearerAuth: [] }];

const objectIdParam = {
  type: "object" as const,
  properties: { id: { type: "string", pattern: "^[a-f0-9]{24}$", description: "24-char hex MongoDB ObjectId" } },
  required: ["id"],
};

/**
 * Route table. Public auth routes are open; everything else runs the
 * authenticate + assertMembership preHandlers, so both JWT and API-key callers
 * reach the same handlers with a resolved workspace context.
 *
 * NOTE: response schemas are intentionally omitted — Fastify's fast-json-stringify
 * enforces required fields at serialization time, which breaks when the DTO shape
 * doesn't exactly match. Body/params/querystring schemas are enough for swagger docs.
 */
export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", {
    schema: {
      tags: ["system"],
      summary: "Health check",
    },
  }, async () => ({ ok: true, service: "visora-api" }));

  // ── Public auth routes ────────────────────────────────────────────────────
  app.register(
    async (r) => {
      r.post("/register", {
        schema: {
          tags: ["auth"],
          summary: "Register a new account",
          description: "Creates a user + default workspace. Returns access and refresh tokens.",
          body: {
            type: "object",
            required: ["name", "email", "password"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 100 },
              email: { type: "string", format: "email" },
              password: { type: "string", minLength: 8 },
            },
          },
        },
      }, auth.register);

      r.post("/login", {
        schema: {
          tags: ["auth"],
          summary: "Log in",
          description: "Returns access + refresh tokens. Use the `accessToken` as `Authorization: Bearer <token>` on all authenticated endpoints.",
          body: {
            type: "object",
            required: ["email", "password"],
            properties: {
              email: { type: "string", format: "email" },
              password: { type: "string" },
            },
          },
        },
      }, auth.login);

      r.post("/refresh", {
        schema: {
          tags: ["auth"],
          summary: "Refresh access token",
          description: "Exchange a refresh token for a new short-lived access token.",
          body: {
            type: "object",
            required: ["refreshToken"],
            properties: { refreshToken: { type: "string" } },
          },
        },
      }, auth.refresh);
    },
    { prefix: "/v1/auth" },
  );

  // ── Authenticated API surface (JWT or API key) ────────────────────────────
  app.register(
    async (r) => {
      r.addHook("preHandler", authenticate);
      r.addHook("preHandler", assertMembership);

      // Auth
      r.get("/auth/me", {
        schema: {
          tags: ["auth"],
          summary: "Get current user",
          description: "Returns the JWT claims for the authenticated user.",
          security: bearer,
        },
      }, auth.me);

      // Posts
      r.post("/posts", {
        schema: {
          tags: ["posts"],
          summary: "Create & enqueue a post",
          description: `Accepts a discriminated union on \`workflow\`. Content generation starts immediately in the background; \`schedule.runAt\` only controls when the **approved** post is published to social platforms.

**Workflows:**
| Value | Description |
|-------|-------------|
| \`passthrough\` | Upload an image and post it as-is |
| \`ai_generate\` | Generate an image with DALL·E 3 from a prompt |
| \`ai_enhance\` | Upload an image, apply AI edits, then post |
| \`stock_discovery\` | Search Pexels/Unsplash, optionally AI-enhance |
| \`scrape\` | Extract an image from a URL |
| \`autonomous\` | Free-form brief — the agent decides everything |

Returns **202 Accepted** immediately. Track status via \`GET /v1/posts/:id\`.`,
          security: bearer,
          body: {
            type: "object",
            required: ["workflow", "targets", "schedule", "caption"],
            properties: {
              workflow: {
                type: "string",
                enum: ["passthrough", "ai_generate", "ai_enhance", "stock_discovery", "scrape", "autonomous"],
                description: "Determines which pipeline branch runs",
              },
              brief: { type: "string", maxLength: 2000, description: "Free-form brief — **required** for `autonomous` workflow" },
              prompt: { type: "string", description: "Image prompt for `ai_generate`; search keywords for `stock_discovery`" },
              instructions: { type: "string", description: "DALL·E editing instructions for `ai_enhance`" },
              sourceUrl: { type: "string", description: "URL to scrape — **required** for `scrape` workflow" },
              context: { type: "string", description: "Image selector hint for `scrape` (e.g. 'the hero product photo')" },
              uploadedAssetId: { type: "string", description: "Asset ID from `POST /v1/assets` — required for `passthrough` and `ai_enhance`" },
              stockSource: { type: "string", enum: ["auto", "pexels", "unsplash"], default: "auto" },
              enhanceAfterStock: { type: "boolean", default: false, description: "Run AI enhancement after stock photo download" },
              enhanceInstructions: { type: "string", description: "DALL·E instructions for post-stock enhancement" },
              targets: {
                type: "array",
                minItems: 0,
                description: "Social accounts to publish to. Leave empty in autonomous mode — agent reads from the brief.",
                items: {
                  type: "object",
                  required: ["platform", "accountId"],
                  properties: {
                    platform: { type: "string", enum: ["instagram", "facebook", "x", "linkedin"] },
                    accountId: { type: "string", minLength: 1 },
                  },
                },
              },
              schedule: {
                type: "object",
                required: ["mode"],
                properties: {
                  mode: {
                    type: "string",
                    enum: ["instant", "scheduled", "auto"],
                    description: "`instant` = publish immediately after approval · `scheduled` = publish at `runAt` · `auto` = agent reads timing from brief (autonomous only)",
                  },
                  runAt: { type: "string", format: "date-time", description: "Required when mode is `scheduled`" },
                  timezone: { type: "string", default: "UTC" },
                },
              },
              caption: {
                type: "object",
                properties: {
                  text: { type: "string", description: "Pre-written caption (skip AI generation)" },
                  hashtags: { type: "array", items: { type: "string" } },
                  generate: { type: "boolean", default: false, description: "Let the agent write the caption" },
                },
              },
            },
          },
        },
      }, posts.create);

      r.get("/posts", {
        schema: {
          tags: ["posts"],
          summary: "List posts",
          description: "Returns all posts for the authenticated workspace, newest first.",
          security: bearer,
          querystring: {
            type: "object",
            properties: {
              page: { type: "number", default: 1, minimum: 1 },
              pageSize: { type: "number", default: 20, minimum: 1, maximum: 100 },
            },
          },
        },
      }, posts.list);

      r.get("/posts/:id", {
        schema: {
          tags: ["posts"],
          summary: "Get a single post",
          security: bearer,
          params: objectIdParam,
        },
      }, posts.getOne);

      r.post("/posts/:id/approve", {
        schema: {
          tags: ["posts"],
          summary: "Approve a post",
          description: `Resumes the paused LangGraph pipeline with an approval decision. Post must be in \`pending_review\` status.

If the post has a future \`schedule.runAt\`, a delayed BullMQ job is created that publishes to social platforms at that time. Pass \`scheduleMode: "instant"\` to override and publish immediately after approval.`,
          security: bearer,
          params: objectIdParam,
          body: {
            type: "object",
            properties: {
              scheduleMode: {
                type: "string",
                enum: ["instant", "scheduled"],
                description: "Override the delivery mode set at creation time",
              },
              scheduledAt: {
                type: "string",
                format: "date-time",
                description: "New publish time — required when `scheduleMode` is `scheduled`",
              },
            },
          },
        },
      }, posts.approve);

      r.post("/posts/:id/reject", {
        schema: {
          tags: ["posts"],
          summary: "Reject a post",
          description: "Resumes the graph with a rejection. Post moves to `rejected` status and no content is published.",
          security: bearer,
          params: objectIdParam,
        },
      }, posts.reject);

      r.post("/posts/:id/cancel", {
        schema: {
          tags: ["posts"],
          summary: "Cancel a post",
          description: "Soft-cancels a post. No-ops if the post is already published.",
          security: bearer,
          params: objectIdParam,
        },
      }, posts.cancel);

      r.post("/posts/:id/retry", {
        schema: {
          tags: ["posts"],
          summary: "Retry a failed post",
          description: "Retries a `failed` post. `mode=from_failed` re-runs only the publish step using existing generated content. `mode=full` resets the post and reruns the entire pipeline from scratch.",
          security: bearer,
          params: objectIdParam,
          body: {
            type: "object",
            required: ["mode"],
            properties: {
              mode: { type: "string", enum: ["from_failed", "full"] },
            },
          },
        },
      }, posts.retry);

      // Assets
      r.post("/assets", {
        schema: {
          tags: ["assets"],
          summary: "Upload an image",
          description: "Accepts `multipart/form-data` with a single file field. Max **15 MB**. Supported types: `image/png`, `image/jpeg`, `image/webp`.\n\nReturns the stored asset record — pass its `id` as `uploadedAssetId` when creating a `passthrough` or `ai_enhance` post.",
          security: bearer,
          consumes: ["multipart/form-data"],
        },
      }, assets.upload);

      r.get("/assets", {
        schema: {
          tags: ["assets"],
          summary: "List assets",
          description: "Returns all media assets in the workspace, newest first.",
          security: bearer,
          querystring: {
            type: "object",
            properties: {
              kind: {
                type: "string",
                enum: ["upload", "ai_generated", "stock", "scraped", "enhanced"],
                description: "Filter by asset origin",
              },
              page: { type: "number", default: 1, minimum: 1 },
              pageSize: { type: "number", default: 20, minimum: 1, maximum: 100 },
            },
          },
        },
      }, assets.list);

      r.get("/assets/:id", {
        schema: {
          tags: ["assets"],
          summary: "Get a single asset",
          security: bearer,
          params: objectIdParam,
        },
      }, assets.getOne);

      // Prompt utilities
      r.post("/prompts/refine", {
        schema: {
          tags: ["prompts"],
          summary: "Refine an image prompt",
          description: "Uses the configured LLM to rewrite a rough prompt into a detailed, evocative image-generation prompt.",
          security: bearer,
          body: {
            type: "object",
            required: ["prompt"],
            properties: {
              prompt: { type: "string", minLength: 1, maxLength: 1000 },
            },
          },
        },
      }, prompts.refinePrompt);

      // Logs
      r.get("/posts/:id/logs", {
        schema: {
          tags: ["logs"],
          summary: "Get pipeline execution logs",
          description: `Returns all AgentLog entries for a post in chronological order. Each entry describes one node execution event (started / succeeded / failed) plus pipeline-level start and completion events.

The \`done\` flag in the response indicates whether the pipeline has finished (either succeeded or failed). Poll this endpoint until \`done\` is true, or use the SSE stream endpoint for real-time updates.`,
          security: bearer,
          params: objectIdParam,
        },
      }, logs.getLogs);

      r.get("/posts/:id/logs/stream", {
        schema: {
          tags: ["logs"],
          summary: "Stream pipeline logs (SSE)",
          description: `Server-Sent Events stream of pipeline execution logs for a post.

Sends all existing log entries immediately on connect, then pushes new entries as they are written (polling every 500 ms). Emits three event types:
- \`connected\` — fired once after initial catch-up; includes \`{ postId, logCount }\`
- \`log\` — one per AgentLog entry; same shape as \`GET /posts/:id/logs\` items
- \`done\` — fired when the pipeline completes or fails; stream closes after this
- \`timeout\` — fired if the stream is still open after 10 minutes

Connect with: \`EventSource\` (browser) or any SSE client. Pass the Bearer token via query string or a pre-authorized cookie since \`EventSource\` does not support custom headers.`,
          security: bearer,
          params: objectIdParam,
        },
      }, logs.streamLogs);
    },
    { prefix: "/v1" },
  );

  // ── Admin routes — require JWT + isAdmin ────────────────────────────────────
  app.register(
    async (r) => {
      r.addHook("preHandler", authenticate);
      r.addHook("preHandler", requireAdmin);

      r.get("/me", {
        schema: { tags: ["admin"], summary: "Admin identity", security: bearer },
      }, admin.adminMe);

      r.get("/analytics", {
        schema: {
          tags: ["admin"],
          summary: "Usage analytics",
          security: bearer,
          querystring: {
            type: "object",
            properties: {
              range: { type: "string", enum: ["7d", "30d", "90d", "all"], default: "30d" },
            },
          },
        },
      }, admin.getAnalytics);

      r.get("/users", {
        schema: { tags: ["admin"], summary: "List all users", security: bearer },
      }, admin.listUsers);

      r.post("/users", {
        schema: {
          tags: ["admin"], summary: "Create a user", security: bearer,
          body: {
            type: "object", required: ["name", "email", "password"],
            properties: {
              name: { type: "string" }, email: { type: "string" },
              password: { type: "string", minLength: 8 }, isAdmin: { type: "boolean" },
            },
          },
        },
      }, admin.createUser);

      r.patch("/users/:id", {
        schema: {
          tags: ["admin"], summary: "Update user", security: bearer, params: objectIdParam,
          body: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["active", "suspended"] },
              isAdmin: { type: "boolean" },
            },
          },
        },
      }, admin.updateUser);

      r.delete("/users/:id", {
        schema: { tags: ["admin"], summary: "Delete user", security: bearer, params: objectIdParam },
      }, admin.deleteUser);

      r.get("/llm-configs", {
        schema: { tags: ["admin"], summary: "List LLM configs", security: bearer },
      }, admin.listLlmConfigs);

      r.post("/llm-configs", {
        schema: {
          tags: ["admin"], summary: "Add LLM config", security: bearer,
          body: {
            type: "object", required: ["label", "provider", "apiKey"],
            properties: {
              label: { type: "string" },
              provider: { type: "string", enum: ["openai", "anthropic", "google"] },
              apiKey: { type: "string" },
              chatModel: { type: "string" },
              imageModel: { type: "string" },
            },
          },
        },
      }, admin.createLlmConfig);

      r.patch("/llm-configs/:id", {
        schema: {
          tags: ["admin"], summary: "Update LLM config", security: bearer, params: objectIdParam,
          body: {
            type: "object",
            properties: {
              label: { type: "string" }, provider: { type: "string" },
              apiKey: { type: "string" }, chatModel: { type: "string" },
              imageModel: { type: "string" }, isActive: { type: "boolean" },
            },
          },
        },
      }, admin.updateLlmConfig);

      r.delete("/llm-configs/:id", {
        schema: { tags: ["admin"], summary: "Delete LLM config", security: bearer, params: objectIdParam },
      }, admin.deleteLlmConfig);

      r.get("/node-config", {
        schema: { tags: ["admin"], summary: "Get node→LLM assignments", security: bearer },
      }, admin.getNodeConfig);

      r.put("/node-config", {
        schema: {
          tags: ["admin"], summary: "Save node→LLM assignments", security: bearer,
          body: {
            type: "object", required: ["assignments"],
            properties: {
              assignments: {
                type: "object",
                properties: {
                  planner:     { type: ["string", "null"] },
                  caption:     { type: ["string", "null"] },
                  generation:  { type: ["string", "null"] },
                  enhancement: { type: ["string", "null"] },
                },
              },
            },
          },
        },
      }, admin.updateNodeConfig);
    },
    { prefix: "/v1/admin" },
  );
}
