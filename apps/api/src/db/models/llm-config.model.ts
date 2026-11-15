import { Schema, model, type InferSchemaType, type Types } from "mongoose";
import { decryptSecret, encryptSecret } from "../../lib/crypto.js";

export const LLM_PROVIDERS = ["openai", "google"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

const llmConfigSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    provider: { type: String, enum: LLM_PROVIDERS, required: true },
    /**
     * Stored AES-256-GCM encrypted (see lib/crypto.ts). Document reads decrypt
     * transparently via the getter; `.lean()` reads return ciphertext and must
     * call decryptSecret() explicitly (see resolveNodeAdapters).
     */
    apiKey: { type: String, required: true, set: encryptSecret, get: decryptSecret },
    chatModel: { type: String, trim: true },
    imageModel: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    /**
     * null = platform-global config, managed by platform staff and available
     * to every tenant as the default. Set = an org's own BYOK credential,
     * managed by that org's owner and preferred over the platform default for
     * the same provider — see resolveNodeAdapters in orchestration/node-adapters.ts.
     */
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
  },
  { timestamps: true },
);

export type LlmConfigDoc = InferSchemaType<typeof llmConfigSchema> & {
  _id: Types.ObjectId;
};

export const LlmConfigModel = model("LlmConfig", llmConfigSchema);
