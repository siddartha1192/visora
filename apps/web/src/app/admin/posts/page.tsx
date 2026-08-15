"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi, type AdminPost } from "@/lib/admin-api";
import {
  Search,
  Trash2,
  Ban,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Filter,
  Table2,
  LayoutGrid,
  List,
  ImageIcon,
} from "lucide-react";
import { isCancellable, type PostStatus } from "@visora/shared";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/badge";
import { ViewSwitcher, useStoredView, type ViewOption } from "@/components/ui/view-switcher";

const STATUS_OPTIONS = [
  "draft", "queued", "processing", "pending_review",
  "ready", "scheduled", "publishing", "published", "failed", "rejected", "cancelled",
];

/**
 * Same control as the user Posts page. The dense default here is a real table
 * with columns rather than a card list, so it's labelled "Table" — the grid and
 * compact densities match the user page one-for-one.
 */
const ADMIN_VIEW_OPTIONS = [
  { id: "table",   label: "Table",   icon: Table2 },
  { id: "grid",    label: "Grid",    icon: LayoutGrid },
  { id: "compact", label: "Compact", icon: List },
] as const satisfies readonly ViewOption<"table" | "grid" | "compact">[];

type AdminView = (typeof ADMIN_VIEW_OPTIONS)[number]["id"];
const ADMIN_VIEW_IDS = ADMIN_VIEW_OPTIONS.map((o) => o.id) as readonly AdminView[];

function adminSummary(post: AdminPost): string {
  return post.brief ?? post.prompt ?? post.instructions ?? post.sourceUrl ?? "—";
}

