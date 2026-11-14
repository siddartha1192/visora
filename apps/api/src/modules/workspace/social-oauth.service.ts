import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { withRetry } from "../../lib/retry.js";
import { encryptSecret, decryptSecret } from "../../lib/crypto.js";
import { BadRequestError, NotFoundError, ProviderError } from "../../lib/errors.js";
import { WorkspaceModel } from "../../db/models/index.js";

const META_OAUTH_BASE = "https://www.facebook.com/v21.0/dialog/oauth";
const GRAPH_BASE = "https://graph.facebook.com/v21.0";
const STATE_TTL_MS = 10 * 60 * 1000;

// pages_show_list          — list the user's Facebook Pages
// pages_read_engagement    — required alongside pages_manage_posts by Meta
// pages_manage_posts       — publish to the Page as Facebook
// instagram_basic          — read the linked Instagram Business Account
// instagram_content_publish — publish to Instagram
const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
].join(",");

interface StatePayload {
  workspaceId: string;
  nonce: string;
  exp: number;
}

/**
 * Signs {workspaceId, nonce, exp} into an opaque state param. Not a real JWT
 * session — a short-lived, tamper-evident value that ties Meta's redirect
 * back to the workspace that started the flow and rejects CSRF/replay.
 * Uses plain HMAC (Node's built-in crypto, already a dependency via
 * lib/crypto.ts) rather than @fastify/jwt, which requires a live Fastify
 * instance this service doesn't have.
 */
function signState(payload: StatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", env.TOKEN_ENCRYPTION_KEY).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyState(state: string): StatePayload {
  const [body, sig] = state.split(".");
  if (!body || !sig) throw new BadRequestError("Invalid OAuth state");

  const expectedSig = createHmac("sha256", env.TOKEN_ENCRYPTION_KEY).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new BadRequestError("Invalid OAuth state");
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
  if (payload.exp < Date.now()) throw new BadRequestError("OAuth state expired — please try connecting again");
  return payload;
}

function requireMetaAppCredentials(): { appId: string; appSecret: string } {
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    throw new ProviderError("meta", "META_APP_ID/META_APP_SECRET are not configured");
  }
  return { appId: env.META_APP_ID, appSecret: env.META_APP_SECRET };
}

function redirectUri(): string {
  // WEB_ORIGIN's API counterpart — the callback is a backend route Meta
  // redirects the browser to directly, not a frontend page.
  return `${env.WEB_ORIGIN.includes("localhost") ? "http://localhost:4000" : env.WEB_ORIGIN}/v1/social/callback`;
}

/** Starts the connect flow: returns the URL the frontend should redirect the browser to. */
export function buildAuthorizationUrl(workspaceId: string): string {
  const { appId } = requireMetaAppCredentials();
  const state = signState({ workspaceId, nonce: randomBytes(8).toString("hex"), exp: Date.now() + STATE_TTL_MS });

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri(),
    state,
    scope: SCOPES,
    response_type: "code",
  });
  return `${META_OAUTH_BASE}?${params.toString()}`;
}

interface GraphTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: { message: string };
}

interface GraphPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string };
}

interface GraphPagesResponse {
  data?: GraphPage[];
  error?: { message: string };
}

interface GraphIgUserResponse {
  username?: string;
  error?: { message: string };
}

async function exchangeCodeForUserToken(code: string): Promise<string> {
  const { appId, appSecret } = requireMetaAppCredentials();
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri(),
    code,
  });
  const res = await withRetry<GraphTokenResponse>(
    () => fetch(`${GRAPH_BASE}/oauth/access_token?${params}`).then((r) => r.json() as Promise<GraphTokenResponse>),
    { label: "meta.oauth.code_exchange" },
  );
  if (!res.access_token) throw new ProviderError("meta", res.error?.message ?? "code exchange failed");
  return res.access_token;
}

