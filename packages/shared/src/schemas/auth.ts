import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120),
  workspaceName: z.string().min(1).max(120).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

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
