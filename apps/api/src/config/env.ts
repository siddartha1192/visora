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
  // Comma-separated list of emails that are automatically promoted to admin on login
  ADMIN_EMAILS: z.string().default(""),

  // S3 / storage
  AWS_REGION: z.string().default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET: z.string().default("visora-assets"),
  S3_ENDPOINT: z.string().optional(), // set for localstack/minio
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),

  // AI / media providers
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-1"),
  OPENAI_TEXT_MODEL: z.string().default("gpt-4o-mini"),

  CLOUDINARY_URL: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  PEXELS_API_KEY: z.string().optional(),
  UNSPLASH_ACCESS_KEY: z.string().optional(),

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
