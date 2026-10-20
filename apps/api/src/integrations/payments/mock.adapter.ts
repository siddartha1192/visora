import { randomUUID } from "node:crypto";
import { logger } from "../../lib/logger.js";
import { ProviderError } from "../../lib/errors.js";
import type { ChargeParams, ChargeResult, PaymentProvider } from "../interfaces/payment-ports.js";

/**
 * Placeholder payment provider — no real gateway is integrated yet. Always
 * succeeds except for the magic card number below, which simulates a
 * decline so the "no DB writes on payment failure" path in signup.service.ts
 * is actually testable and demoable, not just theoretical. A real Stripe/etc
 * adapter implements the same PaymentProvider port — signup never changes.
 */
const DECLINE_CARD = "4000000000000002";

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  async charge(params: ChargeParams): Promise<ChargeResult> {
    logger.info({ planId: params.planId, email: params.email }, "mock payment: processing");

    if (params.card.number.replace(/\s/g, "") === DECLINE_CARD) {
      throw new ProviderError("mock", "Your card was declined");
    }

    return {
      paymentId: `mock_${randomUUID()}`,
      status: "succeeded",
      amountUsd: params.amountUsd,
      planId: params.planId,
      provider: this.name,
    };
  }
}