/** Short-lived user token → long-lived (~60 day) user token. */
async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{ token: string; expiresInSec: number }> {
  const { appId, appSecret } = requireMetaAppCredentials();
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  });
  const res = await withRetry<GraphTokenResponse>(
    () => fetch(`${GRAPH_BASE}/oauth/access_token?${params}`).then((r) => r.json() as Promise<GraphTokenResponse>),
    { label: "meta.oauth.long_lived_exchange" },
  );
  if (!res.access_token) throw new ProviderError("meta", res.error?.message ?? "long-lived token exchange failed");
  return { token: res.access_token, expiresInSec: res.expires_in ?? 60 * 24 * 60 * 60 };
}

/**
 * Lists the user's Facebook Pages (each carries its own Page Access Token —
 * distinct from the user token used to fetch this list) and, for each, the
 * linked Instagram Business Account if one exists.
 */
async function listPages(userAccessToken: string): Promise<GraphPage[]> {
  const params = new URLSearchParams({
    fields: "id,name,access_token,instagram_business_account",
    access_token: userAccessToken,
  });
  const res = await withRetry<GraphPagesResponse>(
    () => fetch(`${GRAPH_BASE}/me/accounts?${params}`).then((r) => r.json() as Promise<GraphPagesResponse>),
    { label: "meta.pages.list" },
  );
  if (res.error) throw new ProviderError("meta", res.error.message);
  return res.data ?? [];
}

async function fetchInstagramUsername(igAccountId: string, pageAccessToken: string): Promise<string> {
  const params = new URLSearchParams({ fields: "username", access_token: pageAccessToken });
  const res = await withRetry<GraphIgUserResponse>(
    () => fetch(`${GRAPH_BASE}/${igAccountId}?${params}`).then((r) => r.json() as Promise<GraphIgUserResponse>),
    { label: "meta.instagram.username" },
  );
  return res.username ?? igAccountId;
}

export interface CallbackResult {
  workspaceId: string;
  connected: Array<{ platform: "facebook" | "instagram"; handle: string }>;
}

/**
 * Completes the connect flow. Auto-selects the first Facebook Page returned
 * by /me/accounts — a workspace with multiple eligible Pages will have the
 * first one connected with no chance to choose, an accepted simplification
 * (see the tenancy plan's Phase 4 notes).
 */
export async function handleCallback(code: string, state: string): Promise<CallbackResult> {
  const { workspaceId } = verifyState(state);

  const workspace = await WorkspaceModel.findById(workspaceId);
  if (!workspace) throw new NotFoundError("Workspace");

  const userToken = await exchangeCodeForUserToken(code);
  const pages = await listPages(userToken);
  const page = pages[0];
  if (!page) {
    throw new ProviderError("meta", "No Facebook Page found for this account — connect a Page you manage first");
  }

  // The Page Access Token from /me/accounts is already effectively
  // long-lived when the user token used to request it was long-lived, but
  // the user token from the code exchange is short-lived — exchange it
  // first so the Page token this yields inherits the long lifetime.
  const { token: longLivedUserToken, expiresInSec } = await exchangeForLongLivedToken(userToken);
  const longLivedPages = await listPages(longLivedUserToken);
  const longLivedPage = longLivedPages.find((p) => p.id === page.id) ?? page;

  const tokenExpiresAt = new Date(Date.now() + expiresInSec * 1000);
  const connected: CallbackResult["connected"] = [];

  const existingFacebook = workspace.socialAccounts.find((a) => a.platform === "facebook");
  if (existingFacebook) {
    existingFacebook.set({
      handle: longLivedPage.name,
      externalAccountId: longLivedPage.id,
      encryptedAccessToken: encryptSecret(longLivedPage.access_token),
      accessTokenRef: null,
      tokenExpiresAt,
      status: "connected",
    });
  } else {
    workspace.socialAccounts.push({
      platform: "facebook",
      handle: longLivedPage.name,
      externalAccountId: longLivedPage.id,
      encryptedAccessToken: encryptSecret(longLivedPage.access_token),
      tokenExpiresAt,
      status: "connected",
    });
  }
  connected.push({ platform: "facebook", handle: longLivedPage.name });

  if (longLivedPage.instagram_business_account) {
    const igId = longLivedPage.instagram_business_account.id;
    const igUsername = await fetchInstagramUsername(igId, longLivedPage.access_token);

    const existingIg = workspace.socialAccounts.find((a) => a.platform === "instagram");
    if (existingIg) {
      existingIg.set({
        handle: igUsername,
        externalAccountId: igId,
        // Instagram publishing uses the same Page Access Token as Facebook.
        encryptedAccessToken: encryptSecret(longLivedPage.access_token),
        accessTokenRef: null,
        tokenExpiresAt,
        status: "connected",
      });
    } else {
      workspace.socialAccounts.push({
        platform: "instagram",
        handle: igUsername,
        externalAccountId: igId,
        encryptedAccessToken: encryptSecret(longLivedPage.access_token),
        tokenExpiresAt,
        status: "connected",
      });
    }
    connected.push({ platform: "instagram", handle: igUsername });
  } else {
    logger.info({ workspaceId, pageId: longLivedPage.id }, "connected Facebook Page has no linked Instagram Business Account");
  }

  await workspace.save();
  return { workspaceId, connected };
}

