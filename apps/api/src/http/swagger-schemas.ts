import type { FastifyInstance } from "fastify";

/**
 * Registers reusable JSON Schema $id definitions so route schemas can reference
 * them with { $ref: 'SchemaName#' } instead of inlining the full shape everywhere.
 */
export function registerSchemas(app: FastifyInstance) {
  app.addSchema({
    $id: "ErrorResponse",
    type: "object",
    properties: {
      ok: { type: "boolean", enum: [false] },
      error: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
        },
        required: ["code", "message"],
      },
    },
  });

  app.addSchema({
    $id: "AuthTokens",
    type: "object",
    properties: {
      accessToken: { type: "string" },
      refreshToken: { type: "string" },
      expiresIn: { type: "number", description: "Seconds until access token expires" },
    },
    required: ["accessToken", "refreshToken", "expiresIn"],
  });

  app.addSchema({
    $id: "UserDTO",
    type: "object",
    properties: {
      id: { type: "string" },
      email: { type: "string", format: "email" },
      name: { type: "string" },
      avatarUrl: { type: "string" },
      defaultWorkspaceId: { type: "string" },
      workspaces: {
        type: "array",
        items: {
          type: "object",
          properties: {
            workspaceId: { type: "string" },
            role: { type: "string", enum: ["owner", "admin", "editor", "viewer"] },
          },
        },
      },
      createdAt: { type: "string", format: "date-time" },
    },
    required: ["id", "email", "name", "workspaces", "createdAt"],
  });

  app.addSchema({
    $id: "AuthResponse",
    type: "object",
    properties: {
      ok: { type: "boolean", enum: [true] },
      data: {
        type: "object",
        properties: {
          user: { $ref: "UserDTO#" },
          tokens: { $ref: "AuthTokens#" },
        },
        required: ["user", "tokens"],
      },
    },
    required: ["ok", "data"],
  });

  app.addSchema({
    $id: "PostTargetDTO",
    type: "object",
    properties: {
      platform: { type: "string", enum: ["instagram", "facebook", "x", "linkedin"] },
      accountId: { type: "string" },
      status: { type: "string", enum: ["pending", "published", "failed"] },
      externalPostId: { type: "string" },
      permalink: { type: "string" },
      error: { type: "string" },
    },
    required: ["platform", "accountId", "status"],
  });

  app.addSchema({
    $id: "PostDTO",
    type: "object",
    properties: {
      id: { type: "string" },
      workspaceId: { type: "string" },
      authorId: { type: "string" },
      workflow: {
        type: "string",
        enum: ["passthrough", "ai_generate", "ai_enhance", "stock_discovery", "scrape", "autonomous"],
      },
      status: {
        type: "string",
        enum: [
          "draft", "queued", "processing", "pending_review",
          "ready", "scheduled", "publishing", "published", "failed", "cancelled", "rejected",
        ],
      },
      input: {
        type: "object",
        properties: {
          brief: { type: "string" },
          prompt: { type: "string" },
          instructions: { type: "string" },
          sourceUrl: { type: "string" },
          uploadedAssetId: { type: "string" },
          context: { type: "string" },
        },
      },
      caption: {
        type: "object",
        properties: {
          text: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
          generated: { type: "boolean" },
        },
        required: ["text", "hashtags", "generated"],
      },
      targets: { type: "array", items: { $ref: "PostTargetDTO#" } },
      primaryAssetId: { type: "string" },
      schedule: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["instant", "scheduled", "auto"] },
          runAt: { type: "string", format: "date-time" },
          timezone: { type: "string" },
          publishedAt: { type: "string", format: "date-time" },
        },
        required: ["mode", "timezone"],
      },
      jobId: { type: "string" },
      lastError: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
    required: ["id", "workspaceId", "workflow", "status", "caption", "targets", "schedule", "createdAt", "updatedAt"],
  });

  app.addSchema({
    $id: "PostResponse",
    type: "object",
    properties: {
      ok: { type: "boolean", enum: [true] },
      data: { $ref: "PostDTO#" },
    },
    required: ["ok", "data"],
  });

  app.addSchema({
    $id: "PostListResponse",
    type: "object",
    properties: {
      ok: { type: "boolean", enum: [true] },
      data: {
        type: "object",
        properties: {
          items: { type: "array", items: { $ref: "PostDTO#" } },
          page: { type: "number" },
          pageSize: { type: "number" },
          total: { type: "number" },
        },
        required: ["items", "page", "pageSize", "total"],
      },
    },
    required: ["ok", "data"],
  });

  app.addSchema({
    $id: "AssetVariant",
    type: "object",
    properties: {
      platform: { type: "string", enum: ["instagram", "facebook", "x", "linkedin"] },
      aspectRatio: { type: "string", example: "1:1" },
      cloudinaryUrl: { type: "string" },
      s3Key: { type: "string" },
      width: { type: "number" },
      height: { type: "number" },
    },
    required: ["platform", "aspectRatio", "cloudinaryUrl", "s3Key", "width", "height"],
  });

  app.addSchema({
    $id: "AssetDTO",
    type: "object",
    properties: {
      id: { type: "string" },
      workspaceId: { type: "string" },
      kind: { type: "string", enum: ["upload", "ai_generated", "stock", "scraped", "enhanced"] },
      origin: {
        type: "object",
        properties: {
          source: { type: "string", enum: ["user", "dalle3", "pexels", "unsplash", "scrape"] },
          sourceUrl: { type: "string" },
          prompt: { type: "string" },
        },
        required: ["source"],
      },
      url: { type: "string", description: "Publicly accessible URL for the raw asset" },
      mime: { type: "string", example: "image/jpeg" },
      width: { type: "number" },
      height: { type: "number" },
      bytes: { type: "number" },
      variants: { type: "array", items: { $ref: "AssetVariant#" } },
      createdAt: { type: "string", format: "date-time" },
    },
    required: ["id", "workspaceId", "kind", "origin", "url", "mime", "width", "height", "bytes", "variants", "createdAt"],
  });

  app.addSchema({
    $id: "AssetResponse",
    type: "object",
    properties: {
      ok: { type: "boolean", enum: [true] },
      data: { $ref: "AssetDTO#" },
    },
    required: ["ok", "data"],
  });

  app.addSchema({
    $id: "AssetListResponse",
    type: "object",
    properties: {
      ok: { type: "boolean", enum: [true] },
      data: {
        type: "object",
        properties: {
          items: { type: "array", items: { $ref: "AssetDTO#" } },
          page: { type: "number" },
          pageSize: { type: "number" },
          total: { type: "number" },
        },
        required: ["items", "page", "pageSize", "total"],
      },
    },
    required: ["ok", "data"],
  });

  app.addSchema({
    $id: "ObjectId",
    type: "object",
    properties: {
      id: { type: "string", pattern: "^[a-f0-9]{24}$", description: "24-character hex MongoDB ObjectId" },
    },
    required: ["id"],
  });
}