export default function AdminPostsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [view, setView] = useStoredView<AdminView>(
    "visora-admin-posts-view",
    ADMIN_VIEW_IDS,
    "table",
  );

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
    onMutate: () => setActionError(null),
    onSuccess: () => {
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["admin-posts"] });
    },
    onError: (e: Error) => setActionError(e.message),
  });

  // Cancelling keeps the record and its audit trail; deleting destroys both.
  const cancelMutation = useMutation({
    mutationFn: (id: string) => adminApi.cancelPost(id),
    onMutate: () => setActionError(null),
    onSuccess: () => {
      setConfirmCancelId(null);
      queryClient.invalidateQueries({ queryKey: ["admin-posts"] });
    },
    onError: (e: Error) => setActionError(e.message),
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
        {data && data.items.length > 0 && (
          <ViewSwitcher options={ADMIN_VIEW_OPTIONS} view={view} onChange={setView} />
        )}
      </div>

      {/* Surfaces the API's reason — e.g. a post that started publishing
          between the list render and the click. */}
      {actionError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

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

      {/* All three views drive the same confirm state and mutations, so an
          action behaves identically whichever layout it's triggered from. */}
      {(() => {
        const rowProps = (post: AdminPost) => ({
          post,
          confirmDelete: confirmDeleteId === post.id,
          deleting: deleteMutation.isPending && confirmDeleteId === post.id,
          onDeleteClick: () => { setConfirmCancelId(null); setConfirmDeleteId(post.id); },
          onDismissDelete: () => setConfirmDeleteId(null),
          onConfirmDelete: () => deleteMutation.mutate(post.id),
          confirmCancel: confirmCancelId === post.id,
          cancelling: cancelMutation.isPending && confirmCancelId === post.id,
          onCancelClick: () => { setConfirmDeleteId(null); setConfirmCancelId(post.id); },
          onDismissCancel: () => setConfirmCancelId(null),
          onConfirmCancel: () => cancelMutation.mutate(post.id),
        });

        if (isLoading) {
          return (
            <div className="rounded-xl border border-border px-4 py-10 text-center text-muted-foreground">
              Loading…
            </div>
          );
        }
        if (data?.items.length === 0) {
          return (
            <div className="rounded-xl border border-border px-4 py-10 text-center text-muted-foreground">
              No posts found.
            </div>
          );
        }

        if (view === "grid") {
          return (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {data?.items.map((post) => (
                <PostTile key={`grid-${post.id}`} {...rowProps(post)} />
              ))}
            </div>
          );
        }

        if (view === "compact") {
          return (
            <div className="space-y-1.5">
              {data?.items.map((post) => (
                <PostCompactRow key={`compact-${post.id}`} {...rowProps(post)} />
              ))}
            </div>
          );
        }

        return (
          <div className="rounded-xl border border-border overflow-x-auto">
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
                {data?.items.map((post) => (
                  <PostRow key={`table-${post.id}`} {...rowProps(post)} />
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

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

/** Shared by all three admin layouts — one action contract, three renderings. */
interface AdminRowProps {
  post: AdminPost;
  confirmDelete: boolean;
  deleting: boolean;
  onDeleteClick: () => void;
  onDismissDelete: () => void;
  onConfirmDelete: () => void;
  confirmCancel: boolean;
  cancelling: boolean;
  onCancelClick: () => void;
  onDismissCancel: () => void;
  onConfirmCancel: () => void;
}

/** Thumbnail with a graceful placeholder — grid and compact views. */
function Thumb({ post, className }: { post: AdminPost; className?: string }) {
  if (post.imageUrl) {
    return (
      <img
        src={post.imageUrl}
        alt={adminSummary(post)}
        className={cn("h-full w-full object-cover", className)}
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center">
      <ImageIcon className="h-5 w-5 text-muted-foreground/30" />
    </div>
  );
}

/** Cancel + delete as icon buttons — grid and compact views. */
function AdminActionIcons({
  post,
  onCancelClick,
  onDeleteClick,
}: Pick<AdminRowProps, "post" | "onCancelClick" | "onDeleteClick">) {
  return (
    <div className="flex items-center gap-0.5">
      {isCancellable(post.status as PostStatus) && (
        <button
          onClick={onCancelClick}
          title="Cancel this post before it publishes"
          className="rounded p-1.5 text-muted-foreground/40 transition-colors hover:bg-warning/10 hover:text-warning"
        >
          <Ban className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        onClick={onDeleteClick}
        title="Permanently delete this post record"
        className="rounded p-1.5 text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Inline confirm used by grid and compact (the table has its own inline row). */
function AdminConfirmBar({
  kind,
  pending,
  onDismiss,
  onConfirm,
}: {
  kind: "cancel" | "delete";
  pending: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  const destructive = kind === "delete";
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-md border px-2 py-1.5",
        destructive
          ? "border-destructive/30 bg-destructive/10"
          : "border-warning/30 bg-warning/10",
      )}
    >
      <span className={cn("text-xs", destructive ? "text-destructive" : "text-warning")}>
        {destructive ? "Delete permanently?" : "Stop this publishing?"}
      </span>
      <div className="flex shrink-0 gap-1.5">
        <button
          onClick={onDismiss}
          disabled={pending}
          className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-50"
        >
          Back
        </button>
        <button
          onClick={onConfirm}
          disabled={pending}
          className={cn(
            "flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
            destructive
              ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              : "bg-warning text-warning-foreground hover:bg-warning/90",
          )}
        >
          {destructive ? <Trash2 className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
          {pending ? "…" : destructive ? "Delete" : "Cancel post"}
        </button>
      </div>
    </div>
  );
}

function PostRow({
  post,
  confirmDelete,
  deleting,
  onDeleteClick,
  onDismissDelete,
  onConfirmDelete,
  confirmCancel,
  cancelling,
  onCancelClick,
  onDismissCancel,
  onConfirmCancel,
}: AdminRowProps) {
  const contentText = adminSummary(post);
  const cancellable = isCancellable(post.status as PostStatus);

  return (
    <tr
      className={cn(
        "transition-colors hover:bg-secondary/20",
        confirmDelete && "bg-destructive/5",
        confirmCancel && "bg-warning/5",
      )}
    >
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

      {/* Actions. "Back" rather than "Cancel" on the dismiss buttons — in this
          table "cancel" now means cancelling the post itself. */}
      <td className="px-4 py-3 text-right">
        {confirmDelete ? (
          <div className="flex items-center justify-end gap-2">
            <span className="whitespace-nowrap text-xs text-destructive">
              Delete permanently?
            </span>
            <button
              onClick={onDismissDelete}
              disabled={deleting}
              className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-50"
            >
              Back
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
        ) : confirmCancel ? (
          <div className="flex items-center justify-end gap-2">
            <span className="whitespace-nowrap text-xs text-warning">
              Stop this publishing?
            </span>
            <button
              onClick={onDismissCancel}
              disabled={cancelling}
              className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-50"
            >
              Back
            </button>
            <button
              onClick={onConfirmCancel}
              disabled={cancelling}
              className="flex items-center gap-1 rounded bg-warning px-2 py-1 text-xs font-medium text-warning-foreground hover:bg-warning/90 transition-colors disabled:opacity-50"
            >
              <Ban className="h-3 w-3" />
              {cancelling ? "…" : "Cancel post"}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1">
            {cancellable && (
              <button
                onClick={onCancelClick}
                className="rounded p-1.5 text-muted-foreground/30 transition-colors hover:bg-warning/10 hover:text-warning"
                title="Cancel this post before it publishes"
              >
                <Ban className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onDeleteClick}
              className="rounded p-1.5 text-muted-foreground/30 transition-colors hover:bg-destructive/10 hover:text-destructive"
              title="Permanently delete this post record"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

/* ── Grid view ─────────────────────────────────────────────────────────────
 * Image-forward tile. Owner stays visible — the whole point of this page is
 * that posts belong to other people.
 */
function PostTile({
  post,
  confirmDelete,
  deleting,
  onDeleteClick,
  onDismissDelete,
  onConfirmDelete,
  confirmCancel,
  cancelling,
  onCancelClick,
  onDismissCancel,
  onConfirmCancel,
}: AdminRowProps) {
  return (
    <div
      className={cn(
        "group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors",
        confirmDelete && "border-destructive/40",
        confirmCancel && "border-warning/40",
      )}
    >
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden border-b border-border bg-secondary">
        <Thumb post={post} className="transition-transform duration-300 group-hover:scale-[1.03]" />
        {/* StatusBadge fills are translucent tints tuned for flat dark
            surfaces; over a photo they need this scrim to stay legible. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/70 via-black/30 to-transparent" />
        <div className="absolute left-2 top-2">
          <StatusBadge status={post.status as Parameters<typeof StatusBadge>[0]["status"]} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <p className="truncate text-xs font-medium text-foreground">{post.ownerName}</p>
          <p className="truncate text-[11px] text-muted-foreground">{post.ownerEmail}</p>
        </div>

        <p className="line-clamp-2 text-sm text-foreground/90">{adminSummary(post)}</p>

        {post.lastError && (
          <p className="flex items-start gap-1 text-xs text-destructive">
            <AlertCircle className="mt-px h-3 w-3 shrink-0" />
            <span className="line-clamp-2">
              {post.lastError.replace(/^\[content-policy\]\s*/i, "")}
            </span>
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <div className="flex min-w-0 flex-wrap gap-1">
            {post.platforms.map((p) => (
              <span
                key={p}
                className="rounded-full border border-border px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground"
              >
                {p}
              </span>
            ))}
          </div>
          <AdminActionIcons
            post={post}
            onCancelClick={onCancelClick}
            onDeleteClick={onDeleteClick}
          />
        </div>

        {(confirmDelete || confirmCancel) && (
          <AdminConfirmBar
            kind={confirmDelete ? "delete" : "cancel"}
            pending={confirmDelete ? deleting : cancelling}
            onDismiss={confirmDelete ? onDismissDelete : onDismissCancel}
            onConfirm={confirmDelete ? onConfirmDelete : onConfirmCancel}
          />
        )}
      </div>
    </div>
  );
}

/* ── Compact view ──────────────────────────────────────────────────────────
 * One line per post for scanning a lot of runs across every workspace.
 */
function PostCompactRow({
  post,
  confirmDelete,
  deleting,
  onDeleteClick,
  onDismissDelete,
  onConfirmDelete,
  confirmCancel,
  cancelling,
  onCancelClick,
  onDismissCancel,
  onConfirmCancel,
}: AdminRowProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card transition-colors",
        confirmDelete && "border-destructive/40",
        confirmCancel && "border-warning/40",
      )}
    >
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border bg-secondary">
          <Thumb post={post} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground/90">{adminSummary(post)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {post.ownerName} · {post.ownerEmail}
          </p>
        </div>

        <span className="hidden shrink-0 rounded-md bg-secondary px-2 py-0.5 text-[10px] capitalize text-secondary-foreground xl:inline">
          {post.workflow.replace(/_/g, " ")}
        </span>

        <div className="hidden shrink-0 md:block">
          <StatusBadge status={post.status as Parameters<typeof StatusBadge>[0]["status"]} />
        </div>

        <span className="hidden shrink-0 whitespace-nowrap text-xs text-muted-foreground/50 lg:block">
          {new Date(post.createdAt).toLocaleDateString(undefined, {
            month: "short", day: "numeric",
          })}
        </span>

        <AdminActionIcons
          post={post}
          onCancelClick={onCancelClick}
          onDeleteClick={onDeleteClick}
        />
      </div>

      {(confirmDelete || confirmCancel) && (
        <div className="px-3 pb-2">
          <AdminConfirmBar
            kind={confirmDelete ? "delete" : "cancel"}
            pending={confirmDelete ? deleting : cancelling}
            onDismiss={confirmDelete ? onDismissDelete : onDismissCancel}
            onConfirm={confirmDelete ? onConfirmDelete : onConfirmCancel}
          />
        </div>
      )}
    </div>
  );
}
