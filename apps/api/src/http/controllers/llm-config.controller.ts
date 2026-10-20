import type { FastifyReply, FastifyRequest } from "fastify";
import * as llmConfigService from "../../modules/workspace/llm-config.service.js";
import { created, ok } from "../reply.js";

/**
 * Org-owned BYOK LLM configs. Gated by `requireOrgOwner` in routes/index.ts —
 * only the tenant root manages billing-adjacent settings like this, same as
 * workspace creation. `auth.organizationId` is always populated for an org
 * owner (enforced by the User validator), so no null-check is needed here.
 */

export async function listOrgLlmConfigs(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.auth!;
  return ok(reply, await llmConfigService.listOrgLlmConfigs(auth.organizationId!));
}

export async function createOrgLlmConfig(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.auth!;
  const body = req.body as {
    label: string;
    provider: string;
    apiKey: string;
    chatModel?: string;
    imageModel?: string;
  };
  const cfg = await llmConfigService.createOrgLlmConfig(auth.organizationId!, body);
  return created(reply, cfg);
}

export async function updateOrgLlmConfig(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.auth!;
  const { id } = req.params as { id: string };
  const patch = req.body as Partial<{
    label: string;
    apiKey: string;
    chatModel: string;
    imageModel: string;
    isActive: boolean;
  }>;
  const cfg = await llmConfigService.updateOrgLlmConfig(auth.organizationId!, id, patch);
  return ok(reply, cfg);
}

export async function deleteOrgLlmConfig(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.auth!;
  const { id } = req.params as { id: string };
  await llmConfigService.deleteOrgLlmConfig(auth.organizationId!, id);
  return ok(reply, { deleted: id });
}
