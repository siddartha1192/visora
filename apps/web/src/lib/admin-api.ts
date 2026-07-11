import type { ApiResponse } from "@visora/shared";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/v1";

const TOKEN_KEY = "visora_admin_token";

export function getAdminToken() {
  return typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
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
  isAdmin: boolean;
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

export interface NodeConfig {
  assignments: {
    planner: LlmRef | null;
    caption: LlmRef | null;
    generation: LlmRef | null;
    enhancement: LlmRef | null;
  };
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
  me: () => request<{ id: string; name: string; email: string; isAdmin: boolean }>("/admin/me"),

  // Users
  listUsers: () => request<AdminUser[]>("/admin/users"),
  createUser: (data: { name: string; email: string; password: string; isAdmin?: boolean }) =>
    request<AdminUser>("/admin/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id: string, patch: Partial<{ status: string; isAdmin: boolean }>) =>
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

  // Node config
  getNodeConfig: () => request<NodeConfig>("/admin/node-config"),
  updateNodeConfig: (assignments: Partial<Record<string, string | null>>) =>
    request<NodeConfig>("/admin/node-config", {
      method: "PUT",
      body: JSON.stringify({ assignments }),
    }),
};
