import type { ApiResponse, UserRole } from "@visora/shared";

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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const token = getAdminToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${BASE}${path}`, { ...init, headers });

  // Admin token expired or revoked — clear all auth and redirect to admin login.
  if (res.status === 401) {
    setAdminToken(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem("visora_token");
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
  role: UserRole;
  workspaceCount: number;
  lastLoginAt: string | null;
  createdAt: string;
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
  platforms: string[];
  primaryAssetId?: string;
  lastError?: string;
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
    request<{ tokens: { accessToken: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  // Admin identity
  me: () => request<{ id: string; name: string; email: string; role: UserRole }>("/admin/me"),

  // Posts
  listPosts: (params?: { page?: number; pageSize?: number; status?: string; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.page)     qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
    if (params?.status)   qs.set("status", params.status);
    if (params?.q)        qs.set("q", params.q);
    return request<AdminPostsPage>(`/admin/posts?${qs}`);
  },
  deletePost: (id: string) =>
    request<{ deleted: string }>(`/admin/posts/${id}`, { method: "DELETE" }),

  // Users
  listUsers: () => request<AdminUser[]>("/admin/users"),
  createUser: (data: { name: string; email: string; password: string; role?: "user" | "admin" }) =>
    request<AdminUser>("/admin/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id: string, patch: Partial<{ status: string; role: "user" | "admin" }>) =>
    request<AdminUser>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
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
};
