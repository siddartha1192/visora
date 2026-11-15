# Steps for X (Twitter) and LinkedIn Integration

Companion to *Visora_SM_Integration_Steps.pdf* (Facebook + Instagram). Same structure, same goal: a
"Connect X" / "Connect LinkedIn" button that takes a user from click to connected in under a minute.

> Researched November 2026. Both platforms change prices, scopes and API versions often. Check
> docs.x.com and learn.microsoft.com/linkedin before you submit anything.

---

## At a glance: how the two compare with Meta

| | Meta (FB/IG) | X (Twitter) | LinkedIn |
|---|---|---|---|
| Developer portal | developers.facebook.com | console.x.com (developer.x.com) | linkedin.com/developers |
| Formal app review | Yes, per permission, with screencast | **No review**, but you pay per call | **Personal posting: none.** Company Pages: access form, screencast, then Standard-tier review |
| Business verification | Required | No | App must be linked to and verified by a LinkedIn Company Page |
| Cost | Free | **Paid.** Pay-per-use since Feb 2026, about $0.015 per post and about $0.20 per post with a link (third-party figures) | Free |
| Access token life | Short-lived, then about 60 days | **2 hours** | 60 days |
| Refresh | Exchange for a long-lived token | Refresh token (`offline.access`), **rotates on every use** | Refresh token (365 days) **only for approved Community Management partners**. Everyone else reconnects every 60 days |
| Deauthorize/deletion webhook | Yes (required) | None. You find out from a 401 | None. You find out from a 401 |
| Personal profiles | FB: Pages only | Yes (the user's own account) | Yes (member) and Company Pages |
| Realistic time to go live | Weeks | **Days**, once billing is set up | Personal: same day. Company Pages: weeks |

---

## X (Twitter)

### 1. Set up the X developer app
- Sign in at **console.x.com** (the developer portal) with the X account that will own the app. Accept the
  Developer Agreement and describe your use case ("users schedule and publish their own image posts").
- Create a **Project**, then an **App** inside it. Note the app's **Client ID** and **Client Secret** (OAuth 2.0).
- **Billing:** new developers are on **pay-per-use** (the free tier closed to new sign-ups in Feb 2026). Add a
  payment method and buy credits. With no balance, every post fails. Set a spending cap.

### 2. Configure user authentication (this is where "click to connect" is decided)
App → **User authentication settings → Set up**:
- **App permissions:** *Read and write*. Without this you get a token that cannot post.
- **Type of app:** *Web App, Automated App or Bot*. This makes it a **confidential client**, so you get a Client Secret.
- **Callback URI / Redirect URL:** `https://api.yourdomain.com/v1/social/x/callback`. It must match exactly. You can
  add `http://localhost:4000/v1/social/x/callback` for development (X allows localhost; Meta does not).
- **Website URL**, **Terms of Service URL**, **Privacy Policy URL**: reuse the pages from the Meta annexure. Add a
  line naming X as a connected platform.
- Optional: upload the app icon (it shows on the consent screen) and set the app name users will see.

### 3. Scopes to request
Request only these (OAuth 2.0 with PKCE):

| Scope | Why |
|---|---|
| `tweet.read` | Required alongside `tweet.write` |
| `tweet.write` | Create posts |
| `users.read` | Read `@handle` and user id for the "Connected as …" label |
| `media.write` | Upload images through the v2 media endpoint |
| `offline.access` | Get a **refresh token**. Without it, the connection dies after 2 hours |

There is no Meta-style review: once the app has Read and write, any X user can authorize it straight away.
What you agree to instead are X's **automation rules** and **developer policy**. The ones that matter for
Visora: no duplicate or near-duplicate posts across accounts, no posting without the user's intent, and
respect for rate limits.

### 4. Build the connection flow
1. **Start:** `GET /v1/social/x/connect`. Generate a PKCE `code_verifier` (43–128 random characters) and
   `code_challenge = BASE64URL(SHA256(verifier))`. Put `{workspaceId, platform:"x", nonce, exp}` in signed
   `state`, the same way `signState()` already does for Meta. Keep the verifier server-side (Redis, keyed by
   nonce, 10-minute TTL) or encrypted inside the state.
2. **Redirect** the browser to:
   ```
   https://x.com/i/oauth2/authorize?response_type=code&client_id=…&redirect_uri=…
     &scope=tweet.read%20tweet.write%20users.read%20media.write%20offline.access
     &state=…&code_challenge=…&code_challenge_method=S256
   ```
3. **Callback:** verify `state`, then `POST https://api.x.com/2/oauth2/token` with
   `Authorization: Basic base64(client_id:client_secret)` and the form body
   `grant_type=authorization_code, code, redirect_uri, code_verifier`.
   The response has `access_token` (expires in 7200 s), `refresh_token` and `scope`.
4. **Identify the account:** `GET https://api.x.com/2/users/me`, which returns `id` and `username`. Store
   `externalAccountId = id` and `handle = @username`.
5. **Store** the encrypted access token, the **encrypted refresh token** and `tokenExpiresAt = now + 2h`.
6. **Refresh:** before each publish (or when fewer than 5 minutes are left), call `POST /2/oauth2/token` with
   `grant_type=refresh_token`. **Refresh tokens are single-use and rotate.** Save the new refresh token in the
   same DB write as the new access token, and serialize refreshes per account (a lock in Redis). If two workers
   refresh at once, one of them burns the token and the user has to reconnect.
7. **Disconnect:** `POST https://api.x.com/2/oauth2/revoke` with the token, then clear the ciphertext (the same
   pattern as the existing `disconnect()`).
8. **Revoked access:** X sends no webhook. A refresh that fails with `invalid_grant`, or a 401 on publish, means
   the user revoked access (x.com → Settings → Security → Connected apps). Mark the account `expired` and
   show **Reconnect**.

### 5. Make onboarding feel fast
- Warn users to check **which X account the browser is logged into** (the "private window" tip from the Meta
  doc applies here too). X's consent screen shows the handle, so point it out.
- Locked/protected accounts can connect, but their posts are not public. Show a note.
- Show the character limit in the composer: **280** for standard accounts. Premium accounts can post longer,
  but stay on 280 unless you detect Premium.
- Since links cost much more per post, consider moving URLs out of the X caption, or tell the workspace owner
  what it costs.

### 6. Build the publishing pipeline
1. **Upload media:** use the **v2** endpoint `POST https://api.x.com/2/media/upload` (the v1.1 upload is being
   retired). Small images can go up in a single request. Large files and GIFs use the chunked
   `INIT → APPEND → FINALIZE` commands, then poll `STATUS` until `processing_info.state = succeeded`.
   You get back a `media_id`. Images: JPG/PNG/WEBP up to 5 MB, up to 4 per post.
2. **Optional alt text:** `POST /2/media/metadata` with `alt_text`, which is good for accessibility.
3. **Create the post:** `POST https://api.x.com/2/tweets` with
   `{"text": caption, "media": {"media_ids": ["<id>"]}}`. The response's `data.id` gives the permalink
   `https://x.com/<username>/status/<id>`.
4. **Errors to handle:** 403 *duplicate content* (do not retry; tell the user), 429 *rate limit* (back off using
   `x-rate-limit-reset`), 402/403 *credits exhausted* (alert the operator, not the end user), and 401 (refresh,
   and if that fails, mark expired).

### 7. X timeline
- **Day 1:** create the app, set up billing and auth settings. It works with any real user straight away.
- **No approval wait.** The real gating is cost and staying within the automation rules.

---

## LinkedIn

### 1. Set up the LinkedIn developer app
- Go to **linkedin.com/developers → Create app**. You must pick a **LinkedIn Company Page** to associate it with
  (create a Visora Company Page first if you have none). Upload a logo and accept the API Terms.
- **Verify the app:** Settings tab → *Verify*. This produces a link that a **Page admin** must open and approve.
  Several products cannot be requested until this is done.
- Note the **Client ID** and **Client Secret** (Auth tab).

### 2. Add products: decide personal profile vs Company Page
LinkedIn grants scopes through **Products** (Products tab):

| Product | Scopes it unlocks | Access |
|---|---|---|
| **Sign In with LinkedIn using OpenID Connect** | `openid`, `profile`, `email` | Self-serve, instant |
| **Share on LinkedIn** | `w_member_social` (post as the member) | Self-serve, instant |
| **Community Management API** | `w_organization_social`, `r_organization_social`, `rw_organization_admin` (post as and list Company Pages), plus refresh tokens | **Gated.** Access request form, registered legal entity, business email. Starts at *Development tier* and must be upgraded to *Standard tier* through review |

**Recommendation for Visora:** launch with **personal profile posting** first (the first two products,
live the same day), and apply for the Community Management API in parallel for Company Page posting.

Notes on the Community Management API (check the current docs before applying):
- LinkedIn requires it on its **own app**, with no other products. Plan for **two LinkedIn apps**: "Visora"
  (OIDC + Share) and "Visora Pages" (Community Management). The code needs to pick a client per flow.
- **Development tier:** limited call volume (about 500 calls per app per day). Use it to build and record the
  screencast. LinkedIn expects you to finish within 12 months.
- **Standard tier review:** an access form describing the use case, a **screencast** of a real user connecting
  a Page and publishing, and sometimes a live technical sign-off call. As with Meta, show every requested
  scope being used on screen.

### 3. Configure the app
Auth tab:
- **Authorized redirect URLs:** `https://api.yourdomain.com/v1/social/linkedin/callback` (localhost is allowed for
  development). It must match exactly, including the trailing slash.
- Settings tab: **Privacy policy URL** (required), app logo, and the Company Page association from step 1.
- Reuse the Privacy, Terms and Data deletion pages from the Meta annexure, and add LinkedIn to the list of
  platforms and stored data.

### 4. Build the connection flow
1. **Start:** `GET /v1/social/linkedin/connect?target=member|organization`. Signed `state` carries
   `{workspaceId, platform:"linkedin", target, nonce, exp}`.
2. **Redirect** to:
   ```
   https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=…
     &redirect_uri=…&state=…&scope=openid%20profile%20w_member_social
   ```
   For Pages, use `scope=w_organization_social%20r_organization_social%20rw_organization_admin` with the
   Pages app's client id.
3. **Callback:** `POST https://www.linkedin.com/oauth/v2/accessToken` (form body: `grant_type=authorization_code,
   code, redirect_uri, client_id, client_secret`). This returns `access_token` (`expires_in` about 60 days) and,
   for approved Community Management apps only, `refresh_token` (`refresh_token_expires_in` about 365 days).
4. **Identify the account:**
   - Member: `GET https://api.linkedin.com/v2/userinfo` returns `sub`. Store
     `externalAccountId = urn:li:person:<sub>` and `handle = name`.
   - Organization: `GET https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`
     returns the organization URNs the user administers. Fetch names with `GET /rest/organizations/{id}`.
     **Let the user pick the Page.** Do not auto-pick the first one, which is the simplification the Meta
     flow currently makes.
5. **Store** the encrypted token, `tokenExpiresAt`, and the encrypted refresh token if there is one.
6. **Refresh / expiry:**
   - With a refresh token: `grant_type=refresh_token` before expiry. The refresh token keeps its original 365-day expiry.
   - Without one (member flow): no silent renewal. Email or alert the user **7 days before** the 60-day expiry
     with a one-click **Reconnect**. LinkedIn skips the consent screen if the user is still logged in and
     already approved the app, so reconnecting is a single click.
7. **Revoked access:** no webhook. A 401 with `REVOKED_ACCESS_TOKEN` or `EXPIRED_ACCESS_TOKEN` means you should
   mark the account `expired` and show **Reconnect**. Users revoke under LinkedIn Settings → Data privacy →
   Permitted services.

### 5. Make onboarding feel fast
- Ask up front: **"Post as yourself or as a Company Page?"** Each choice needs different scopes (and different apps).
- For Pages: the user must be a **Super admin or Content admin** of the Page. Show a "Check my access" message
  when `organizationAcls` comes back empty.
- The "logged into the wrong account" warning applies here as well.

### 6. Build the publishing pipeline
Already implemented in `apps/api/src/integrations/publishers/linkedin.publisher.ts`:
`POST /rest/images?action=initializeUpload` → `PUT` the bytes → `POST /rest/posts`. Items to fix:
- **`LinkedIn-Version: 202504` is too old.** LinkedIn supports each monthly version for about 12 months, so
  202504 is past or near sunset by Nov 2026. Move it to a current version (for example `202610`), keep it in
  config, and bump it every quarter.
- Images: JPG/PNG/GIF, keep under 36 M pixels. Commentary is limited to 3,000 characters. Escape LinkedIn's
  "little text" reserved characters (`( ) [ ] { } @ # * _ ~ < > | \`) in `commentary`, or posts fail or render wrongly.
- Handle 429 (daily per-member and per-app throttles) and 422 *duplicate post*.

### 7. LinkedIn timeline
- **Day 1:** personal profile posting is live for every user (OIDC + Share on LinkedIn).
- **Weeks:** Community Management API access form, Development tier build, screencast, Standard tier
  approval, then Company Page posting for everyone.

---

## Annexure A: Visora codebase changes needed

What I found in the current code, and what the two new platforms need:

1. **`social-oauth.service.ts` is Meta-only.** The single `/v1/social/callback` route and a `state` without a
   platform field cannot route X or LinkedIn callbacks. Refactor into a per-platform `OAuthProvider` interface
   (`buildAuthUrl`, `exchangeCode`, `identify`, `refresh`, `revoke`) with `meta`, `x` and `linkedin`
   implementations, and routes `/v1/social/:platform/connect|callback`. Add `platform` to `StatePayload`.
2. **Bug once a second platform exists:** `checkAndMarkExpiredTokens()` sends **every** connected account's token
   to Meta's `debug_token`. X and LinkedIn tokens would be reported invalid and marked `expired`. Filter by
   `platform in ['facebook','instagram']` now, and add per-platform checks (expiry date for LinkedIn, refresh
   for X).
3. **`disconnect()`** is typed to `"instagram" | "facebook"`. Widen it to `Platform` and call each provider's revoke.
4. **Workspace `socialAccounts` schema:** add `encryptedRefreshToken`, `refreshTokenExpiresAt`, and for LinkedIn
   `accountType: "person" | "organization"`. Encrypt the refresh token with `encryptSecret`, the same as the access token.
5. **New `x.publisher.ts`** implementing `Publisher` (media upload v2 → `/2/tweets`), registered in
   `config/container.ts` and `publisher-resolver.ts`, with a stub fallback like the others.
6. **Token refresh before publish** in the worker for X (always) and LinkedIn (when a refresh token exists), with a
   per-account Redis lock.
7. **Env vars** (`config/env.ts`): `X_CLIENT_ID`, `X_CLIENT_SECRET`, `LINKEDIN_CLIENT_ID`,
   `LINKEDIN_CLIENT_SECRET`, optional `LINKEDIN_PAGES_CLIENT_ID` / `LINKEDIN_PAGES_CLIENT_SECRET`,
   `LINKEDIN_API_VERSION`. Keep the existing `*_ACCESS_TOKEN` as the operator-default fallback.
8. **Redirect URI helper:** `redirectUri()` swaps in `localhost:4000` whenever `WEB_ORIGIN` contains
   "localhost". Replace it with an explicit `API_PUBLIC_URL` env var so the exact registered URL is used on
   every platform. Both X and LinkedIn reject any mismatch.

## Annexure B: URLs and details to prepare (reuse what you built for Meta)

| Item | X | LinkedIn |
|---|---|---|
| Privacy policy URL | Required (auth settings) | Required (app settings) |
| Terms of service URL | Required | Recommended |
| Website URL | Required | Company Page association instead |
| Callback/redirect | `/v1/social/x/callback` | `/v1/social/linkedin/callback` |
| Data deletion | No callback field, but GDPR still applies. Delete tokens on disconnect and keep the deletion-instructions page | Same |
| App icon | Optional, shown on consent | Required logo |
| Verification | Payment method / billing | Company Page admin verifies the app |
| Review material | None | Screencast + use-case form (Community Management only) |

## Annexure C: faster launch option
As the Meta doc says, a unified posting API (Ayrshare and others) has already been through LinkedIn's
Community Management review and pays X's API costs, for a per-user fee. That is worth considering for
**LinkedIn Company Pages** while your own review is pending. For X it mainly moves the cost elsewhere, since
there is no review to skip.
