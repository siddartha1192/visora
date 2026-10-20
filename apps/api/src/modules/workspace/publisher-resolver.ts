import type { Platform } from "@visora/shared";
import type { Publisher } from "../../integrations/interfaces/ports.js";
import type { ServiceContainer } from "../../config/container.js";
import { InstagramPublisher } from "../../integrations/publishers/instagram.publisher.js";
import { FacebookPublisher } from "../../integrations/publishers/facebook.publisher.js";
import { LinkedInPublisher } from "../../integrations/publishers/linkedin.publisher.js";
import { logger } from "../../lib/logger.js";

interface WorkspaceSocialAccounts {
  socialAccounts?: Array<{
    platform: Platform;
    status: "connected" | "expired" | "revoked";
    accessTokenRef?: string | null;
  }> | null;
}

/**
 * Resolves the Publisher for one workspace + platform.
 *
 * `Workspace.socialAccounts[]` is the intended source of a tenant's own
 * connected account, but no OAuth connect flow exists yet — there is nowhere
 * for a workspace to acquire its own token. Until that ships, `accessTokenRef`
 * holds the *name* of an environment variable (never the raw token — the
 * schema comment on `socialAccountSchema` is explicit about this), so a
 * connected account today just points back at the same operator credentials
 * `createContainer()` already reads.
 *
 * This makes every call site workspace-aware now, so wiring a real per-tenant
 * OAuth flow later is a change confined to how `socialAccounts[]` gets
 * populated — no publish call site needs to change again.
 */
export function resolvePublisher(
  workspace: WorkspaceSocialAccounts,
  platform: Platform,
  fallback: ServiceContainer["publishers"],
): Publisher {
  const account = workspace.socialAccounts?.find(
    (a) => a.platform === platform && a.status === "connected",
  );

  if (!account?.accessTokenRef) {
    return fallback[platform];
  }

  const token = process.env[account.accessTokenRef];
  if (!token) {
    logger.warn(
      { platform, accessTokenRef: account.accessTokenRef },
      "workspace social account references a missing env var — falling back to the platform default publisher",
    );
    return fallback[platform];
  }

  switch (platform) {
    case "instagram":
      return new InstagramPublisher(token);
    case "facebook":
      return new FacebookPublisher(token);
    case "linkedin":
      return new LinkedInPublisher(token);
    default:
      return fallback[platform];
  }
}
