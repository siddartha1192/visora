# X (Twitter) and LinkedIn Connect: Implementation Plan

Engineering companion to [social-integration-x-linkedin.md](social-integration-x-linkedin.md), which covers the
"what and why" for each platform. This file is the "how" for the Visora codebase: exact files, functions,
data shapes, order of work, and tests. Nothing here is implemented yet.

> Platform facts (endpoints, scopes, token lifetimes, API versions) were checked in Nov 2026. Re-check
> docs.x.com and learn.microsoft.com/linkedin when you start each phase.

---

## 0. Current state (what exists today)

| Area | File | State |
|---|---|---|
| OAuth service | `apps/api/src/modules/workspace/social-oauth.service.ts` | **Meta-only.** `buildAuthorizationUrl`, `handleCallback`, `disconnect`, `checkAndMarkExpiredTokens`. State = HMAC-signed `{workspaceId, nonce, exp}` with **no platform field** |
| Controller | `apps/api/src/http/controllers/social-oauth.controller.ts` | `connect`, `callback`, `disconnect`. `disconnect` is typed `"instagram" \| "facebook"` |
| Routes | `apps/api/src/http/routes/index.ts` | Public `GET /v1/social/callback` (single callback, about lines 158-181). Authenticated `POST /workspaces/:id/social/:platform/connect` and `DELETE /workspaces/:id/social/:platform`, with `platform` enum `["instagram","facebook"]` (about lines 344-377) |
| Schema | `apps/api/src/db/models/workspace.model.ts` | `socialAccountSchema`: `platform, handle, externalAccountId, accessTokenRef, encryptedAccessToken, tokenExpiresAt, status`. **No refresh token** |
| Resolver | `apps/api/src/modules/workspace/publisher-resolver.ts` | `buildPublisher()` handles instagram/facebook/linkedin. **No `x` case** |
| Publishers | `apps/api/src/integrations/publishers/` | `facebook`, `instagram`, `linkedin`, `stub`. **No `x.publisher.ts`.** LinkedIn uses `LinkedIn-Version: 202504` (stale) |
| Container | `apps/api/src/config/container.ts` (about lines 108-123) | Default publishers. `x` always falls back to `StubPublisher` |
| Worker | `apps/api/src/worker.ts` (about lines 31-43) | Interval calls `checkAndMarkExpiredTokens()` |
| Publish node | `apps/api/src/orchestration/nodes/publish.node.ts` | Calls `resolvePublisher` and wraps `publish()` in `withRetry(retries: 2)`. Uses `target.accountId` from the post, **not** the connected account's `externalAccountId`. **No per-platform caption length limit** |
| Env | `apps/api/src/config/env.ts` | `LINKEDIN_ACCESS_TOKEN`, `META_APP_ID/SECRET`, `TOKEN_ENCRYPTION_KEY`. No X or LinkedIn OAuth client vars |
| Shared | `packages/shared/src/constants/enums.ts` | `PLATFORMS = ["instagram","facebook","x","linkedin"]`. Already includes `x` |
| Shared DTO | `packages/shared/src/types/domain.ts` | `SocialAccountDTO` with no account type field |
| Web | `apps/web/src/app/(dashboard)/settings/page.tsx` | `CONNECTABLE = {instagram, facebook}`. Calls cast the platform to `"instagram" \| "facebook"` |
| Web API | `apps/web/src/lib/api.ts` (about lines 301-309) | `connectSocialAccount` / `disconnectSocialAccount` typed to the two Meta platforms |
| Tests | `apps/api/src/test/social-oauth.test.ts`, `publisher-resolver.test.ts` | Meta flow plus crypto round-trip |

### Known defects to fix first (Phase 0)
1. **`checkAndMarkExpiredTokens()` sends every connected account's token to Meta's `debug_token`.** As soon as
   one X or LinkedIn account is stored, the daily sweep marks it `expired`. Filter to
   `platform ∈ {facebook, instagram}`.
2. **`redirectUri()`** builds the URL by looking for "localhost" in `WEB_ORIGIN`. X and LinkedIn require an
   exact registered redirect URI, so use an explicit `API_PUBLIC_URL`.