/** Disconnects one platform for a workspace — clears the stored ciphertext, never leaves a revoked token decryptable. */
export async function disconnect(workspaceId: string, platform: "instagram" | "facebook"): Promise<void> {
  const workspace = await WorkspaceModel.findById(workspaceId);
  if (!workspace) throw new NotFoundError("Workspace");

  const account = workspace.socialAccounts.find((a) => a.platform === platform);
  if (!account) throw new NotFoundError("Social account connection");

  account.set({ status: "revoked", encryptedAccessToken: null, accessTokenRef: null });
  await workspace.save();
}

interface GraphDebugTokenResponse {
  data?: { is_valid: boolean; expires_at: number };
  error?: { message: string };
}

/**
 * Page Access Tokens minted from a long-lived User Access Token do not
 * expire on their own schedule the way the user token does — Meta has no
 * "refresh" call for them, and re-deriving one silently would require the
 * original user token, which is deliberately never stored (storing the
 * derived Page token only, not the user token, is fewer long-lived secrets
 * at rest). What this can and does do: periodically probe each connected
 * token with Meta's token-debug endpoint and mark it "expired" the moment
 * it's no longer valid (revoked by the customer, Page access removed,
 * etc.), so resolvePublisher()'s existing fallback-to-operator-default path
 * (publisher-resolver.ts) kicks in automatically instead of every publish
 * attempt failing opaquely. Reconnecting requires the customer to click
 * "Connect" again — there is no silent renewal.
 */
export async function checkAndMarkExpiredTokens(): Promise<{ checked: number; expired: number }> {
  const { appId, appSecret } = requireMetaAppCredentials();
  const appAccessToken = `${appId}|${appSecret}`;

  const workspaces = await WorkspaceModel.find({
    "socialAccounts.status": "connected",
    "socialAccounts.encryptedAccessToken": { $ne: null },
  });

  let checked = 0;
  let expired = 0;

  for (const workspace of workspaces) {
    for (const account of workspace.socialAccounts) {
      if (account.status !== "connected" || !account.encryptedAccessToken) continue;
      checked += 1;

      try {
        const token = decryptSecret(account.encryptedAccessToken);
        const params = new URLSearchParams({ input_token: token, access_token: appAccessToken });
        const res = await withRetry<GraphDebugTokenResponse>(
          () => fetch(`${GRAPH_BASE}/debug_token?${params}`).then((r) => r.json() as Promise<GraphDebugTokenResponse>),
          { label: "meta.debug_token", retries: 1 },
        );

        if (res.error || !res.data?.is_valid) {
          account.set({ status: "expired" });
          expired += 1;
        }
      } catch (err) {
        logger.error({ err, workspaceId: workspace._id.toString(), platform: account.platform }, "failed checking social account token validity");
      }
    }
    if (workspace.isModified()) await workspace.save();
  }

  return { checked, expired };
}
