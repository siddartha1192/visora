"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi, type AdminPost } from "@/lib/admin-api";
import {
  Search,
  Trash2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/badge";

const STATUS_OPTIONS = [
  "draft", "queued", "processing", "pending_review",
  "ready", "scheduled", "publishing", "published", "failed", "rejected", "cancelled",
];

export default function AdminPostsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Simple debounce via timeout state
  function handleSearch(value: string) {
    setQ(value);
    clearTimeout((window as unknown as Record<string, unknown>).__adminPostsSearchTimer as ReturnType<typeof setTimeout>);
    (window as unknown as Record<string, unknown>).__adminPostsSearchTimer = setTimeout(() => {
      setDebouncedQ(value);
      setPage(1);
    }, 350);
  }

  const { data, isLoading } = useQuery({
    queryKey: ["admin-posts", page, debouncedQ, statusFilter],
    queryFn: () => adminApi.listPosts({ page, pageSize: 30, q: debouncedQ || undefined, status: statusFilter || undefined }),
    staleTime: 15_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deletePost(id),
    onSuccess: () => {
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["admin-posts"] });
    },
  });

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <header>
          <h1 className="text-xl font-semibold tracking-[-0.02em]">All Posts</h1>
          <p className="text-muted-foreground">
            Every post across all workspaces.{" "}
            {data && <span className="font-medium text-foreground">{data.total.toLocaleString()} total</span>}
          </p>
        </header>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
          <input
            value={q}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by brief, prompt, or instructions…"
            className="w-full rounded-lg border border-border bg-transparent py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground/50" />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="bg-transparent text-sm outline-none text-muted-foreground"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/30">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Owner</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Content</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workflow</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Platforms</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Created</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Loading…</td>
              </tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No posts found.</td>
              </tr>
            )}
            {data?.items.map((post) => (
              <PostRow
                key={post.id}
                post={post}
                confirmDelete={confirmDeleteId === post.id}
                deleting={deleteMutation.isPending && confirmDeleteId === post.id}
                onDeleteClick={() => setConfirmDeleteId(post.id)}
                onCancelDelete={() => setConfirmDeleteId(null)}
                onConfirmDelete={() => deleteMutation.mutate(post.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {data.page} of {totalPages} · {data.total} posts
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-40 hover:bg-secondary/50 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-40 hover:bg-secondary/50 transition-colors"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PostRow({
  post,
  confirmDelete,
  deleting,
  onDeleteClick,
  onCancelDelete,
  onConfirmDelete,
}: {
  post: AdminPost;
  confirmDelete: boolean;
  deleting: boolean;
  onDeleteClick: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const contentText = post.brief ?? post.prompt ?? post.instructions ?? "—";

  return (
    <tr className={cn("transition-colors hover:bg-secondary/20", confirmDelete && "bg-destructive/5")}>
      {/* Owner */}
      <td className="px-4 py-3">
        <p className="font-medium text-foreground">{post.ownerName}</p>
        <p className="text-xs text-muted-foreground">{post.ownerEmail}</p>
      </td>

      {/* Content */}
      <td className="px-4 py-3 max-w-xs">
        <p className="truncate text-sm text-foreground" title={contentText}>
          {contentText.slice(0, 80)}{contentText.length > 80 ? "…" : ""}
        </p>
        {post.lastError && (
          <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span className="truncate">{post.lastError.replace(/^\[content-policy\]\s*/i, "").slice(0, 60)}</span>
          </div>
        )}
      </td>

      {/* Workflow */}
      <td className="px-4 py-3">
        <span className="rounded-md bg-secondary px-2 py-0.5 text-xs capitalize text-secondary-foreground">
          {post.workflow.replace(/_/g, " ")}
        </span>
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <StatusBadge status={post.status as Parameters<typeof StatusBadge>[0]["status"]} />
      </td>

      {/* Platforms */}
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {post.platforms.map((p) => (
            <span key={p} className="rounded-full border border-border px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
              {p}
            </span>
          ))}
        </div>
      </td>

      {/* Created */}
      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {new Date(post.createdAt).toLocaleDateString(undefined, {
          month: "short", day: "numeric", year: "numeric",
        })}
        <br />
        {new Date(post.createdAt).toLocaleTimeString(undefined, {
          hour: "2-digit", minute: "2-digit",
        })}
      </td>

      {/* Actions */}
      <td className="px-4 py-3 text-right">
        {confirmDelete ? (
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-destructive">Delete?</span>
            <button
              onClick={onCancelDelete}
              disabled={deleting}
              className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onConfirmDelete}
              disabled={deleting}
              className="flex items-center gap-1 rounded bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" />
              {deleting ? "…" : "Delete"}
            </button>
          </div>
        ) : (
          <button
            onClick={onDeleteClick}
            className="rounded p-1.5 text-muted-foreground/30 transition-colors hover:bg-destructive/10 hover:text-destructive"
            title="Delete post"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </td>
    </tr>
  );
}
