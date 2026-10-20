import { Types } from "mongoose";
import { LlmConfigModel, LLM_PROVIDERS, type LlmProvider } from "../../db/models/index.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";

/**
 * Org-owned "bring your own key" LLM configs — see the docstring on
 * `LlmConfig.organizationId` and `resolveNodeAdapters` in
 * orchestration/node-adapters.ts for how these are picked up by the pipeline.
 * Distinct module from admin.controller.ts's platform-config CRUD so a
 * tenant's own key and the platform default can never be mixed up in one
 * query or one authorization check.
 */

function maskApiKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return "sk-••••••••" + key.slice(-4);
}

export interface OrgLlmConfigDTO {
  id: string;
  label: string;
  provider: LlmProvider;
  apiKeyMasked: string;
  chatModel: string | null;
  imageModel: string | null;
  isActive: boolean;
  createdAt: string;
}

function toDTO(cfg: InstanceType<typeof LlmConfigModel>): OrgLlmConfigDTO {
  return {
    id: cfg._id.toHexString(),
    label: cfg.label,
    provider: cfg.provider as LlmProvider,
    apiKeyMasked: maskApiKey(cfg.apiKey),
    chatModel: cfg.chatModel ?? null,
    imageModel: cfg.imageModel ?? null,
    isActive: cfg.isActive,
    createdAt: (cfg as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

export async function listOrgLlmConfigs(organizationId: string): Promise<OrgLlmConfigDTO[]> {
  const configs = await LlmConfigModel.find({ organizationId: new Types.ObjectId(organizationId) }).sort({
    createdAt: -1,
  });
  return configs.map(toDTO);
}

export async function createOrgLlmConfig(
  organizationId: string,
  input: { label: string; provider: string; apiKey: string; chatModel?: string; imageModel?: string },
): Promise<OrgLlmConfigDTO> {
  if (!LLM_PROVIDERS.includes(input.provider as LlmProvider)) {
    throw new BadRequestError(`provider must be one of: ${LLM_PROVIDERS.join(", ")}`);
  }
  const cfg = await LlmConfigModel.create({
    ...input,
    organizationId: new Types.ObjectId(organizationId),
  });
  return toDTO(cfg);
}

export async function updateOrgLlmConfig(
  organizationId: string,
  configId: string,
  patch: Partial<{ label: string; apiKey: string; chatModel: string; imageModel: string; isActive: boolean }>,
): Promise<OrgLlmConfigDTO> {
  if (!Types.ObjectId.isValid(configId)) throw new NotFoundError("LLM config");
  const cfg = await LlmConfigModel.findOneAndUpdate(
    { _id: new Types.ObjectId(configId), organizationId: new Types.ObjectId(organizationId) },
    { $set: patch },
    { new: true },
  );
  if (!cfg) throw new NotFoundError("LLM config");
  return toDTO(cfg);
}

export async function deleteOrgLlmConfig(organizationId: string, configId: string): Promise<void> {
  if (!Types.ObjectId.isValid(configId)) throw new NotFoundError("LLM config");
  const cfg = await LlmConfigModel.findOneAndDelete({
    _id: new Types.ObjectId(configId),
    organizationId: new Types.ObjectId(organizationId),
  });
  if (!cfg) throw new NotFoundError("LLM config");
}
