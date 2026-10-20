import type { FastifyReply, FastifyRequest } from "fastify";
import { signupSchema } from "@visora/shared";
import { MockPaymentProvider } from "../../integrations/payments/mock.adapter.js";
import * as signupService from "../../modules/workspace/signup.service.js";
import { issueTokens } from "./auth.controller.js";
import { created } from "../reply.js";

const paymentProvider = new MockPaymentProvider();

/**
 * Public self-service signup, gated behind a mock subscription payment.
 * Replaces nothing existing — POST /v1/platform/tenants (staff-provisioned)
 * and POST /v1/admin/users (colleague invites) both still exist; this is the
 * one path a brand-new, unknown customer can use without any human on the
 * Visora side touching it.
 */
export async function signup(req: FastifyRequest, reply: FastifyReply) {
  const input = signupSchema.parse(req.body);
  const result = await signupService.signup(input, paymentProvider);

  const authed = {
    id: result.ownerId,
    email: result.ownerEmail,
    name: result.ownerName,
    organizationId: result.organization.id,
    defaultWorkspaceId: result.workspace.id,
  };

  return created(reply, {
    ...issueTokens(req, authed),
    organization: result.organization,
    workspace: result.workspace,
  });
}
