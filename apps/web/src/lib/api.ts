import type {
  ApiKeyDTO,
  ApiResponse,
  AssetDTO,
  CreatedApiKeyDTO,
  CreatePostInput,
  MeDTO,
  Paginated,
  PostDTO,
  WorkspaceDTO,
} from "@visora/shared";

export interface LogEntry {
  id: string;
  sequence: number;
  node: string;
  status: "started" | "succeeded" | "failed" | "skipped";
  message: string;
  data: Record<string, unknown> | null;
  durationMs: number | null;
  provider: string | null;
  model: string | null;
  error: string | null;
  createdAt: string;
}

export interface LogsResponse {
  postId: string;
  done: boolean;
  logs: LogEntry[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    /**
     * The envelope's `error.details`. For VALIDATION_ERROR this is a Zod
     * `flatten()` — `{ formErrors, fieldErrors }` — which names the exact
     * fields that failed. Without it a caller can only show the generic
     * "Validation failed" message.
     */
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/v1";

const USER_TOKEN_KEY = "visora_token";
const ADMIN_TOKEN_KEY = "visora_admin_token";
const REFRESH_TOKEN_KEY = "visora_refresh_token";

/** Token storage is intentionally simple here; swap for httpOnly cookies/BFF. */
let accessToken: string | null =
  typeof window !== "undefined" ? localStorage.getItem(USER_TOKEN_KEY) : null;

export function setToken(token: string | null) {
  accessToken = token;
  if (typeof window !== "undefined") {
    if (token) localStorage.setItem(USER_TOKEN_KEY, token);
    else localStorage.removeItem(USER_TOKEN_KEY);
  }
}

export function setRefreshToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(REFRESH_TOKEN_KEY, token);
  else localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

/** Wipes ALL session state — user token, admin token, refresh token, in-memory token. */
export function clearAuth() {
  accessToken = null;
  if (typeof window !== "undefined") {
    localStorage.removeItem(USER_TOKEN_KEY);
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }
}

const LOGOUT_REASON_KEY = "visora_logout_reason";

/**
 * One-shot "why was I logged out" flag, read once by the login page. Deliberately
 * NOT a `?reason=` URL param — browsers happily resurrect that exact URL via
 * autocomplete or history days later, re-showing a stale banner on a visit that
 * has nothing to do with the original logout.
 */
export function setLogoutReason(reason: "idle" | "expired") {
  if (typeof window !== "undefined") sessionStorage.setItem(LOGOUT_REASON_KEY, reason);
}

/**
 * Read is intentionally pure (no side effect) — safe to call from a useState
 * initializer, which React may invoke more than once (Strict Mode double-
 * invokes initializers in dev to catch impure ones). Pair with
 * clearLogoutReason() in a useEffect to consume it exactly once.
 */
export function peekLogoutReason(): "idle" | "expired" | null {
  if (typeof window === "undefined") return null;
  const v = sessionStorage.getItem(LOGOUT_REASON_KEY);
  return v === "idle" || v === "expired" ? v : null;
}

/** Idempotent — safe to call even if an effect fires more than once. */
export function clearLogoutReason() {
  if (typeof window !== "undefined") sessionStorage.removeItem(LOGOUT_REASON_KEY);
}

// Coalesces concurrent refresh attempts (e.g. several requests 401'ing at once)
// into a single in-flight call to POST /auth/refresh.
let refreshInFlight: Promise<string | null> | null = null;

/**
 * Exchanges the stored refresh token for a new access token. Used both as a
 * 401 recovery path below and proactively by the idle-logout hook so an
 * active user's session never lapses just because the 15-minute access
 * token TTL elapsed.
 */
export function refreshSession(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  const rt = getRefreshToken();
  if (!rt) return Promise.resolve(null);

  refreshInFlight = fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: rt }),
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const json = (await res.json()) as ApiResponse<{ accessToken: string }>;
      if (!json.ok) return null;
      setToken(json.data.accessToken);
      return json.data.accessToken;
    })
    .catch(() => null)
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

