import type { OrganizationDTO, WorkspaceDTO, SignupInput } from "@visora/shared";
import { PLANS } from "@visora/shared";
import { UserModel } from "../../db/models/index.js";
import { ConflictError } from "../../lib/errors.js";
import { provisionTenant } from "./tenant.service.js";
import type { PaymentProvider } from "../../integrations/interfaces/payment-ports.js";

export interface SignupResult {
  organization: OrganizationDTO;
  workspace: WorkspaceDTO;
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  paymentId: string;
}

/**
 * Public self-service signup, gated behind a (mock) subscription payment.
 * Sequencing is deliberate: the email-uniqueness check and the payment
 * charge BOTH happen before any database write, so a declined payment or an
 * already-registered email never leaves an orphaned Organization/User —
 * provisionTenant itself has no transaction, so this ordering is the only
 * safety net.
 */
export async function signup(
  input: SignupInput,
  paymentProvider: PaymentProvider,
): Promise<SignupResult> {
  const email = input.email.toLowerCase();

  // 1. Fail fast on a known-taken email — cheap, before charging anything.
  if (await UserModel.exists({ email })) {
    throw new ConflictError("Email already registered");
  }

  // 2. Charge before any write. Throws ProviderError on decline — nothing
  //    downstream has run yet, so there is no cleanup to do.
  const plan = PLANS[input.planId];
  const receipt = await paymentProvider.charge({
    planId: input.planId,
    amountUsd: plan.priceUsd,
    email,
    card: input.card,
  });

  // 3. Only now do we write anything — reuses provisionTenant's org/owner/
  //    workspace sequencing rather than duplicating it.
  const { organization, workspace, ownerId } = await provisionTenant({
    organizationName: input.organizationName,
    ownerName: input.ownerName,
    ownerEmail: email,
    ownerPassword: input.password,
    plan: input.planId,
  });

  return {
    organization,
    workspace,
    ownerId,
    ownerEmail: email,
    ownerName: input.ownerName,
    paymentId: receipt.paymentId,
  };
}
