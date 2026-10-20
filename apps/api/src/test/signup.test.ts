import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers.js";
import { OrganizationModel, UserModel, WorkspaceModel } from "../db/models/index.js";

function validPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    organizationName: "Acme Corp",
    ownerName: "Ada Lovelace",
    email: "ada@acme.test",
    password: "password123",
    planId: "basic",
    card: { number: "4242424242424242", expMonth: 12, expYear: 2030, cvc: "123" },
    ...overrides,
  };
}

describe("public signup", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates an organization, owner, and default workspace, and returns usable tokens", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: validPayload(),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json().data;
    expect(body.organization.plan).toBe("basic");
    expect(body.workspace.organizationId).toBe(body.organization.id);
    expect(body.tokens.accessToken).toBeTruthy();

    const meRes = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${body.tokens.accessToken}` },
    });
    expect(meRes.statusCode).toBe(200);
    const me = meRes.json().data;
    expect(me.organization.id).toBe(body.organization.id);
    expect(me.orgRole).toBe("owner");
  });

  it("sets Organization.plan to premium when planId is premium", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: validPayload({ email: "premium-owner@acme.test", planId: "premium" }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.organization.plan).toBe("premium");
  });

  it("rejects a duplicate email and creates no new records", async () => {
    const email = "dup@acme.test";
    await app.inject({ method: "POST", url: "/v1/auth/signup", payload: validPayload({ email }) });

    const [orgsBefore, usersBefore] = await Promise.all([
      OrganizationModel.countDocuments({}),
      UserModel.countDocuments({}),
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: validPayload({ email, organizationName: "Second Attempt" }),
    });
    expect(res.statusCode).toBe(409);

    const [orgsAfter, usersAfter] = await Promise.all([
      OrganizationModel.countDocuments({}),
      UserModel.countDocuments({}),
    ]);
    expect(orgsAfter).toBe(orgsBefore);
    expect(usersAfter).toBe(usersBefore);
  });

  it("rejects a declined mock card and creates no records", async () => {
    const [orgsBefore, usersBefore] = await Promise.all([
      OrganizationModel.countDocuments({}),
      UserModel.countDocuments({}),
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: validPayload({
        email: "declined@acme.test",
        card: { number: "4000000000000002", expMonth: 12, expYear: 2030, cvc: "123" },
      }),
    });
    expect(res.statusCode).toBe(502);

    const [orgsAfter, usersAfter] = await Promise.all([
      OrganizationModel.countDocuments({}),
      UserModel.countDocuments({}),
    ]);
    expect(orgsAfter).toBe(orgsBefore);
    expect(usersAfter).toBe(usersBefore);
    expect(await UserModel.exists({ email: "declined@acme.test" })).toBeNull();
  });

  it("rejects an invalid planId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: validPayload({ email: "badplan@acme.test", planId: "enterprise" }),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it("rejects a short password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: validPayload({ email: "shortpw@acme.test", password: "short" }),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it("caps a Basic-plan org at one active workspace; Premium is uncapped", async () => {
    const signupRes = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: validPayload({ email: "basic-cap@acme.test", organizationName: "Basic Cap Co" }),
    });
    const { tokens } = signupRes.json().data;

    const blocked = await app.inject({
      method: "POST",
      url: "/v1/workspaces",
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      payload: { name: "Second Brand" },
    });
    expect(blocked.statusCode).toBe(409);

    const premiumRes = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: validPayload({
        email: "premium-cap@acme.test",
        organizationName: "Premium Cap Co",
        planId: "premium",
      }),
    });
    const premiumTokens = premiumRes.json().data.tokens;

    const allowed = await app.inject({
      method: "POST",
      url: "/v1/workspaces",
      headers: { authorization: `Bearer ${premiumTokens.accessToken}` },
      payload: { name: "Second Brand" },
    });
    expect(allowed.statusCode).toBe(201);
  });

  it("does not create the workspace with the wrong organizationId on a fresh org", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: validPayload({ email: "wscheck@acme.test", organizationName: "WS Check Co" }),
    });
    const { organization, workspace } = res.json().data;
    const ws = await WorkspaceModel.findById(workspace.id).lean();
    expect(ws?.organizationId?.toString()).toBe(organization.id);
  });
});
