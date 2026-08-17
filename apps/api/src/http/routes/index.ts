import type { FastifyInstance } from "fastify";
import { assertMembership, authenticate } from "../middleware/auth.js";
import { requireOrgMember, requireOrgOwner, requirePlatform } from "../middleware/admin.js";
import * as auth from "../controllers/auth.controller.js";
import * as posts from "../controllers/post.controller.js";
import * as assets from "../controllers/asset.controller.js";
import * as logs from "../controllers/log.controller.js";
import * as admin from "../controllers/admin.controller.js";
import * as prompts from "../controllers/prompt.controller.js";
import * as workspace from "../controllers/workspace.controller.js";
import * as platform from "../controllers/platform.controller.js";
import * as invitations from "../controllers/invitation.controller.js";
import * as orgLlmConfigs from "../controllers/llm-config.controller.js";

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
      // NOTE: POST /register was removed. It was the only thing that created a
      // workspace and it handed one to any anonymous caller, which is
      // incompatible with tenants being provisioned off a subscription.
      // New customers  → POST /v1/platform/tenants (platform staff)
      // New colleagues → POST /v1/admin/users      (their own org's admins)

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

  // ── Public invite routes ──────────────────────────────────────────────────
  app.register(
    async (r) => {
      r.get("/:token", {
        schema: {
          tags: ["invites"],
          summary: "Preview an invitation",
          description: "Public — lets the frontend show \"You've been invited to join {org}\" before the recipient sets a password.",
          params: {
            type: "object",
            required: ["token"],
            properties: { token: { type: "string" } },
          },
        },
      }, invitations.previewInvite);

      r.post("/:token/accept", {
        schema: {
          tags: ["invites"],
          summary: "Accept an invitation",
          description: "Public — validates the token and expiry, creates the account bound to the invited workspace/role, and marks the invitation accepted.",
          params: {
            type: "object",
            required: ["token"],
            properties: { token: { type: "string" } },
          },
          body: {
            type: "object",
            required: ["name", "password"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 120 },
              password: { type: "string", minLength: 8 },
            },
          },
        },
      }, invitations.acceptInvite);
    },
    { prefix: "/v1/invites" },
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

      // API keys — self-service, machine-to-machine credentials for the
      // caller's own workspace. Any logged-in user may mint/list/revoke
      // their own keys, same as how OpenAI/Stripe/GitHub let any account
      // holder generate a key for themselves — no admin involved.
      r.post("/api-keys", {
        schema: {
          tags: ["auth"],
          summary: "Create an API key for your workspace",
          description: "Mints a new `x-api-key` credential for the caller's own workspace. The raw secret is returned exactly once and cannot be recovered afterwards — copy it immediately.",
          security: bearer,
          body: {
            type: "object",
            required: ["label", "expiresInDays"],
            properties: {
              label: { type: "string", minLength: 1, maxLength: 120 },
              expiresInDays: {
                type: ["number", "null"],
                enum: [30, 90, 365, null],
                description: "Preset lifetime in days, or null for no expiry",
              },
            },
          },
        },
      }, workspace.createApiKey);

      r.get("/api-keys", {
        schema: { tags: ["auth"], summary: "List your workspace's API keys", security: bearer },
      }, workspace.listApiKeys);

      r.delete("/api-keys/:keyId", {
        schema: {
          tags: ["auth"], summary: "Revoke one of your workspace's API keys", security: bearer,
          params: {
            type: "object",
            required: ["keyId"],
            properties: { keyId: { type: "string" } },
          },
        },
      }, workspace.revokeApiKey);

      // ── Workspaces (brands/products inside the caller's organization) ──────
      r.get("/workspaces", {
        schema: {
          tags: ["workspaces"],
          summary: "List workspaces you can reach",
          description: "The tenant's owner sees every workspace in their organization; everyone else sees only the ones they hold a membership on.",
          security: bearer,
        },
      }, workspace.listWorkspaces);

      r.post("/workspaces", {
        preHandler: requireOrgOwner,
        schema: {
          tags: ["workspaces"],
          summary: "Create a workspace (organization owner only)",
          description: "Adds a brand/product workspace to your organization, with its own social accounts and API keys.",
          security: bearer,
          body: {
            type: "object", required: ["name"],
            properties: { name: { type: "string", minLength: 1, maxLength: 120 } },
          },
        },
      }, workspace.createWorkspace);

      r.patch("/workspaces/:id", {
        preHandler: requireOrgOwner,
        schema: {
          tags: ["workspaces"], summary: "Rename a workspace (organization owner only)",
          security: bearer, params: objectIdParam,
          body: {
            type: "object", required: ["name"],
            properties: { name: { type: "string", minLength: 1, maxLength: 120 } },
          },
        },
      }, workspace.renameWorkspace);

      r.delete("/workspaces/:id", {
        preHandler: requireOrgOwner,
        schema: {
          tags: ["workspaces"],
          summary: "Archive a workspace (organization owner only)",
          description: "Soft-archive — posts, assets and logs reference the workspace and are preserved. An organization must keep at least one active workspace.",
          security: bearer, params: objectIdParam,
        },
      }, workspace.archiveWorkspace);

      r.post("/workspaces/switch", {
        schema: {
          tags: ["workspaces"],
          summary: "Switch the active workspace",
          description: "Returns a new access token bound to the target workspace. The same access rule is re-checked here, so switching can never widen what you can reach.",
          security: bearer,
          body: {
            type: "object", required: ["workspaceId"],
            properties: { workspaceId: { type: "string" } },
          },
        },
      }, workspace.switchWorkspace);

      // ── Workspace invites ────────────────────────────────────────────────
      // Authorization mirrors admin.createUser exactly (adminableWorkspaceIds):
      // the tenant root may invite onto any workspace in their org; a
      // workspace admin only onto workspaces they themselves administer.
      r.post("/workspaces/:id/invites", {
        schema: {
          tags: ["invites"],
          summary: "Invite a user onto a workspace",
          description: "Creates an invitation and returns the accept link/token directly — there is no mail sender in this stack, so the link must be relayed by whoever calls this (shown in the admin UI, or read from server logs in dev).",
          security: bearer, params: objectIdParam,
          body: {
            type: "object", required: ["email", "role"],
            properties: {
              email: { type: "string", format: "email" },
              role: { type: "string", enum: ["admin", "editor", "viewer"] },
            },
          },
        },
      }, invitations.createInvite);

      r.get("/workspaces/:id/invites", {
        schema: {
          tags: ["invites"],
          summary: "List invitations on workspaces you administer",
          security: bearer, params: objectIdParam,
        },
      }, invitations.listInvites);

      r.delete("/invites/:invitationId", {
        schema: {
          tags: ["invites"],
          summary: "Revoke a pending invitation",
          security: bearer,
          params: {
            type: "object",
            required: ["invitationId"],
            properties: { invitationId: { type: "string" } },
          },
        },
      }, invitations.revokeInvite);

      // ── BYOK LLM configs (organization owner only) ──────────────────────
      // Distinct from the platform-global /admin/llm-configs below: these are
      // scoped to the caller's own organization and never visible to, or
      // touched by, another tenant or the platform config CRUD.
      r.get("/llm-configs", {
        preHandler: requireOrgOwner,
        schema: {
          tags: ["llm-configs"],
          summary: "List your organization's BYOK LLM configs",
          security: bearer,
        },
      }, orgLlmConfigs.listOrgLlmConfigs);

      r.post("/llm-configs", {
        preHandler: requireOrgOwner,
        schema: {
          tags: ["llm-configs"],
          summary: "Add a BYOK LLM config for your organization",
          description: "When active, this key is preferred over the platform default for the same provider on every pipeline run in your organization — see resolveNodeAdapters.",
          security: bearer,
          body: {
            type: "object",
            required: ["label", "provider", "apiKey"],
            properties: {
              label: { type: "string", minLength: 1, maxLength: 120 },
              provider: { type: "string", enum: ["openai", "anthropic", "google"] },
              apiKey: { type: "string", minLength: 1 },
              chatModel: { type: "string" },
              imageModel: { type: "string" },
            },
          },
        },
      }, orgLlmConfigs.createOrgLlmConfig);

      r.patch("/llm-configs/:id", {
        preHandler: requireOrgOwner,
        schema: {
          tags: ["llm-configs"],
          summary: "Update one of your organization's BYOK LLM configs",
          security: bearer, params: objectIdParam,
          body: {
            type: "object",
            properties: {
              label: { type: "string" },
              apiKey: { type: "string" },
              chatModel: { type: "string" },
              imageModel: { type: "string" },
              isActive: { type: "boolean" },
            },
          },
        },
      }, orgLlmConfigs.updateOrgLlmConfig);

      r.delete("/llm-configs/:id", {
        preHandler: requireOrgOwner,
        schema: {
          tags: ["llm-configs"],
          summary: "Delete one of your organization's BYOK LLM configs",
          security: bearer, params: objectIdParam,
        },
      }, orgLlmConfigs.deleteOrgLlmConfig);

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
          description: "Stops a post in the caller's workspace before it publishes and marks it `cancelled`, dropping its pending scheduled-publish job.\n\nCancellable from `draft`, `queued`, `processing`, `pending_review`, `ready`, and `scheduled`. Returns **400** with an explanatory message once the post is `publishing` (platform calls already sent), `published`, or otherwise terminal.",
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

  // ── Admin routes — require JWT + admin/root role ────────────────────────────
  app.register(
    async (r) => {
      r.addHook("preHandler", authenticate);
      r.addHook("preHandler", requireOrgMember);

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
        schema: {
          tags: ["admin"],
          summary: "List users you can manage",
          description: "The tenant's owner sees every user in their organization; a workspace admin sees only users on workspaces they administer.",
          security: bearer,
        },
      }, admin.listUsers);

      r.post("/users", {
        schema: {
          tags: ["admin"],
          summary: "Provision a user into a workspace",
          description: "Creates a user in the target workspace's organization and grants them a membership on it. You must administer the target workspace.",
          security: bearer,
          body: {
            type: "object", required: ["name", "email", "password", "workspaceId"],
            properties: {
              name: { type: "string" }, email: { type: "string" },
              password: { type: "string", minLength: 8 },
              workspaceId: { type: "string", description: "Workspace the new user joins" },
              // Org-level roles are not grantable here: org ownership is a
              // deliberate transfer, and platform access only via the CLI.
              workspaceRole: { type: "string", enum: ["admin", "editor", "viewer"], default: "editor" },
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
              workspaceRole: { type: "string", enum: ["admin", "editor", "viewer"] },
            },
          },
        },
      }, admin.updateUser);

      r.delete("/users/:id", {
        schema: { tags: ["admin"], summary: "Delete user", security: bearer, params: objectIdParam },
      }, admin.deleteUser);

      r.get("/posts", {
        schema: {
          tags: ["admin"], summary: "List all posts across all workspaces", security: bearer,
          querystring: {
            type: "object",
            properties: {
              page:     { type: "number", default: 1, minimum: 1 },
              pageSize: { type: "number", default: 30, minimum: 1, maximum: 50 },
              status:   { type: "string" },
              q:        { type: "string" },
            },
          },
        },
      }, admin.listAllPosts);

      r.post("/posts/:id/cancel", {
        schema: {
          tags: ["admin"],
          summary: "Cancel any post, in any workspace",
          description: "Stops a post before it publishes and marks it `cancelled`, dropping its pending scheduled-publish job. Unlike `POST /v1/posts/:id/cancel` this is not workspace-scoped. Returns 400 if the post is already publishing, published, or otherwise terminal.",
          security: bearer,
          params: objectIdParam,
        },
      }, admin.cancelPostAsAdmin);

      r.delete("/posts/:id", {
        schema: {
          tags: ["admin"],
          summary: "Hard-delete a post record",
          description: "Admin/root only. Permanently removes the post document and drops any pending scheduled-publish job. Prefer cancel for a post that simply shouldn't go out — delete is irreversible and loses the audit trail.",
          security: bearer,
          params: objectIdParam,
        },
      }, admin.deletePost);

      // ── Platform-only from here ────────────────────────────────────────────
      // LLM configs, node assignments and the database browser are shared
      // infrastructure owned by the SaaS operator, not by any customer: one
      // LlmConfig row holds a provider credential used by every tenant's
      // pipeline, and NodeConfig is a singleton routing every tenant's models.
      // `requirePlatform` runs after `requireOrgMember`, which resolves identity.
      r.get("/llm-configs", {
        preHandler: requirePlatform,
        schema: { tags: ["admin"], summary: "List LLM configs (platform-only)", security: bearer },
      }, admin.listLlmConfigs);

      r.post("/llm-configs", {
        preHandler: requirePlatform,
        schema: {
          tags: ["admin"], summary: "Add LLM config (platform-only)", security: bearer,
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
        preHandler: requirePlatform,
        schema: {
          tags: ["admin"], summary: "Update LLM config (platform-only)", security: bearer, params: objectIdParam,
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
        preHandler: requirePlatform,
        schema: { tags: ["admin"], summary: "Delete LLM config (platform-only)", security: bearer, params: objectIdParam },
      }, admin.deleteLlmConfig);

      r.get("/node-config", {
        preHandler: requirePlatform,
        schema: { tags: ["admin"], summary: "Get node→LLM assignments (platform-only)", security: bearer },
      }, admin.getNodeConfig);

      r.put("/node-config", {
        preHandler: requirePlatform,
        schema: {
          tags: ["admin"], summary: "Save node→LLM assignments (platform-only)", security: bearer,
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

      // API keys — cross-workspace oversight. Every user can self-service
      // their own workspace's keys via POST/GET/DELETE /v1/api-keys above;
      // these exist so admin/root can audit and, if needed, kill a key that
      // isn't theirs (e.g. a compromised or misbehaving integration).
      r.get("/api-keys", {
        schema: { tags: ["admin"], summary: "List API keys across every workspace", security: bearer },
      }, admin.listAllApiKeys);

      r.delete("/api-keys/:keyId", {
        schema: {
          tags: ["admin"], summary: "Revoke any workspace's API key", security: bearer,
          params: {
            type: "object",
            required: ["keyId"],
            properties: { keyId: { type: "string" } },
          },
        },
      }, admin.revokeApiKeyAdmin);

      r.get("/database/collections", {
        preHandler: requirePlatform,
        schema: { tags: ["admin"], summary: "List collections with counts (platform-only)", security: bearer },
      }, admin.listCollections);

      r.get("/database/collections/:collection/docs", {
        preHandler: requirePlatform,
        schema: {
          tags: ["admin"], summary: "Paginated documents for a collection (platform-only)", security: bearer,
          params: {
            type: "object",
            properties: { collection: { type: "string" } },
            required: ["collection"],
          },
          querystring: {
            type: "object",
            properties: {
              page:     { type: "number", default: 1,  minimum: 1 },
              pageSize: { type: "number", default: 20, minimum: 1, maximum: 50 },
            },
          },
        },
      }, admin.listCollectionDocs);
    },
    { prefix: "/v1/admin" },
  );

  // ── Platform routes — SaaS operator staff only ──────────────────────────────
  // The one surface that deliberately crosses organizations. Tenants are
  // created here off the back of a subscription, replacing public registration.
  app.register(
    async (r) => {
      r.addHook("preHandler", authenticate);
      r.addHook("preHandler", requirePlatform);

      r.post("/tenants", {
        schema: {
          tags: ["platform"],
          summary: "Provision a new tenant",
          description: "Creates an organization, its owner (the tenant's root user) and a default workspace in one step, so the customer can log in and start working immediately.",
          security: bearer,
          body: {
            type: "object",
            required: ["organizationName", "ownerName", "ownerEmail", "ownerPassword"],
            properties: {
              organizationName: { type: "string", minLength: 1, maxLength: 160 },
              ownerName:        { type: "string", minLength: 1, maxLength: 120 },
              ownerEmail:       { type: "string", format: "email" },
              ownerPassword:    { type: "string", minLength: 8 },
              workspaceName:    { type: "string", maxLength: 120, description: "Defaults to '<organization> Workspace'" },
            },
          },
        },
      }, platform.provisionTenant);

      r.get("/tenants", {
        schema: { tags: ["platform"], summary: "List all tenants", security: bearer },
      }, platform.listTenants);

      r.patch("/tenants/:id", {
        schema: {
          tags: ["platform"],
          summary: "Suspend or reactivate a tenant",
          description: "Cascades to the tenant's users so suspension takes effect at login and on every authenticated request.",
          security: bearer, params: objectIdParam,
          body: {
            type: "object", required: ["status"],
            properties: { status: { type: "string", enum: ["active", "suspended"] } },
          },
        },
      }, platform.setTenantStatus);
    },
    { prefix: "/v1/platform" },
  );
}