3. **LinkedIn API version `202504`**: LinkedIn sunsets versions about 12 months after release. Move it to config.

---

## 1. Target architecture

```
                         ┌──────────────────────────────────────────────┐
POST /workspaces/:id/    │ social-oauth.service.ts (orchestrator)        │
 social/:platform/connect│  startConnect(workspaceId, platform, opts)    │
          │              │  completeConnect(platform, code, state)       │
          ▼              │  disconnect(workspaceId, platform)            │
   providers[platform] ◀─┤  refreshIfNeeded(workspace, account)          │
          │              │  sweepTokens()                                │
          ▼              └──────────────────────────────────────────────┘
 ┌──────────────┐ ┌──────────────┐ ┌───────────────────┐
 │ meta.provider│ │  x.provider  │ │ linkedin.provider │   implements OAuthProvider
 └──────────────┘ └──────────────┘ └───────────────────┘
GET /v1/social/:platform/callback  ──▶ completeConnect()
GET /v1/social/callback (legacy)   ──▶ completeConnect("meta")   // keep: already registered at Meta
```

### 1.1 New files

```
apps/api/src/modules/workspace/social/
  oauth-provider.ts          # interface + shared types
  oauth-state.ts             # signState/verifyState moved out of the service, + platform + PKCE
  pkce.ts                    # verifier/challenge helpers
  token-lock.ts              # Redis per-account lock for refresh (X refresh tokens are single-use)
  providers/meta.provider.ts # existing Meta logic moved, unchanged behaviour
  providers/x.provider.ts
  providers/linkedin.provider.ts
  index.ts                   # providers registry: Record<ConnectablePlatform, OAuthProvider>
apps/api/src/integrations/publishers/x.publisher.ts
apps/api/src/test/x-oauth.test.ts
apps/api/src/test/linkedin-oauth.test.ts
apps/api/src/test/x-publisher.test.ts
apps/api/src/test/token-sweep.test.ts
```

`social-oauth.service.ts` stays as the public facade (the controller and worker import it), so the import
paths elsewhere stay the same.

### 1.2 `OAuthProvider` interface

```ts
// oauth-provider.ts
import type { Platform } from "@visora/shared";

export type ProviderKey = "meta" | "x" | "linkedin";

export interface StartOptions {
  workspaceId: string;
  /** LinkedIn only: post as the member, or as a Company Page they administer. */
  linkedinTarget?: "member" | "organization";
}

export interface TokenSet {
  accessToken: string;
  accessTokenExpiresAt: Date | null;
  refreshToken?: string | null;
  refreshTokenExpiresAt?: Date | null;
  scopes?: string[];
}

export interface ConnectedAccount {
  platform: Platform;
  handle: string;
  externalAccountId: string;           // X: user id; LinkedIn: full URN
  accountType?: "person" | "organization" | "page" | "business";
  tokens: TokenSet;
}

/** Returned when the user must choose (LinkedIn org list, Meta Page list later). */
export interface PendingSelection {
  selectionId: string;                  // opaque, short-lived (Redis, 10 min)
  options: Array<{ externalAccountId: string; handle: string; accountType: string }>;
}

export interface OAuthProvider {
  readonly key: ProviderKey;
  readonly platforms: Platform[];       // meta → [facebook, instagram]
  isConfigured(): boolean;
  buildAuthorizationUrl(opts: StartOptions, state: string, pkceChallenge?: string): string;
  usesPkce: boolean;
  exchangeCode(code: string, pkceVerifier?: string, opts?: StartOptions): Promise<TokenSet>;
  identify(tokens: TokenSet, opts?: StartOptions): Promise<ConnectedAccount[] | PendingSelection>;
  refresh?(account: { refreshToken: string }): Promise<TokenSet>;
  revoke?(accessToken: string): Promise<void>;
  /** Cheap validity probe for the sweep; return false = mark expired. */
  probe(account: DecryptedAccount): Promise<boolean>;
}
```

### 1.3 State param (`oauth-state.ts`)

Extend the current payload. It stays HMAC-SHA256 signed with `TOKEN_ENCRYPTION_KEY`.

