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
  },
  { timestamps: true },
);

export type LlmConfigDoc = InferSchemaType<typeof llmConfigSchema> & {
  _id: Types.ObjectId;
};

export const LlmConfigModel = model("LlmConfig", llmConfigSchema);
