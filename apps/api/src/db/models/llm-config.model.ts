import { Schema, model, type InferSchemaType, type Types } from "mongoose";

export const LLM_PROVIDERS = ["openai", "anthropic", "google"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

const llmConfigSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    provider: { type: String, enum: LLM_PROVIDERS, required: true },
    apiKey: { type: String, required: true },
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
