import type { FastifyInstance } from "fastify";
import { assertMembership, authenticate } from "../middleware/auth.js";
import * as auth from "../controllers/auth.controller.js";
import * as posts from "../controllers/post.controller.js";
import * as assets from "../controllers/asset.controller.js";

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
                    accountId: { type: "string", pattern: "^[a-f0-9]{24}$" },
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
    },
    { prefix: "/v1" },
  );
}
