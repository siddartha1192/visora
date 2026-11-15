import { z } from "zod";

/**
 * Boot-time environment validation. Nothing in the app reads `process.env`
 * directly — they import `env` from here so a missing/invalid var fails fast
 * and loudly at startup rather than mid-request.
 *
 * Provider keys are optional: when absent, the corresponding integration falls
 * back to a deterministic stub adapter (see config/container.ts) so the full
 * pipeline runs locally without paid credentials.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // Core infra
  MONGODB_URI: z.string().default("mongodb://localhost:27017/visora"),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Auth
  JWT_SECRET: z.string().min(16).default("dev-insecure-secret-change-me-please"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  // NOTE: ROOT_EMAILS was removed. It granted platform access on *login* to any
  // account whose email appeared in the list, so with registration open whoever
  // claimed that address first became platform root. Platform staff are now
  // created explicitly:
  //   docker exec -it visora-api-1 node dist/cli/create-platform-admin.js

  // S3 / storage
  AWS_REGION: z.string().default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET: z.string().default("visora-assets"),
  S3_ENDPOINT: z.string().optional(), // set for localstack/minio
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),

  // AI / media providers
  OPENAI_API_KEY: z.string().optional(),
  // gpt-image-1 / dall-e-* are retired; gpt-image-2 retires Feb 2027 (per third-party
  // trackers — verify). Per-node overrides live in the admin LlmConfig `imageModel`.
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-2.6-flare"),
  // gpt-image-* only. 2.6 bills more output tokens at low/medium, so keep this explicit.
  OPENAI_IMAGE_QUALITY: z.enum(["low", "medium", "high", "auto"]).default("medium"),
  OPENAI_TEXT_MODEL: z.string().default("gpt-4o-mini"),
  // Google Gemini defaults (used when a node is assigned a Google LlmConfig without models).
  GEMINI_IMAGE_MODEL: z.string().default("gemini-2.5-flash-image"),
  GEMINI_TEXT_MODEL: z.string().default("gemini-2.5-flash"),

  CLOUDINARY_URL: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  PEXELS_API_KEY: z.string().optional(),
  UNSPLASH_ACCESS_KEY: z.string().optional(),

  // Social publishers
  INSTAGRAM_ACCESS_TOKEN: z.string().optional(),
  // Page Access Token for Facebook — in Meta's setup this is typically the
  // same token used for Instagram (a long-lived Page Access Token).
  FACEBOOK_ACCESS_TOKEN: z.string().optional(),

  LINKEDIN_ACCESS_TOKEN: z.string().optional(),

  // Per-workspace Instagram/Facebook OAuth connect flow. Both are required
  // once a workspace attempts to connect its own account — see
  // modules/workspace/social-oauth.service.ts. Get these by registering an
  // app at developers.facebook.com; the same app already backs the
  // INSTAGRAM_ACCESS_TOKEN/FACEBOOK_ACCESS_TOKEN above.
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  // Encrypts customer OAuth tokens at rest (AES-256-GCM, see lib/crypto.ts).
  // CHANGE THE DEFAULT IN PRODUCTION — losing or rotating this key makes
  // every stored token permanently undecryptable; back it up like JWT_SECRET.
  TOKEN_ENCRYPTION_KEY: z.string().min(32).default("dev-insecure-encryption-key-change-me-please"),

  // CORS
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error(
    "❌ Invalid environment configuration:",
    parsed.error.flatten().fieldErrors,
  );
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
export type Env = typeof env;

export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
