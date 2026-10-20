import type { FastifyReply, FastifyRequest } from "fastify";
import { OrganizationModel, UserModel, WorkspaceModel } from "../../db/models/index.js";
import * as tenantService from "../../modules/workspace/tenant.service.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { created, ok } from "../reply.js";

/**
 * Platform-operator endpoints. Every handler here is gated by `requirePlatform`
 * and deliberately crosses organizations — this is the one place that is
 * supposed to.
 */

/**
 * Creates a tenant off the back of a subscription: organization + its single
 * owner + a default workspace, atomically enough that the customer can log in
 * and start working immediately.
 *
 * This replaced public self-registration, which handed any anonymous caller a
 * workspace of their own.
 */
export async function provisionTenant(req: FastifyRequest, reply: FastifyReply) {
  const body = req.body as {
    organizationName: string;
    ownerName: string;
    ownerEmail: string;
    ownerPassword: string;
    workspaceName?: string;
  };

  if (!body.organizationName?.trim()) throw new BadRequestError("organizationName is required");
  if (!body.ownerEmail?.trim()) throw new BadRequestError("ownerEmail is required");
  if ((body.ownerPassword ?? "").length < 8) {
    throw new BadRequestError("ownerPassword must be at least 8 characters");
  }

  return created(reply, await tenantService.provisionTenant(body));
}

/** Every tenant, with headline counts — the operator's customer list. */
export async function listTenants(_req: FastifyRequest, reply: FastifyReply) {
  const orgs = await OrganizationModel.find().sort({ createdAt: -1 }).lean();

  const items = await Promise.all(
    orgs.map(async (org) => {
      const [userCount, workspaceCount] = await Promise.all([
        UserModel.countDocuments({ organizationId: org._id }),
        WorkspaceModel.countDocuments({ organizationId: org._id, archivedAt: null }),
      ]);
      return {
        ...tenantService.toOrganizationDTO(org as Parameters<typeof tenantService.toOrganizationDTO>[0]),
        userCount,
        workspaceCount,
      };
    }),
  );

  return ok(reply, items);
}

/**
 * Suspends or reactivates a whole tenant. Suspension is enforced at login and
 * on every authenticated request via the account-status check, so it takes
 * effect without needing to touch each user individually.
 */
export async function setTenantStatus(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const { status } = req.body as { status: "active" | "suspended" };

  const org = await OrganizationModel.findByIdAndUpdate(
    id,
    { $set: { status } },
    { new: true },
  );
  if (!org) throw new NotFoundError("Organization");

  // Mirror onto the tenant's users so the existing per-request status check
  // rejects them; without this, suspending an org would be cosmetic.
  await UserModel.updateMany(
    { organizationId: org._id, platformRole: null },
    { $set: { status: status === "suspended" ? "suspended" : "active" } },
  );

  return ok(reply, tenantService.toOrganizationDTO(org));
}