async function doFetch(path: string, init: RequestInit, token: string | null) {
  const headers = new Headers(init.headers);
  // Only advertise JSON when there is actually a JSON body — an empty Content-Type:
  // application/json with no body causes Fastify to reject the request with 400.
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${BASE}${path}`, { ...init, headers });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Captured before the call: distinguishes "had credentials that turned out
  // to be invalid" (a real session expiry) from "never had any" (e.g. a
  // fresh visitor whose useQuery fired before the auth-guard redirect ran) —
  // the latter should never show a "your session expired" message.
  const hadCredentials = accessToken !== null || getRefreshToken() !== null;

  let res = await doFetch(path, init, accessToken);

  // Access token expired — silently exchange the refresh token and retry once
  // before treating this as a real logout. Keeps active users signed in past
  // the 15-minute access-token TTL.
  if (res.status === 401) {
    const newToken = await refreshSession();
    if (newToken) res = await doFetch(path, init, newToken);
  }

  // Still unauthorized (no/invalid refresh token) — wipe everything and send
  // the user back to login.
  if (res.status === 401) {
    clearAuth();
    if (typeof window !== "undefined") {
      if (hadCredentials) setLogoutReason("expired");
      window.location.replace("/login");
    }
  }

  const json = (await res.json()) as ApiResponse<T>;
  if (!json.ok) {
    const e = json.error as Record<string, unknown>;
    throw new ApiError(json.error.message, e.code as string | undefined, e.details);
  }
  return json.data;
}

/**
 * Identity + tenancy, resolved server-side. `platformRole` gates operator-only
 * screens; `orgRole === "owner"` marks the tenant's root user; `workspaces` is
 * already filtered to what the caller can actually reach.
 */
export type UserProfile = MeDTO;

export const api = {
  getMe: () => request<UserProfile>("/auth/me"),
  login: (email: string, password: string) =>
    request<{ tokens: { accessToken: string; refreshToken: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  // NOTE: register() was removed — accounts are provisioned by an organization
  // admin, or by platform staff when a new tenant subscribes.
  createPost: (input: CreatePostInput) =>
    request<PostDTO>("/posts", { method: "POST", body: JSON.stringify(input) }),
  listPosts: (page = 1) =>
    request<Paginated<PostDTO>>(`/posts?page=${page}`),
  getPost: (id: string) => request<PostDTO>(`/posts/${id}`),
  listAssets: (params?: { kind?: string; page?: number }) => {
    const qs = new URLSearchParams();
    if (params?.kind) qs.set("kind", params.kind);
    if (params?.page) qs.set("page", String(params.page));
    return request<Paginated<AssetDTO>>(`/assets?${qs}`);
  },
  getAsset: (id: string) => request<AssetDTO>(`/assets/${id}`),
  cancelPost: (id: string) =>
    request<PostDTO>(`/posts/${id}/cancel`, { method: "POST" }),
  approvePost: (
    id: string,
    opts?: { scheduledAt?: string; scheduleMode?: "instant" | "scheduled" },
  ) =>
    request<PostDTO>(`/posts/${id}/approve`, {
      method: "POST",
      body: JSON.stringify(opts ?? {}),
    }),
  rejectPost: (id: string) =>
    request<PostDTO>(`/posts/${id}/reject`, { method: "POST" }),
  retryPost: (id: string, mode: "from_failed" | "full") =>
    request<PostDTO>(`/posts/${id}/retry`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    }),
  adminDeletePost: (id: string) =>
    request<{ deleted: string }>(`/admin/posts/${id}`, { method: "DELETE" }),
  uploadAsset: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<AssetDTO>("/assets", { method: "POST", body: fd });
  },
  getLogs: (postId: string) =>
    request<LogsResponse>(`/posts/${postId}/logs`),
  refinePrompt: (prompt: string) =>
    request<{ refined: string }>("/prompts/refine", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),

  // Workspaces (brands/products in your organization)
  listWorkspaces: () => request<WorkspaceDTO[]>("/workspaces"),
  createWorkspace: (name: string) =>
    request<WorkspaceDTO>("/workspaces", { method: "POST", body: JSON.stringify({ name }) }),
  renameWorkspace: (id: string, name: string) =>
    request<WorkspaceDTO>(`/workspaces/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  archiveWorkspace: (id: string) =>
    request<WorkspaceDTO>(`/workspaces/${id}`, { method: "DELETE" }),
  /** Returns a new access token bound to the target workspace. */
  switchWorkspace: (workspaceId: string) =>
    request<{ accessToken: string; workspaceId: string }>("/workspaces/switch", {
      method: "POST",
      body: JSON.stringify({ workspaceId }),
    }),

  // API keys (machine-to-machine) — self-service, scoped to your own workspace
  listApiKeys: () => request<ApiKeyDTO[]>("/api-keys"),
  createApiKey: (label: string, expiresInDays: 30 | 90 | 365 | null) =>
    request<CreatedApiKeyDTO>("/api-keys", {
      method: "POST",
      body: JSON.stringify({ label, expiresInDays }),
    }),
  revokeApiKey: (keyId: string) =>
    request<ApiKeyDTO>(`/api-keys/${keyId}`, { method: "DELETE" }),
};