```ts
interface StatePayload {
  workspaceId: string;
  provider: ProviderKey;         // NEW: callback routes on this, and checks it matches :platform
  nonce: string;                 // also the Redis key for the PKCE verifier
  exp: number;                   // now + 10 min
  linkedinTarget?: "member" | "organization";
}
```

**PKCE verifier storage:** Redis `SET oauth:pkce:<nonce> <verifier> EX 600 NX`, then `GETDEL` in the callback.
`GETDEL` makes the state single-use, which also stops replay. Today's Meta state can be replayed within its
10-minute window, so give Meta the same nonce-consumption step.
- Redis: the API currently only hands connection *options* to BullMQ (`queue/connection.ts`). Add a small shared
  `ioredis` client (`lib/redis.ts`) built from the same `parseRedisUrl`. `ioredis` is already installed as a
  BullMQ dependency, but add it to `apps/api/package.json` explicitly.

---

## 2. Data model changes

### 2.1 `workspace.model.ts`: `socialAccountSchema`

```ts
encryptedRefreshToken: { type: String },          // AES-256-GCM via encryptSecret, never plaintext
refreshTokenExpiresAt: { type: Date },
accountType: { type: String, enum: ["person", "organization", "page", "business"] },
scopes: { type: [String], default: undefined },
lastRefreshedAt: { type: Date },
lastErrorCode: { type: String },                  // e.g. "invalid_grant", "REVOKED_ACCESS_TOKEN"
```

- No migration is needed because the fields are optional. Existing Meta rows remain valid.
- **Uniqueness:** today it is one account per platform per workspace (`find(a => a.platform === …)`). Keep that
  for v1. LinkedIn member vs organization is still `platform: "linkedin"`, with `accountType` telling them apart.
  Re-connecting replaces the existing row.

### 2.2 Shared DTO (`packages/shared/src/types/domain.ts`)

```ts
export interface SocialAccountDTO {
  id: string; platform: Platform; handle: string; externalAccountId: string;
  status: "connected" | "expired" | "revoked";
  accountType?: "person" | "organization" | "page" | "business";   // NEW
  tokenExpiresAt?: string | null;                                    // NEW, for a "reconnect in N days" hint
}
```
Update the workspace serializer to include these fields, and never the ciphertext.

> Note: `WorkspaceDTO.socialAccounts` currently lists only `connected` accounts. To show a **Reconnect** button,
> the UI needs `expired` accounts too. Either include them (and update the UI so it no longer treats absence as
> "not connected") or add an `expiredPlatforms` field. **Recommended:** include every non-revoked account.

---

## 3. Config (`apps/api/src/config/env.ts`)

```ts
API_PUBLIC_URL: z.string().url().optional(),        // e.g. https://api.yourdomain.com. Redirects are built from it
X_CLIENT_ID: z.string().optional(),
X_CLIENT_SECRET: z.string().optional(),
X_SCOPES: z.string().default("tweet.read tweet.write users.read media.write offline.access"),
LINKEDIN_CLIENT_ID: z.string().optional(),            // "Visora" app: OIDC + Share on LinkedIn
LINKEDIN_CLIENT_SECRET: z.string().optional(),
LINKEDIN_PAGES_CLIENT_ID: z.string().optional(),      // "Visora Pages" app: Community Management API
LINKEDIN_PAGES_CLIENT_SECRET: z.string().optional(),
LINKEDIN_API_VERSION: z.string().default("202610"),   // YYYYMM. Bump every quarter
```

Redirect URIs (register exactly these with each platform):
- Meta: `${API_PUBLIC_URL}/v1/social/callback` (legacy, already registered) **or** `/v1/social/meta/callback`
- X: `${API_PUBLIC_URL}/v1/social/x/callback`
- LinkedIn: `${API_PUBLIC_URL}/v1/social/linkedin/callback`

`redirectUri(provider)` falls back to `http://localhost:4000` only when `NODE_ENV !== "production"` and
`API_PUBLIC_URL` is unset. Fail fast in production.

Also update `.env.example`, `docker-compose.yml` env passthrough and `infra/` manifests.

---

## 4. X provider (`providers/x.provider.ts`)

