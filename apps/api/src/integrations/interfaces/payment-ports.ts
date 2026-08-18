import type { PlanId } from "@visora/shared";

export interface ChargeParams {
  planId: PlanId;
  amountUsd: number;
  email: string;
  /** Mock-only "card" shape. A real adapter would take a tokenized payment method instead. */
  card: { number: string; expMonth: number; expYear: number; cvc: string };
}

export interface ChargeResult {
  paymentId: string;
  status: "succeeded";
  amountUsd: number;
  planId: PlanId;
  provider: string;
}

/**
 * Payment provider port (same hexagonal convention as ImageGenerator/
 * Publisher/ObjectStore in ports.ts). Signup depends only on this interface
 * — never a concrete SDK — so a real gateway later is a new adapter, not a
 * rewrite of the signup flow.
 */
export interface PaymentProvider {
  readonly name: string;
  /** Throws ProviderError on decline/failure — never returns a failure variant. */
  charge(params: ChargeParams): Promise<ChargeResult>;
}
