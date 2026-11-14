import type { Platform } from "@visora/shared";
import type { Publisher } from "../../integrations/interfaces/ports.js";
import type { ServiceContainer } from "../../config/container.js";
import { InstagramPublisher } from "../../integrations/publishers/instagram.publisher.js";
import { FacebookPublisher } from "../../integrations/publishers/facebook.publisher.js";
import { LinkedInPublisher } from "../../integrations/publishers/linkedin.publisher.js";
import { decryptSecret } from "../../lib/crypto.js";
import { logger } from "../../lib/logger.js";

interface WorkspaceSocialAccounts {
  socialAccounts?: Array<{
    platform: Platform;
    status: "connected" | "expired" | "revoked";
    accessTokenRef?: string | null;
    encryptedAccessToken?: string | null;
  }> | null;
}

function buildPublisher(platform: Platform, token: string): Publisher | undefined {
  switch (platform) {
    case "instagram":
      return new InstagramPublisher(token);
    case "facebook":
      return new FacebookPublisher(token);
    case "linkedin":
      return new LinkedInPublisher(token);
    default:
      return undefined;
  }
}

/**
 * Resolves the Publisher for one workspace + platform.
 *
 * Prefers a real, customer-owned connection (`encryptedAccessToken`, set by
 * the Instagram/Facebook Connect flow in social-oauth.service.ts) over the
 * Phase 2 placeholder mechanism (`accessTokenRef`, an env var name pointing
 * back at the operator's own token), which itself falls back to the platform
 * default publisher when neither is present or usable. LinkedIn has no real
 * connect flow yet, so it only ever resolves via `accessTokenRef` or falls
 * back — this branch simply never matches for it.
 */
export function resolvePublisher(
  workspace: WorkspaceSocialAccounts,
  platform: Platform,
  fallback: ServiceContainer["publishers"],
): Publisher {
  const account = workspace.socialAccounts?.find(
    (a) => a.platform === platform && a.status === "connected",
  );
  if (!account) return fallback[platform];

  if (account.encryptedAccessToken) {
    try {
      const token = decryptSecret(account.encryptedAccessToken);
      const publisher = buildPublisher(platform, token);
      if (publisher) return publisher;
    } catch (err) {
      logger.error(
        { platform, err },
        "failed to decrypt workspace social account token — falling back to the platform default publisher",
      );
      return fallback[platform];
    }
  }

  if (!account.accessTokenRef) {
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

  return buildPublisher(platform, token) ?? fallback[platform];
}
