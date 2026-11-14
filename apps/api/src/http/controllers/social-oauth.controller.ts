import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { NotFoundError } from "../../lib/errors.js";
import { workspaceBelongsToOrg } from "../middleware/auth.js";
import * as socialOAuthService from "../../modules/workspace/social-oauth.service.js";
import { ok } from "../reply.js";

function webSettingsUrl(query: string): string {
  return `${env.WEB_ORIGIN.replace(/\/$/, "")}/settings?${query}`;
}

/**
 * Starts the connect flow for one workspace. `requireOrgOwner` at the route
 * level already restricts this to org owners; this additionally confirms the
 * target workspace actually belongs to the caller's own org, the same check
 * workspace.controller.ts's createWorkspace/renameWorkspace use.
 */
export async function connect(req: FastifyRequest, reply: FastifyReply) {
  const { id: workspaceId } = req.params as { id: string };
  const auth = req.auth!;

  if (!(await workspaceBelongsToOrg(workspaceId, auth.organizationId))) {
    throw new NotFoundError("Workspace");
  }

  const authorizationUrl = socialOAuthService.buildAuthorizationUrl(workspaceId);
  return ok(reply, { authorizationUrl });
}

/**
 * Meta redirects the browser here directly — public, no bearer token is
 * available at this point. Authorization is the signed `state` param minted
 * by connect() above, verified inside handleCallback.
 */
export async function callback(req: FastifyRequest, reply: FastifyReply) {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

  if (error || !code || !state) {
    return reply.redirect(webSettingsUrl(`error=${encodeURIComponent(error ?? "connection_cancelled")}`));
  }

  try {
    const result = await socialOAuthService.handleCallback(code, state);
    const platforms = result.connected.map((c) => c.platform).join(",");
    return reply.redirect(webSettingsUrl(`connected=${encodeURIComponent(platforms)}`));
  } catch (err) {
    logger.error({ err }, "social OAuth callback failed");
    return reply.redirect(webSettingsUrl(`error=${encodeURIComponent((err as Error).message)}`));
  }
}

export async function disconnect(req: FastifyRequest, reply: FastifyReply) {
  const { id: workspaceId, platform } = req.params as { id: string; platform: "instagram" | "facebook" };
  const auth = req.auth!;

  if (!(await workspaceBelongsToOrg(workspaceId, auth.organizationId))) {
    throw new NotFoundError("Workspace");
  }

  await socialOAuthService.disconnect(workspaceId, platform);
  return ok(reply, { disconnected: platform });
}
