import type { Platform } from "@visora/shared";
import { logger } from "../../lib/logger.js";
import type {
  Publisher,
  PublishParams,
  PublishResult,
} from "../interfaces/ports.js";

/**
 * Placeholder publisher. Real OAuth-backed publishers (Instagram Graph API,
 * Facebook Pages, X v2, LinkedIn UGC) implement this same `Publisher` port and
 * register per-platform in the container — the Publish node never changes.
 *
 * Until those credentials/OAuth flows are wired, this simulates a successful
 * publish so the full pipeline (and the UI status lifecycle) is exercisable.
 */
export class StubPublisher implements Publisher {
  constructor(public readonly platform: Platform) {}

  async publish(params: PublishParams): Promise<PublishResult> {
    const externalPostId = `stub_${this.platform}_${Date.now()}`;
    logger.info(
      { platform: this.platform, accountId: params.accountId },
      "stub publish",
    );
    return {
      externalPostId,
      permalink: `https://${this.platform}.example/p/${externalPostId}`,
    };
  }
}
