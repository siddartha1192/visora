import type {
  AdminApiKeyDTO,
  ApiResponse,
  OrgRole,
  PlatformRole,
  PostDTO,
  WorkspaceRole,
} from "@visora/shared";
import { refreshSession, setLogoutReason } from "./api";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/v1";

const TOKEN_KEY = "visora_admin_token";

export function getAdminToken() {
  if (typeof window === "undefined") return null;
  // Fall back to the regular user token — same JWT works for admin routes.
  // This covers admins who log in via /login instead of /admin/login.
  return localStorage.getItem(TOKEN_KEY) ?? localStorage.getItem("visora_token");
}
export function setAdminToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function doFetch(path: string, init: RequestInit, token: string | null) {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${BASE}${path}`, { ...init, headers });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // See the matching comment in lib/api.ts's request() — distinguishes a real
  // expiry from a visitor who never had admin credentials in the first place.
  const hadCredentials = getAdminToken() !== null;

  let res = await doFetch(path, init, getAdminToken());

  // Access token expired — silently refresh and retry once before logging out,
  // same as the regular user client.
  if (res.status === 401) {
    const newToken = await refreshSession();
    if (newToken) {
      setAdminToken(newToken);
      res = await doFetch(path, init, newToken);
    }
  }

  // Admin token expired or revoked — clear all auth and redirect to admin login.
  if (res.status === 401) {
    setAdminToken(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem("visora_token");
      if (hadCredentials) setLogoutReason("expired");
      window.location.replace("/admin/login");
    }
  }

  const json = (await res.json()) as ApiResponse<T>;
  if (!json.ok) throw new Error(json.error.message);
  return json.data;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  status: "active" | "invited" | "suspended";
  organizationId: string | null;
  /** "owner" marks the tenant's root user. */
  orgRole: OrgRole | null;
  /** Non-null only for SaaS operator staff. */
  platformRole: PlatformRole | null;
  workspaces: Array<{ workspaceId: string; role: WorkspaceRole }>;
  workspaceCount: number;
  lastLoginAt: string | null;
  createdAt: string;
}

/** The admin console's view of the caller. */
export interface AdminMe {
  id: string;
  name: string;
  email: string;
  orgRole: OrgRole | null;
  platformRole: PlatformRole | null;
  organization: { id: string; name: string; slug: string } | null;
}

export interface LlmConfig {
  id: string;
  label: string;
  provider: "openai" | "anthropic" | "google";
  apiKeyMasked: string;
  chatModel: string | null;
  imageModel: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface LlmRef {
  id: string;
  label: string;
  provider: string;
}

export interface AnalyticsData {
  range: string;
  overview: {
    totalPosts: number;
    publishedPosts: number;
    failedPosts: number;
    pendingReviewPosts: number;
    cancelledPosts: number;
    rejectedPosts: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCostUsd: number;
    totalImagesGenerated: number;
  };
  byStatus: Array<{ status: string; count: number }>;
  byWorkflow: Array<{ workflow: string; count: number }>;
  byModel: Array<{
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    imagesGenerated: number;
    requests: number;
  }>;
  byUser: Array<{
    userId: string;
    name: string;
    email: string;
    totalPosts: number;
    byStatus: Record<string, number>;
    byWorkflow: Record<string, number>;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    imagesGenerated: number;
  }>;
}

export interface NodeConfig {
  assignments: {
    planner: LlmRef | null;
    caption: LlmRef | null;
    generation: LlmRef | null;
    enhancement: LlmRef | null;
  };
}

export interface AdminPost {
  id: string;
  workspaceId: string;
  ownerEmail: string;
  ownerName: string;
  workflow: string;
  status: string;
  brief?: string;
  prompt?: string;
  instructions?: string;
  sourceUrl?: string;
  platforms: string[];
  primaryAssetId?: string;
  /** Pre-signed thumbnail, resolved server-side — see listAllPosts. */
  imageUrl?: string;
  lastError?: string;
  cancelledAt?: string;
  createdAt: string;
}

export interface AdminPostsPage {
  items: AdminPost[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DbCollection {
  name: string;
  count: number;
}

export interface DbDocsPage {
  items: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

// ── API client ────────────────────────────────────────────────────────────────

export const adminApi = {
  // Auth (re-uses main auth endpoint, stores token separately)
  login: (email: string, password: string) =>
    request<{ tokens: { accessToken: string; refreshToken: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  // Admin identity
  me: () => request<AdminMe>("/admin/me"),

  // Posts
  listPosts: (params?: { page?: number; pageSize?: number; status?: string; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.page)     qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
    if (params?.status)   qs.set("status", params.status);
    if (params?.q)        qs.set("q", params.q);
    return request<AdminPostsPage>(`/admin/posts?${qs}`);
  },
  /** Cross-workspace cancel — stops a post without destroying its record. */
  cancelPost: (id: string) =>
    request<PostDTO>(`/admin/posts/${id}/cancel`, { method: "POST" }),
  deletePost: (id: string) =>
    request<{ deleted: string }>(`/admin/posts/${id}`, { method: "DELETE" }),

  // Users
  listUsers: () => request<AdminUser[]>("/admin/users"),
  /** Provisions a user into one of your organization's workspaces. */
  createUser: (data: {
    name: string;
    email: string;
    password: string;
    workspaceId: string;
    workspaceRole?: WorkspaceRole;
  }) => request<AdminUser>("/admin/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (
    id: string,
    patch: Partial<{ status: string; workspaceRole: WorkspaceRole }>,
  ) => request<AdminUser>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteUser: (id: string) =>
    request<{ deleted: string }>(`/admin/users/${id}`, { method: "DELETE" }),

  // LLM Configs
  listLlmConfigs: () => request<LlmConfig[]>("/admin/llm-configs"),
  createLlmConfig: (data: {
    label: string; provider: string; apiKey: string;
    chatModel?: string; imageModel?: string;
  }) => request<LlmConfig>("/admin/llm-configs", { method: "POST", body: JSON.stringify(data) }),
  updateLlmConfig: (id: string, patch: Partial<{
    label: string; provider: string; apiKey: string;
    chatModel: string; imageModel: string; isActive: boolean;
  }>) => request<LlmConfig>(`/admin/llm-configs/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteLlmConfig: (id: string) =>
    request<{ deleted: string }>(`/admin/llm-configs/${id}`, { method: "DELETE" }),

  // Analytics
  getAnalytics: (range: "7d" | "30d" | "90d" | "all" = "30d") =>
    request<AnalyticsData>(`/admin/analytics?range=${range}`),

  // Node config
  getNodeConfig: () => request<NodeConfig>("/admin/node-config"),
  updateNodeConfig: (assignments: Partial<Record<string, string | null>>) =>
    request<NodeConfig>("/admin/node-config", {
      method: "PUT",
      body: JSON.stringify({ assignments }),
    }),

  // Database explorer (read-only)
  listDbCollections: () => request<DbCollection[]>("/admin/database/collections"),
  listDbDocs: (collection: string, page = 1, pageSize = 20) =>
    request<DbDocsPage>(
      `/admin/database/collections/${collection}/docs?page=${page}&pageSize=${pageSize}`,
    ),

  // API keys — cross-workspace oversight only. Every user self-services their
  // own workspace's keys via api.ts; this is the admin/root audit view across
  // every workspace, with the ability to kill a key that isn't theirs.
  listAllApiKeys: () => request<AdminApiKeyDTO[]>("/admin/api-keys"),
  revokeApiKeyAdmin: (keyId: string) =>
    request<AdminApiKeyDTO>(`/admin/api-keys/${keyId}`, { method: "DELETE" }),
};
