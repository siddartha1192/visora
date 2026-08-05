import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { LlmConfigModel } from "./models/llm-config.model.js";
import { UserModel } from "./models/user.model.js";

/**
 * Seeds the LlmConfig collection on first boot using env-var credentials.
 * Runs only when the collection is completely empty so it never overwrites
 * admin-managed records.
 */
export async function seedLlmConfigs(): Promise<void> {
  const count = await LlmConfigModel.countDocuments();
  if (count > 0) return;

  const docs: Array<{
    label: string;
    provider: string;
    apiKey: string;
    chatModel?: string;
    imageModel?: string;
    isActive: boolean;
  }> = [];

  if (env.OPENAI_API_KEY) {
    docs.push({
      label: "OpenAI",
      provider: "openai",
      apiKey: env.OPENAI_API_KEY,
      chatModel: env.OPENAI_TEXT_MODEL,
      imageModel: env.OPENAI_IMAGE_MODEL,
      isActive: true,
    });
  }

  if (docs.length === 0) return;

  await LlmConfigModel.insertMany(docs);
  logger.info({ seeded: docs.length }, "Seeded LLM configs from env vars");
}

/**
 * One-time backfill from the legacy `isAdmin` boolean to the `role` field
 * (root | admin | user) introduced afterwards. Only touches documents that
 * predate `role` — new documents always get `role` from the schema default,
 * so this becomes a no-op once every existing user has been migrated.
 */
export async function migrateUserRoles(): Promise<void> {
  const result = await UserModel.updateMany(
    { role: { $exists: false } },
    [{ $set: { role: { $cond: [{ $eq: ["$isAdmin", true] }, "admin", "user"] } } }],
  );
  if (result.modifiedCount > 0) {
    logger.info({ migrated: result.modifiedCount }, "Migrated users from isAdmin to role");
  }
}
