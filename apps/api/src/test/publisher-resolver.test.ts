import { describe, expect, it, vi, afterEach } from "vitest";
import type { Platform } from "@visora/shared";
import type { Publisher } from "../integrations/interfaces/ports.js";
import type { ServiceContainer } from "../config/container.js";
import { resolvePublisher } from "../modules/workspace/publisher-resolver.js";

function stubPublisher(platform: Platform): Publisher {
  return { platform, publish: vi.fn() };
}

describe("resolvePublisher", () => {
  const fallback: ServiceContainer["publishers"] = {
    instagram: stubPublisher("instagram"),
    facebook: stubPublisher("facebook"),
    linkedin: stubPublisher("linkedin"),
    x: stubPublisher("x"),
  };

  afterEach(() => {
    delete process.env.WORKSPACE_TEST_TOKEN;
  });

  it("falls back to the platform-default publisher when the workspace has no connected account", () => {
    const publisher = resolvePublisher({ socialAccounts: [] }, "instagram", fallback);
    expect(publisher).toBe(fallback.instagram);
  });

  it("falls back when the account exists but isn't connected", () => {
    const publisher = resolvePublisher(
      { socialAccounts: [{ platform: "instagram", status: "revoked" }] },
      "instagram",
      fallback,
    );
    expect(publisher).toBe(fallback.instagram);
  });

  it("falls back with a warning when accessTokenRef points at an unset env var", () => {
    const publisher = resolvePublisher(
      {
        socialAccounts: [
          { platform: "instagram", status: "connected", accessTokenRef: "SOME_ENV_VAR_THAT_DOES_NOT_EXIST" },
        ],
      },
      "instagram",
      fallback,
    );
    expect(publisher).toBe(fallback.instagram);
  });

  it("resolves a workspace-specific publisher when accessTokenRef points at a set env var", () => {
    process.env.WORKSPACE_TEST_TOKEN = "test-token-value";
    const publisher = resolvePublisher(
      {
        socialAccounts: [
          { platform: "instagram", status: "connected", accessTokenRef: "WORKSPACE_TEST_TOKEN" },
        ],
      },
      "instagram",
      fallback,
    );
    expect(publisher).not.toBe(fallback.instagram);
    expect(publisher.platform).toBe("instagram");
  });

  it("ignores a connected account for a different platform", () => {
    const publisher = resolvePublisher(
      { socialAccounts: [{ platform: "facebook", status: "connected", accessTokenRef: "X" }] },
      "instagram",
      fallback,
    );
    expect(publisher).toBe(fallback.instagram);
  });
});
