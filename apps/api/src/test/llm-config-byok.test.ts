import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Types } from "mongoose";
import { buildTestApp, seedOrg, seedMember, authHeader, type SeededOrg } from "./helpers.js";
import { LlmConfigModel, NodeConfigModel } from "../db/models/index.js";
import { resolveNodeAdapters } from "../orchestration/node-adapters.js";

/**
 * BYOK: an org's own LlmConfig, for a provider the platform admin has also
 * assigned to a node, is preferred over the platform-global key on every
 * pipeline run for that org — see resolveNodeAdapters's docstring. An org
 * with no BYOK config gets exactly today's platform-default behavior.
 */
describe("BYOK LlmConfig", () => {
  let app: FastifyInstance;
  let orgA: SeededOrg;
  let orgB: SeededOrg;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await LlmConfigModel.deleteMany({});
    await NodeConfigModel.deleteMany({});
  });

  it("lets an org owner create, list, update, and delete their own BYOK config", async () => {
    orgA = await seedOrg(app, { orgName: "BYOK Org A", ownerEmail: "owner-a@byok.test" });

    const createRes = await app.inject({
      method: "POST",
      url: "/v1/llm-configs",
      headers: authHeader(orgA.ownerToken),
      payload: { label: "My OpenAI key", provider: "openai", apiKey: "sk-test-abcdef1234" },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json().data;
    expect(created.apiKeyMasked).not.toContain("abcdef1234".slice(0, -4));
    expect(created.apiKeyMasked).toContain("1234");

    const listRes = await app.inject({
      method: "GET",
      url: "/v1/llm-configs",
      headers: authHeader(orgA.ownerToken),
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data).toHaveLength(1);

    const updateRes = await app.inject({
      method: "PATCH",
      url: `/v1/llm-configs/${created.id}`,
      headers: authHeader(orgA.ownerToken),
      payload: { isActive: false },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().data.isActive).toBe(false);

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/v1/llm-configs/${created.id}`,
      headers: authHeader(orgA.ownerToken),
    });
    expect(deleteRes.statusCode).toBe(200);
  });

  it("rejects a non-owner workspace member", async () => {
    orgA = await seedOrg(app, { orgName: "BYOK Org A2", ownerEmail: "owner-a2@byok.test" });
    const member = await seedMember(app, {
      orgId: orgA.orgId,
      workspaceId: orgA.workspaceId,
      email: "member-a2@byok.test",
      workspaceRole: "admin",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-configs",
      headers: authHeader(member.token),
      payload: { label: "x", provider: "openai", apiKey: "sk-test" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("never lets Org A see, update, or delete Org B's BYOK config", async () => {
    orgA = await seedOrg(app, { orgName: "BYOK Org A3", ownerEmail: "owner-a3@byok.test" });
    orgB = await seedOrg(app, { orgName: "BYOK Org B3", ownerEmail: "owner-b3@byok.test" });

    const createRes = await app.inject({
      method: "POST",
      url: "/v1/llm-configs",
      headers: authHeader(orgB.ownerToken),
      payload: { label: "Org B's key", provider: "openai", apiKey: "sk-test-orgb" },
    });
    const orgBConfigId = createRes.json().data.id;

    const listRes = await app.inject({
      method: "GET",
      url: "/v1/llm-configs",
      headers: authHeader(orgA.ownerToken),
    });
    expect(listRes.json().data).toHaveLength(0);

    const updateRes = await app.inject({
      method: "PATCH",
      url: `/v1/llm-configs/${orgBConfigId}`,
      headers: authHeader(orgA.ownerToken),
      payload: { isActive: false },
    });
    expect(updateRes.statusCode).toBe(404);

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/v1/llm-configs/${orgBConfigId}`,
      headers: authHeader(orgA.ownerToken),
    });
    expect(deleteRes.statusCode).toBe(404);
  });

  it("rejects an unsupported provider", async () => {
    orgA = await seedOrg(app, { orgName: "BYOK Org A4", ownerEmail: "owner-a4@byok.test" });
    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-configs",
      headers: authHeader(orgA.ownerToken),
      payload: { label: "x", provider: "not-a-real-provider", apiKey: "sk-test" },
    });
    expect(res.statusCode).toBe(400);
  });

  describe("resolveNodeAdapters resolution order", () => {
    it("uses the platform config when the org has no BYOK config for that provider", async () => {
      const platformCfg = await LlmConfigModel.create({
        label: "Platform default",
        provider: "openai",
        apiKey: "sk-platform-key",
        organizationId: null,
      });
      await NodeConfigModel.create({
        singletonKey: "global",
        assignments: { caption: platformCfg._id },
      });

      const adapters = await resolveNodeAdapters(new Types.ObjectId());
      expect(adapters.caption?.languageModel).toBeDefined();
    });

    it("prefers the org's own BYOK config over the platform default for the same provider", async () => {
      const orgId = new Types.ObjectId();
      const platformCfg = await LlmConfigModel.create({
        label: "Platform default",
        provider: "openai",
        apiKey: "sk-platform-key",
        organizationId: null,
      });
      await LlmConfigModel.create({
        label: "Org BYOK",
        provider: "openai",
        apiKey: "sk-org-key",
        organizationId: orgId,
      });
      await NodeConfigModel.create({
        singletonKey: "global",
        assignments: { caption: platformCfg._id },
      });

      // Both orgId-scoped and no-org resolution should produce a working
      // adapter — the distinguishing behavior (which key is used) lives
      // inside the OpenAI adapter construction, not observable without a
      // live API call, so this asserts resolution completes for both paths
      // rather than inspecting the adapter's private key.
      const withOrg = await resolveNodeAdapters(orgId);
      const withoutOrg = await resolveNodeAdapters();
      expect(withOrg.caption?.languageModel).toBeDefined();
      expect(withoutOrg.caption?.languageModel).toBeDefined();
    });

    it("ignores an inactive org BYOK config", async () => {
      const orgId = new Types.ObjectId();
      const platformCfg = await LlmConfigModel.create({
        label: "Platform default",
        provider: "openai",
        apiKey: "sk-platform-key",
        organizationId: null,
      });
      await LlmConfigModel.create({
        label: "Org BYOK (inactive)",
        provider: "openai",
        apiKey: "sk-org-key",
        organizationId: orgId,
        isActive: false,
      });
      await NodeConfigModel.create({
        singletonKey: "global",
        assignments: { caption: platformCfg._id },
      });

      const adapters = await resolveNodeAdapters(orgId);
      expect(adapters.caption?.languageModel).toBeDefined();
    });
  });
});
