/**
 * Subscription plan tiers offered at signup. No payment gateway is
 * integrated yet — see apps/api/src/integrations/payments — but the tiers
 * themselves, and the limits they carry, are real and enforced.
 */

export const PLAN_IDS = ["basic", "premium"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceUsd: number;
  billingPeriod: "month";
  description: string;
  features: string[];
  /** Max active workspaces an organization on this plan may have. null = unlimited. */
  maxWorkspaces: number | null;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  basic: {
    id: "basic",
    name: "Basic",
    priceUsd: 29,
    billingPeriod: "month",
    description: "For small teams getting started",
    features: ["1 workspace", "Core AI content pipeline", "Email support"],
    maxWorkspaces: 1,
  },
  premium: {
    id: "premium",
    name: "Premium",
    priceUsd: 99,
    billingPeriod: "month",
    description: "For teams running multiple brands or products",
    features: ["Unlimited workspaces", "Priority support", "Higher usage limits"],
    maxWorkspaces: null,
  },
};