| Step | Call |
|---|---|
| Authorize URL | `https://x.com/i/oauth2/authorize?response_type=code&client_id&redirect_uri&scope&state&code_challenge&code_challenge_method=S256` |
| Code exchange | `POST https://api.x.com/2/oauth2/token`, header `Authorization: Basic b64(id:secret)`, form `grant_type=authorization_code&code&redirect_uri&code_verifier` |
| Identify | `GET https://api.x.com/2/users/me` (Bearer) → `{data:{id, username, name}}` |
| Refresh | `POST /2/oauth2/token` form `grant_type=refresh_token&refresh_token` (Basic auth). **Returns a new refresh token; the old one is dead** |
| Revoke | `POST https://api.x.com/2/oauth2/revoke` form `token&token_type_hint=access_token` (Basic auth) |
| Probe | `GET /2/users/me`. 401 means try a refresh, and if the refresh gives `invalid_grant`, the account is expired |

Account values: `externalAccountId = data.id`, `handle = "@" + username`, `accountType = "person"`,
access token expiry `now + expires_in` (7200 s). No fixed expiry for the refresh token (it lives until used or revoked).

### 4.1 Refresh-token rotation: must be race-safe
```ts
// token-lock.ts
export async function withAccountLock<T>(key: string, fn: () => Promise<T>): Promise<T>
// SET lock:social:<workspaceId>:<platform> <uuid> NX PX 15000; release with compare-and-delete Lua script
```
`refreshIfNeeded(workspaceId, platform)`:
1. Re-read the account **inside** the lock. Another worker may have just refreshed it.
2. If `tokenExpiresAt - now > 5 min`, return the current token.
3. Call `provider.refresh()`, then **persist the access and refresh tokens in one `updateOne`** using the
   positional operator (`{_id, "socialAccounts.platform": p}` → `$set socialAccounts.$.…`). A full
   `workspace.save()` races with other writers.
4. `invalid_grant` → `status: "expired"`, `lastErrorCode: "invalid_grant"`, clear the ciphertext.

---

## 5. LinkedIn provider (`providers/linkedin.provider.ts`)

Two apps, so pick the client by `linkedinTarget`:
- `member` → `LINKEDIN_CLIENT_ID`, scopes `openid profile email w_member_social`
- `organization` → `LINKEDIN_PAGES_CLIENT_ID`, scopes `r_organization_social w_organization_social rw_organization_admin`

| Step | Call |
|---|---|
| Authorize URL | `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id&redirect_uri&state&scope` (no PKCE needed for confidential web apps) |
| Code exchange | `POST https://www.linkedin.com/oauth/v2/accessToken` form `grant_type=authorization_code&code&redirect_uri&client_id&client_secret` → `access_token, expires_in (~5,184,000), refresh_token?, refresh_token_expires_in?, scope` |
| Identify (member) | `GET https://api.linkedin.com/v2/userinfo` → `sub, name`. `externalAccountId = "urn:li:person:" + sub` |
| Identify (org) | `GET /rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED` (headers `LinkedIn-Version`, `X-Restli-Protocol-Version: 2.0.0`), then `GET /rest/organizations/{id}` for `localizedName`. More than one org → return a `PendingSelection` |
| Refresh | Only when `refresh_token` was issued (approved Community Management apps): `grant_type=refresh_token&refresh_token&client_id&client_secret`. The refresh token keeps its original 365-day expiry |
| Revoke | `POST https://www.linkedin.com/oauth/v2/revoke` form `token&client_id&client_secret` |
| Probe | Member: `/v2/userinfo`. Org: `/rest/organizationAcls`. Also check `tokenExpiresAt` |

### 5.1 Page selection flow (organization target)
1. Callback gets `PendingSelection`. Store `{workspaceId, tokens(encrypted), options}` under
   `oauth:select:<selectionId>` with a 10-min TTL. Redirect to `${WEB_ORIGIN}/settings?select=linkedin&sid=<id>`.
2. New authenticated routes:
   - `GET  /workspaces/:id/social/linkedin/selection/:sid` → options (handles only, no tokens)
   - `POST /workspaces/:id/social/linkedin/selection/:sid` body `{externalAccountId}`. Verify the selection's
     `workspaceId === :id`, then persist and `GETDEL` the selection.
