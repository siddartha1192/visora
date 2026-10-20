import { z } from "zod";
import { PLAN_IDS } from "../constants/plans.js";

export const signupSchema = z.object({
  organizationName: z.string().min(1).max(160),
  ownerName: z.string().min(1).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
  planId: z.enum(PLAN_IDS),
  // Mock-only "card" fields — a placeholder until a real gateway (Stripe
  // Elements/Checkout) replaces this whole block. Never persisted.
  card: z.object({
    number: z.string().min(12).max(19),
    expMonth: z.number().int().min(1).max(12),
    expYear: z.number().int().min(2024).max(2100),
    cvc: z.string().min(3).max(4),
  }),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const createApiKeySchema = z.object({
  label: z.string().min(1).max(120),
  // Preset lifetimes only; null means the key never expires.
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).nullable(),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export const createInvitationSchema = z.object({
  email: z.string().email().toLowerCase(),
  role: z.enum(["admin", "editor", "viewer"]),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const acceptInvitationSchema = z.object({
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(128),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
