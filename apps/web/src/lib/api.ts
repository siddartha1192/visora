import type {
  ApiResponse,
  AssetDTO,
  CreatePostInput,
  Paginated,
  PostDTO,
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

const BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/v1";

/** Token storage is intentionally simple here; swap for httpOnly cookies/BFF. */
let accessToken: string | null =
  typeof window !== "undefined" ? localStorage.getItem("visora_token") : null;

export function setToken(token: string | null) {
  accessToken = token;
  if (typeof window !== "undefined") {
    if (token) localStorage.setItem("visora_token", token);
    else localStorage.removeItem("visora_token");
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // Only advertise JSON when there is actually a JSON body — an empty Content-Type:
  // application/json with no body causes Fastify to reject the request with 400.
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.ok) throw new Error(json.error.message);
  return json.data;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ tokens: { accessToken: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (input: { email: string; password: string; name: string }) =>
    request<{ tokens: { accessToken: string } }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),
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
  uploadAsset: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<AssetDTO>("/assets", { method: "POST", body: fd });
  },
  getLogs: (postId: string) =>
    request<LogsResponse>(`/posts/${postId}/logs`),
};