3. The same mechanism can later fix the Meta "first Page only" simplification.

### 5.2 Expiry without a refresh token (member flow)
- The sweep marks the account `expired` once `tokenExpiresAt < now`.
- **7-day pre-expiry notice:** the sweep emits a `social.token_expiring` event (log or notification) for
  `tokenExpiresAt - now < 7d`. Wire it to email when a notifications module exists. Until then, the Settings
  page shows "Reconnect in N days" using `tokenExpiresAt`.

---

## 6. X publisher (`integrations/publishers/x.publisher.ts`)

```ts
export class XPublisher implements Publisher {
  readonly platform: Platform = "x";
  constructor(private accessToken: string) {}
  async publish({ imageUrl, caption }: PublishParams): Promise<PublishResult> {
    // 1. bytes = fetchImage(imageUrl)            (reuse lib/fetch-image.ts)
    // 2. media_id = uploadMedia(bytes, mime)
    //      ≤ 5 MB image: POST https://api.x.com/2/media/upload  (multipart: media, media_category=tweet_image)
    //      larger/GIF:   chunked INIT → APPEND(segment_index) → FINALIZE → poll STATUS until succeeded
    // 3. (optional) POST /2/media/metadata {id, metadata:{alt_text:{text}}}
    // 4. POST https://api.x.com/2/tweets {text: truncate(caption, 280), media:{media_ids:[media_id]}}
    // 5. return { externalPostId: data.id, permalink: `https://x.com/i/web/status/${data.id}` }
  }
}
```

Error mapping. Add a `NonRetryableProviderError` (or a `retryable` flag on `ProviderError`) so the
`withRetry` in `publish.node.ts` stops retrying requests that will fail every time:

| Response | Meaning | Retry? |
|---|---|---|
| 403 with `duplicate` in detail | Duplicate content | No |
| 403 / 402 credits or "client-not-enrolled" | Billing or tier problem: alert the operator | No |
| 429 | Rate limit: honour `x-rate-limit-reset` | Yes, with delay |
| 401 | Token expired/revoked: refresh once (see §7), then fail | No (after one refresh) |
| 5xx | Transient | Yes |

`permalink`: `https://x.com/i/web/status/<id>` works without the username. Use `https://x.com/<handle>/status/<id>`
when the handle is at hand.

Caption: X counts URLs as 23 characters and some characters as 2. Use `twitter-text` (npm) for
`parseTweet(text).valid` and truncate with an ellipsis. Do this in the publisher. Also add a `maxCaptionChars`
field to `PLATFORM_SPECS` (`x: 280, linkedin: 3000, instagram: 2200, facebook: 63206`) so the composer can warn the user.

---

## 7. Wiring into publishing

### 7.1 `publisher-resolver.ts`
- Add `case "x": return new XPublisher(token);`.
- **Pass the connected `externalAccountId`.** `publish.node.ts` currently sends `target.accountId` from the
  post. For LinkedIn this must be the URN of the connected member or org. Use one of these:
  - (a) the resolver returns `{ publisher, accountId: account.externalAccountId }` and the publish node prefers
    it over `target.accountId`, **or**
  - (b) publishers take the account id in their constructor.
  **Recommended: (a).** It touches less code, and the `PublishParams` shape stays the same.
- Make `resolvePublisher` **async** so it can call `refreshIfNeeded()` for X (always) and LinkedIn (when a refresh
  token exists) before building the publisher. Update `publish.node.ts` to `await` it and update
  `publisher-resolver.test.ts`.

### 7.2 401 retry-once
In `publish.node.ts`, when a publish throws with `code === "token_expired"`, call
`refreshIfNeeded(…, { force: true })` and retry **once**. If it fails again, mark the account `expired`.

### 7.3 `LinkedInPublisher` fixes
- Header `LinkedIn-Version: env.LINKEDIN_API_VERSION` instead of the hard-coded `202504`.
- Escape the reserved characters of LinkedIn's "little text" format in `commentary`:
  `\ | { } @ [ ] ( ) < > # * _ ~` → prefix with `\`. Hashtags typed as `#tag` should stay hashtags, so either
  leave `#word` un-escaped or convert them to `{hashtag|\#|tag}`.
- Handle 401 the same way as §7.2. Treat 422 *duplicate* as non-retryable.
- `initializeUpload` responses can be an error JSON without `value`, so check `r.ok` before destructuring.

### 7.4 `config/container.ts`
Add the operator-default fallback for X: `if (p === "x" && env.X_ACCESS_TOKEN) return [p, new XPublisher(…)]`.
This is optional, because an X operator token expires in 2 hours and is a poor default. **Recommended:** keep
`StubPublisher` for X when no workspace connection exists, and log it clearly.

---

## 8. Token sweep (`worker.ts` → `sweepTokens()`)

Replace `checkAndMarkExpiredTokens()` with a provider-aware version:

```ts
for each workspace with connected accounts:
  for each account:
    provider = providerFor(account.platform)
    if (!provider.isConfigured()) continue              // never mark another platform's tokens
    if (account.tokenExpiresAt && account.tokenExpiresAt < now && !account.encryptedRefreshToken) → expired
    else if (account.platform === "x") → skip probe (tokens live 2 h; refresh-on-publish covers it)
    else ok = await provider.probe(decrypted); if (!ok) → expired
    if (linkedin && expiresIn < 7d) → emit social.token_expiring
```
Persist with positional `updateOne`, not `workspace.save()`. Keep the existing interval.

---

## 9. HTTP layer

### Routes (`http/routes/index.ts`)
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/v1/social/callback` | public | **Keep** for Meta (already registered) → `completeConnect("meta")` |
| GET | `/v1/social/:provider/callback` | public | `provider ∈ meta,x,linkedin`. Reject if `state.provider !== :provider` |
| POST | `/v1/workspaces/:id/social/:platform/connect` | org owner | enum adds `x`, `linkedin`. Body/query `target?: "member" \| "organization"` for LinkedIn |
| DELETE | `/v1/workspaces/:id/social/:platform` | org owner | enum adds `x`, `linkedin`. Calls `provider.revoke()` (best effort), then clears ciphertext |
| GET/POST | `/v1/workspaces/:id/social/linkedin/selection/:sid` | org owner | §5.1 |

Update `swagger-schemas.ts` with the new enums and descriptions.

### Controller (`social-oauth.controller.ts`)
- `connect`: map `platform` → provider (`instagram|facebook → meta`). Return `503 provider_not_configured` when
  credentials are missing (today it throws a generic `ProviderError`).
- `callback`: read `:provider`. Redirect URLs stay `?connected=<platforms>` / `?error=<msg>`, plus `?select=…`.
  **Don't put raw provider error text in the redirect.** Map it to a short code (`access_denied`,
  `state_expired`, `no_pages`, `not_configured`, `provider_error`) and log the details.
- `disconnect`: widen the type to `Platform`.

---

## 10. Web (`apps/web`)

- `settings/page.tsx`: `CONNECTABLE = new Set(["instagram","facebook","x","linkedin"])`. Drop the
  `as "instagram" | "facebook"` casts.
- LinkedIn button opens a small chooser: **Personal profile** / **Company Page**. Grey out "Company Page" with
  "Coming soon" when the API reports the Pages app isn't configured. Expose a `GET /v1/social/providers` →
  `{x:{configured:true}, linkedin:{member:true, organization:false}, meta:{…}}` for this.
- Handle `?select=linkedin&sid=…`: show a modal listing the Pages from the selection endpoint, then POST the choice.
- Show `expired` accounts with a **Reconnect** button. Show "Reconnect in N days" for LinkedIn when
  `tokenExpiresAt` is under 7 days away.
- Banner copy for the error codes from §9.
- Pre-connect tip: "Make sure you're logged in to the right X/LinkedIn account, or use a private window."
- `lib/api.ts`: widen the `connectSocialAccount` / `disconnectSocialAccount` platform type to `Platform`, and add
  an optional `target`, plus `getLinkedInSelection` / `submitLinkedInSelection` / `getSocialProviders`.
- Composer (`compose/page.tsx`): per-platform caption counter from `PLATFORM_SPECS.maxCaptionChars`. For X,
  warn when the caption contains a link (it costs more per post).

---

## 11. Tests (vitest, `apps/api/src/test/`)

Mock `fetch` the way the existing tests do. No real network calls.

| Test | Cases |
|---|---|
| `oauth-state` | sign/verify round-trip. Tampered signature rejected. Expired rejected. `provider` mismatch rejected. Nonce single-use (second callback with same state fails) |
| `pkce` | challenge = base64url(sha256(verifier)), verifier length 43-128 |
| `x-oauth.test.ts` | authorize URL has S256 + all scopes. Code exchange sends Basic auth + verifier. `users/me` mapped to `@handle`. Tokens stored **encrypted** (ciphertext ≠ plaintext). Re-connect replaces the row |
| `x refresh` | rotation persists the new refresh token. Two concurrent `refreshIfNeeded` calls produce **one** HTTP refresh (lock). `invalid_grant` → expired + ciphertext cleared |
| `x-publisher.test.ts` | upload → tweet body has `media_ids`. Caption truncated to valid length. 403 duplicate → non-retryable. 429 → retryable |
| `linkedin-oauth.test.ts` | member: `userinfo.sub` → `urn:li:person:<sub>`. org: one ACL auto-selects, more than one gives a `PendingSelection`. Selection endpoint rejects a different workspace's `sid`. Refresh only when a refresh token exists |
| `linkedin publisher` | uses `env.LINKEDIN_API_VERSION`. Reserved characters escaped |
| `token-sweep.test.ts` | **regression:** X/LinkedIn accounts are **not** sent to Meta `debug_token`. LinkedIn past expiry → expired. Unconfigured provider → untouched |
| `publisher-resolver.test.ts` | `x` case. Async refresh path. Connected `externalAccountId` overrides `target.accountId` |
| `two-org-isolation.test.ts` | extend: org B cannot connect, disconnect or read the selection for org A's workspace on `x`/`linkedin` |

---

## 12. Order of work (each phase is one PR)

| Phase | Scope | Depends on manual steps |
|---|---|---|
| **0. Hardening** | Sweep platform filter (bug), `API_PUBLIC_URL`, `LINKEDIN_API_VERSION` env, LinkedIn escaping + `r.ok` checks, non-retryable error type | none |
| **1. Provider refactor** | `social/` folder, `OAuthProvider`, move Meta into `meta.provider.ts` with **no behaviour change**, `oauth-state` with provider + nonce consumption, Redis client, generic routes (+ legacy Meta callback). All existing tests green | none |
| **2. Schema + DTO** | refresh-token fields, `accountType`, DTO additions, include expired accounts | none |
| **3. X** | `x.provider.ts`, `token-lock.ts`, `refreshIfNeeded`, `x.publisher.ts`, async resolver, 401 retry-once, tests | X app + billing + client id/secret |
| **4. LinkedIn member** | `linkedin.provider.ts` (member), publisher uses connected URN, sweep expiry + 7-day warning, tests | LinkedIn app with OIDC + Share products |
| **5. Web** | Settings buttons, chooser, reconnect, composer counters, `/v1/social/providers` | Phases 3-4 |
| **6. LinkedIn Pages** | org target, selection flow, second client, refresh support | Community Management API approval (Development tier is enough to build) |

## 13. Definition of done
- [ ] A user can connect, publish to and disconnect each of X, LinkedIn (member) and, once approved, a LinkedIn Page from Settings.
- [ ] Tokens (access **and** refresh) are only ever stored encrypted, and no endpoint or log line returns them.
- [ ] X stays connected past 2 hours (refresh works), and parallel publishes do not break it.
- [ ] Revoking the app on the platform leads to the `expired` state and a **Reconnect** button, never a silent failure.
- [ ] The daily sweep never marks a non-Meta account expired through Meta.
- [ ] Caption limits are enforced per platform. Duplicate, credit and rate-limit errors give clear messages and no retry storms.
- [ ] Swagger, `.env.example` and the README are updated. All vitest suites pass.
