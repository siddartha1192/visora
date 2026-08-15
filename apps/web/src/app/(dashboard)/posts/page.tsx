"use client";

import { useQuery } from "@tanstack/react-query";
import type { AssetDTO, PostDTO, WorkflowType } from "@visora/shared";
import { isCancellable } from "@visora/shared";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { InlineCalendar } from "@/components/ui/inline-calendar";
import { LogDrawer } from "@/components/ui/log-drawer";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRow } from "@/components/ui/skeleton";
import { ViewSwitcher, useStoredView, type ViewOption } from "@/components/ui/view-switcher";
import { api } from "@/lib/api";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  ImageIcon,
  ListChecks,
  Send,
  XCircle,
  X,
  ScrollText,
  ZoomIn,
  RotateCcw,
  RefreshCw,
  ChevronDown,
  Trash2,
  Ban,
  LayoutList,
  LayoutGrid,
  List,
} from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

type AssetSource = "user" | "dalle3" | "pexels" | "unsplash" | "scrape";

const SOURCE_META: Record<string, { label: string; className: string }> = {
  user:            { label: "Upload",       className: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  dalle3_generate: { label: "AI Generated", className: "bg-purple-500/20 text-purple-300 border-purple-500/30" },
  dalle3_enhance:  { label: "AI Enhanced",  className: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  pexels:          { label: "Pexels",       className: "bg-green-500/20 text-green-300 border-green-500/30" },
  unsplash:        { label: "Unsplash",     className: "bg-teal-500/20 text-teal-300 border-teal-500/30" },
  scrape:          { label: "Scraped",      className: "bg-rose-500/20 text-rose-300 border-rose-500/30" },
};

function Chip({ metaKey }: { metaKey: string }) {
  const meta = SOURCE_META[metaKey];
  if (!meta) return null;
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
}

function SourceBadges({ asset, workflow }: { asset: AssetDTO | undefined; workflow: WorkflowType }) {
  if (!asset) return null;
  const source = asset.origin.source as AssetSource;
  if (
    source === "dalle3" &&
    workflow === "stock_discovery" &&
    asset.origin.providerMeta
  ) {
    const originalSource = asset.origin.providerMeta.originalSource as string | undefined;
    if (originalSource === "pexels" || originalSource === "unsplash") {
      return (
        <>
          <Chip metaKey={originalSource} />
          <Chip metaKey="dalle3_enhance" />
        </>
      );
    }
  }
  if (source === "dalle3" && workflow === "ai_enhance") return <Chip metaKey="dalle3_enhance" />;
  if (source === "dalle3") return <Chip metaKey="dalle3_generate" />;
  return <Chip metaKey={source} />;
}

/**
 * Countdown to a future publish date.
 * Returns { label, overdue } — overdue means time has passed and the publish
 * job should be running (BullMQ fires within seconds of the target time).
 */
function useCountdown(target: string | undefined) {
  const [state, setState] = useState({ label: "", overdue: false });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!target) { setState({ label: "", overdue: false }); return; }

    function compute() {
      const ms = new Date(target!).getTime() - Date.now();
      if (ms <= 0) {
        setState({ label: "", overdue: true });
        return;
      }
      const totalMin = Math.floor(ms / 60000);
      const days = Math.floor(totalMin / 1440);
      const hrs  = Math.floor((totalMin % 1440) / 60);
      const mins = totalMin % 60;
      let label: string;
      if (days > 0)      label = `in ${days}d ${hrs}h`;
      else if (hrs > 0)  label = `in ${hrs}h ${mins}m`;
      else               label = `in ${mins}m`;
      setState({ label, overdue: false });
    }

    compute();
    timerRef.current = setInterval(compute, 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [target]);

  return state;
}

/* ── View modes ────────────────────────────────────────────────────────────
 * Three densities over the same data:
 *   list    — full rows with every inline banner (review gate, countdown,
 *             failure reason, retry). The triage view; unchanged from before.
 *   grid    — image-forward tiles. This is a visual-content tool, so scanning
 *             the imagery itself is a first-class way to find a post.
 *   compact — one line per post. For scanning many runs at once.
 *
 * Grid and compact deliberately carry only the primary affordance for a post's
 * state plus the action icons; the full detail stays in list view rather than
 * being crammed into a tile.
 */
const POST_VIEW_OPTIONS = [
  { id: "list",    label: "List",    icon: LayoutList },
  { id: "grid",    label: "Grid",    icon: LayoutGrid },
  { id: "compact", label: "Compact", icon: List },
] as const satisfies readonly ViewOption<"list" | "grid" | "compact">[];

type PostView = (typeof POST_VIEW_OPTIONS)[number]["id"];
const POST_VIEW_IDS = POST_VIEW_OPTIONS.map((o) => o.id) as readonly PostView[];

export default function PostsPage() {
  return (
    <Suspense fallback={null}>
      <PostsPageInner />
    </Suspense>
  );
}

function PostsPageInner() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["posts"],
    queryFn: () => api.listPosts(1),
    refetchInterval: 5000,
  });

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.getMe(),
    staleTime: 60_000,
  });
  const isAdmin =
    Boolean(me?.platformRole) ||
    me?.orgRole === "owner" ||
    (me?.workspaces ?? []).some((w) => w.myRole === "admin");

  const stats = data?.items.reduce(
    (acc, p) => {
      if (p.status === "scheduled" || (p.status === "ready" && p.schedule?.mode === "scheduled")) acc.scheduled++;
      else if (p.status === "published") acc.published++;
      else if (p.status === "failed") acc.failed++;
      return acc;
    },
    { scheduled: 0, published: 0, failed: 0 },
  );

  const [lightbox, setLightbox] = useState<{ url: string; post: PostDTO } | null>(null);
  const [reviewPost, setReviewPost] = useState<PostDTO | null>(null);
  const [logPost, setLogPost] = useState<PostDTO | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [view, setView] = useStoredView<PostView>(
    "visora-posts-view",
    POST_VIEW_IDS,
    "list",
  );

  // Deep link from the Calendar: /posts?highlight=<postId> — scroll to the row
  // (or open the review gate if it's still awaiting approval), then strip the param.
  const highlightParam = searchParams.get("highlight");
  useEffect(() => {
    if (!highlightParam || !data) return;
    const post = data.items.find((p) => p.id === highlightParam);
    if (post) {
      if (post.status === "pending_review") {
        setReviewPost(post);
      } else {
        document.getElementById(`post-${post.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightedId(post.id);
        const timer = setTimeout(() => setHighlightedId(null), 2500);
        return () => clearTimeout(timer);
      }
    }
    router.replace("/posts", { scroll: false });
  }, [highlightParam, data, router]);

  const closeLightbox = useCallback(() => setLightbox(null), []);

  const approveMutation = useMutation({
    mutationFn: (opts: { scheduledAt?: string; scheduleMode: "instant" | "scheduled" }) =>
      api.approvePost(reviewPost!.id, opts),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["posts"] });
      setReviewPost(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.rejectPost(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["posts"] });
      setReviewPost(null);
    },
  });

  const closeReview = useCallback(() => {
    setReviewPost(null);
    approveMutation.reset();
    rejectMutation.reset();
  }, [approveMutation, rejectMutation]);

  const reviewError =
    (approveMutation.error as Error | null)?.message ??
    (rejectMutation.error as Error | null)?.message ?? null;

  useEffect(() => {
    if (!lightbox && !reviewPost && !logPost) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { closeLightbox(); closeReview(); setLogPost(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, reviewPost, logPost, closeLightbox, closeReview]);

  return (
    <>
      {/* Posts list — shifts left when log panel is open. Grid needs more room
          than the reading-width used by the row layouts. */}
      <div className={cn(
        "mx-auto space-y-6 transition-all duration-200",
        view === "grid" ? "max-w-6xl" : "max-w-4xl",
        logPost && "mr-[416px]",
      )}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <PageHeader
            icon={<ListChecks className="h-5 w-5" />}
            title="Posts"
            description="Every run, with live status as the agent graph progresses."
          />
          {data && data.items.length > 0 && (
            <ViewSwitcher options={POST_VIEW_OPTIONS} view={view} onChange={setView} />
          )}
        </div>

        {data && data.items.length > 0 && stats && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard size="compact" label="Total posts" value={String(data.items.length)} icon={ListChecks} accent="bg-secondary/60 text-foreground" />
            <StatCard size="compact" label="Scheduled" value={String(stats.scheduled)} icon={Clock} accent="bg-primary/15 text-primary" />
            <StatCard size="compact" label="Published" value={String(stats.published)} icon={CheckCircle} accent="bg-success/15 text-success" />
            <StatCard size="compact" label="Failed" value={String(stats.failed)} icon={XCircle} accent="bg-destructive/15 text-destructive" />
          </div>
        )}

        {error && (
          <p className="text-destructive">
            {(error as Error).message} — is the API running on :4000?
          </p>
        )}

        <div
          className={cn(
            view === "grid"
              ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
              : view === "compact"
              ? "space-y-1.5"
              : "space-y-3",
          )}
        >
          {isLoading && Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}

          {data?.items.map((post) => {
            const shared = {
              post,
              isAdmin,
              highlighted: highlightedId === post.id,
              onImageClick: (url: string) => setLightbox({ url, post }),
              onReview: () => setReviewPost(post),
              onViewLogs: () => setLogPost(post),
            };
            // Keyed by view so switching layouts remounts cleanly rather than
            // trying to reconcile two very different trees.
            if (view === "grid") return <PostTile key={`grid-${post.id}`} {...shared} />;
            if (view === "compact") return <PostCompactRow key={`compact-${post.id}`} {...shared} />;
            return <PostRow key={`list-${post.id}`} {...shared} />;
          })}
        </div>

        {data && data.items.length === 0 && (
          <EmptyState
            icon={ImageIcon}
            title="No posts yet"
            description="Head to Compose to create your first one."
          />
        )}
      </div>

      {/* Log panel — fixed right panel, no backdrop */}
      {logPost && (
        <LogDrawer
          postId={logPost.id}
          postWorkflow={logPost.workflow}
          onClose={() => setLogPost(null)}
        />
      )}

      {/* Lightbox — full-size image + caption */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
          onClick={closeLightbox}
        >
          <button
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
            onClick={closeLightbox}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>

          <div
            className="flex w-full max-w-3xl flex-col gap-4 max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Full-size image — capped so caption is always visible below */}
            <img
              src={lightbox.url}
              alt="Full-size preview"
              className="w-full rounded-xl object-contain shadow-2xl"
              style={{ maxHeight: "58vh" }}
            />

            {/* Caption / prompt panel — always visible below the image */}
            {(() => {
              const captionText = lightbox.post.caption?.text;
              const hashtags = lightbox.post.caption?.hashtags ?? [];
              const fallback =
                (lightbox.post.input as Record<string, string | undefined>)?.prompt ??
                (lightbox.post.input as Record<string, string | undefined>)?.brief ??
                (lightbox.post.input as Record<string, string | undefined>)?.instructions ??
                (lightbox.post.input as Record<string, string | undefined>)?.sourceUrl;

              if (!captionText && hashtags.length === 0 && !fallback) return null;

              return (
                <div className="shrink-0 w-full rounded-xl border border-white/10 bg-black/60 px-5 py-4 backdrop-blur-md text-center">
                  {captionText ? (
                    <p className="text-sm leading-relaxed text-white whitespace-pre-wrap">{captionText}</p>
                  ) : fallback ? (
                    <p className="text-sm leading-relaxed text-white/50 whitespace-pre-wrap italic">{fallback}</p>
                  ) : null}
                  {hashtags.length > 0 && (
                    <p className={cn("text-xs text-primary/80", captionText && "mt-2")}>
                      {hashtags.map((h: string) => `#${h}`).join(" ")}
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Review modal */}
      {reviewPost && (
        <ReviewModal
          post={reviewPost}
          onClose={closeReview}
          onApprove={(opts) => approveMutation.mutate(opts)}
          onReject={() => rejectMutation.mutate(reviewPost.id)}
          isPending={approveMutation.isPending || rejectMutation.isPending}
          error={reviewError}
        />
      )}
    </>
  );
}

/** Posts that have at least entered the pipeline queue (i.e. logs may exist). */
const LOGGABLE_STATUSES = new Set([
  "queued", "processing", "pending_review", "ready",
  "scheduled", "publishing", "published", "failed", "rejected",
]);

/**
 * Everything a post row/tile can *do*, in one place. All three views share this
 * so cancel, delete and retry behave identically regardless of layout — and so
 * a rule change (e.g. what's cancellable) lands in every view at once.
 *
 * Only one confirmation can be open at a time, which is why it's a single
 * discriminated value rather than a boolean per action.
 */
function usePostActions(post: PostDTO) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<null | "cancel" | "delete">(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["posts"] });

  const cancelMutation = useMutation({
    mutationFn: () => api.cancelPost(post.id),
    onSuccess: () => { invalidate(); setConfirm(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.adminDeletePost(post.id),
    onSuccess: () => { invalidate(); setConfirm(null); },
  });

  const retryMutation = useMutation({
    mutationFn: (mode: "from_failed" | "full") => api.retryPost(post.id, mode),
    onSuccess: invalidate,
  });

  const { data: asset } = useQuery<AssetDTO>({
    queryKey: ["asset", post.primaryAssetId],
    queryFn: () => api.getAsset(post.primaryAssetId!),
    enabled: !!post.primaryAssetId,
  });

  const isScheduledReady =
    post.status === "ready" &&
    post.schedule?.mode === "scheduled" &&
    !!post.schedule?.runAt;

  const countdown = useCountdown(
    isScheduledReady ? post.schedule?.runAt : undefined,
  );

  return {
    asset,
    confirm,
    setConfirm,
    cancelMutation,
    deleteMutation,
    retryMutation,
    // Mirrors the API's own rule, so a view can never offer a cancel the
    // server would refuse.
    cancellable: isCancellable(post.status),
    isScheduledReady,
    countdown,
    actionError:
      (cancelMutation.error as Error | null)?.message ??
      (deleteMutation.error as Error | null)?.message ??
      null,
  };
}

type PostActions = ReturnType<typeof usePostActions>;

/** Inline confirmation strip, shared by every view. */
function ConfirmBar({
  kind,
  post,
  pending,
  onDismiss,
  onConfirm,
}: {
  kind: "cancel" | "delete";
  post: PostDTO;
  pending: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  const destructive = kind === "delete";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2",
        destructive
          ? "border-destructive/30 bg-destructive/10"
          : "border-warning/30 bg-warning/10",
      )}
    >
      <p className={cn("text-xs", destructive ? "text-destructive" : "text-warning")}>
        {destructive
          ? "Permanently delete this post record? This cannot be undone."
          : post.status === "ready" && post.schedule?.mode === "scheduled"
          ? "Stop this post from publishing at its scheduled time? It stays in your list, marked cancelled."
          : "Cancel this post? It stops before publishing and stays in your list, marked cancelled."}
      </p>
      <div className="flex shrink-0 gap-2">
        <button
          onClick={onDismiss}
          disabled={pending}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-50"
        >
          {destructive ? "Cancel" : "Keep it"}
        </button>
        <button
          onClick={onConfirm}
          disabled={pending}
          className={cn(
            "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
            destructive
              ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              : "bg-warning text-warning-foreground hover:bg-warning/90",
          )}
        >
          {destructive ? <Trash2 className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
          {pending
            ? destructive ? "Deleting…" : "Cancelling…"
            : destructive ? "Yes, delete" : "Yes, cancel"}
        </button>
      </div>
    </div>
  );
}

/** Cancel / delete / logs as icon buttons — used by grid and compact views. */
function PostActionIcons({
  actions,
  isAdmin,
  loggable,
  onViewLogs,
}: {
  actions: PostActions;
  isAdmin: boolean;
  loggable: boolean;
  onViewLogs: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {loggable && (
        <button
          onClick={onViewLogs}
          title="View execution logs"
          className="rounded p-1.5 text-muted-foreground/40 transition-colors hover:bg-secondary hover:text-muted-foreground"
        >
          <ScrollText className="h-3.5 w-3.5" />
        </button>
      )}
      {actions.cancellable && (
        <button
          onClick={() => actions.setConfirm("cancel")}
          title="Cancel this post before it publishes"
          className="rounded p-1.5 text-muted-foreground/40 transition-colors hover:bg-warning/10 hover:text-warning"
        >
          <Ban className="h-3.5 w-3.5" />
        </button>
      )}
      {isAdmin && (
        <button
          onClick={() => actions.setConfirm("delete")}
          title="Permanently delete this post (admin)"
          className="rounded p-1.5 text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** One-line summary of what a post is waiting on — grid/compact only. */
function StatusHint({ post, actions }: { post: PostDTO; actions: PostActions }) {
  if (post.status === "pending_review") {
    return <span className="text-warning">Awaiting review</span>;
  }
  if (actions.isScheduledReady) {
    return actions.countdown.overdue ? (
      <span className="text-success">Publishing…</span>
    ) : (
      <span className="text-primary">Publishes {actions.countdown.label}</span>
    );
  }
  if (post.status === "cancelled") {
    return <span className="text-muted-foreground">Cancelled — will not publish</span>;
  }
  if (post.status === "failed" && post.lastError) {
    return <span className="truncate text-destructive">{post.lastError}</span>;
  }
  return null;
}

function postSummary(post: PostDTO): string {
  return (
    post.input.prompt ??
    post.input.instructions ??
    post.input.sourceUrl ??
    post.caption.text ??
    "—"
  );
}

function PostRow({
  post,
  isAdmin,
  highlighted,
  onImageClick,
  onReview,
  onViewLogs,
}: {
  post: PostDTO;
  isAdmin: boolean;
  highlighted?: boolean;
  onImageClick: (url: string) => void;
  onReview: () => void;
  onViewLogs: () => void;
}) {
  const actions = usePostActions(post);
  const {
    asset,
    confirm,
    setConfirm,
    cancelMutation,
    deleteMutation,
    retryMutation,
    cancellable,
    isScheduledReady,
  } = actions;
  const { label: countdownLabel, overdue } = actions.countdown;

  const [retryOpen, setRetryOpen] = useState(false);
  const retryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!retryMutation.isPending) setRetryOpen(false);
  }, [retryMutation.isPending]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!retryOpen) return;
    const handler = (e: MouseEvent) => {
      if (retryRef.current && !retryRef.current.contains(e.target as Node)) {
        setRetryOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [retryOpen]);

  return (
    <Card
      id={`post-${post.id}`}
      className={cn(
        "flex flex-col gap-3 p-4 transition-shadow duration-300",
        highlighted && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      <div className="flex items-center gap-4">
        {/* Thumbnail */}
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-secondary">
          {asset?.url ? (
            <button
              className="h-full w-full cursor-zoom-in"
              onClick={() => onImageClick(asset.url)}
              title="Click to view full size"
            >
              <img
                src={asset.url}
                alt={post.input.prompt ?? "generated image"}
                className="h-full w-full object-cover"
              />
            </button>
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-secondary px-2 py-0.5 text-xs capitalize text-secondary-foreground">
              {post.workflow.replace(/_/g, " ")}
            </span>
            <StatusBadge status={post.status} />
            <SourceBadges asset={asset} workflow={post.workflow} />
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {post.input.prompt ??
              post.input.instructions ??
              post.input.sourceUrl ??
              post.caption.text ??
              "—"}
          </p>
          {post.caption.text && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground/60">
              {post.caption.text}
            </p>
          )}
        </div>

        {/* Targets + date + admin delete */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex gap-1">
            {post.targets.map((t) => (
              <span
                key={t.platform}
                className="rounded-full border border-border px-2 py-0.5 text-xs capitalize text-muted-foreground"
              >
                {t.platform}
              </span>
            ))}
          </div>
          <span className="text-xs text-muted-foreground/50">
            {new Date(post.createdAt).toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            {/* Anyone can stop their own post; only admin/root can destroy it. */}
            {cancellable && !confirm && (
              <button
                onClick={() => setConfirm("cancel")}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground/40 transition-colors hover:bg-warning/10 hover:text-warning"
                title="Cancel this post before it publishes"
              >
                <Ban className="h-3 w-3" />
                Cancel
              </button>
            )}
            {isAdmin && !confirm && (
              <button
                onClick={() => setConfirm("delete")}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
                title="Delete post (admin)"
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Cancel confirmation */}
      {confirm === "cancel" && (
        <ConfirmBar
          kind="cancel"
          post={post}
          pending={cancelMutation.isPending}
          onDismiss={() => setConfirm(null)}
          onConfirm={() => cancelMutation.mutate()}
        />
      )}
      {actions.actionError && (
        <p className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
          {actions.actionError}
        </p>
      )}

      {/* Cancelled — who stopped it, and when */}
      {post.status === "cancelled" && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2">
          <Ban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Cancelled
            {post.cancelledBy && post.cancelledBy.role !== "user"
              ? ` by ${post.cancelledBy.role === "root" ? "a root user" : "an admin"}`
              : ""}
            {post.cancelledAt
              ? ` on ${new Date(post.cancelledAt).toLocaleString()}`
              : ""}
            {" — this post will not be published."}
          </p>
        </div>
      )}

      {/* Admin delete confirmation */}
      {confirm === "delete" && (
        <ConfirmBar
          kind="delete"
          post={post}
          pending={deleteMutation.isPending}
          onDismiss={() => setConfirm(null)}
          onConfirm={() => deleteMutation.mutate()}
        />
      )}

      {/* Pending review */}
      {post.status === "pending_review" && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
          <p className="text-xs text-warning">
            Content is ready — review the image and caption before publishing.
          </p>
          <button
            onClick={onReview}
            className="shrink-0 rounded-lg bg-warning px-3 py-1.5 text-xs font-semibold text-warning-foreground hover:bg-warning/90 transition-colors"
          >
            Review & Approve
          </button>
        </div>
      )}

      {/* Scheduled ready — countdown or publishing spinner */}
      {isScheduledReady && (
        overdue ? (
          <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-success" />
            <p className="text-xs text-success">Publishing to platforms…</p>
          </div>
        ) : countdownLabel ? (
          <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2">
            <Clock className="h-3.5 w-3.5 shrink-0 text-primary" />
            <p className="text-xs text-primary">
              Approved · auto-publishes{" "}
              <span className="font-semibold">{countdownLabel}</span>
              {" "}
              <span className="text-primary/70">
                ({new Date(post.schedule!.runAt!).toLocaleString(undefined, {
                  month: "short", day: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })})
              </span>
            </p>
          </div>
        ) : null
      )}

      {/* Error banner */}
      {post.status === "failed" && post.lastError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{post.lastError}</span>
        </div>
      )}

      {/* Failed — retry actions + view logs */}
      {post.status === "failed" && (
        <div className="flex items-center justify-between">
          {/* Retry dropdown */}
          <div className="relative" ref={retryRef}>
            <button
              onClick={() => setRetryOpen((o) => !o)}
              disabled={retryMutation.isPending}
              className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
            >
              <RotateCcw className={cn("h-3 w-3", retryMutation.isPending && "animate-spin")} />
              {retryMutation.isPending ? "Retrying…" : "Retry"}
              <ChevronDown className="h-3 w-3" />
            </button>

            {retryOpen && (
              <div className="absolute left-0 bottom-full z-20 mb-1 w-56 rounded-lg border border-border bg-card shadow-elevate-md">
                {post.primaryAssetId && (
                  <button
                    onClick={() => retryMutation.mutate("from_failed")}
                    className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-xs hover:bg-secondary rounded-t-lg transition-colors"
                  >
                    <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    <div>
                      <p className="font-medium text-foreground">Retry publish only</p>
                      <p className="text-muted-foreground">Re-attempt posting with existing generated content</p>
                    </div>
                  </button>
                )}
                <button
                  onClick={() => retryMutation.mutate("full")}
                  className={cn(
                    "flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-xs hover:bg-secondary transition-colors",
                    post.primaryAssetId ? "rounded-b-lg border-t border-border" : "rounded-lg",
                  )}
                >
                  <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <div>
                    <p className="font-medium text-foreground">Rerun from scratch</p>
                    <p className="text-muted-foreground">Regenerate content and retry everything</p>
                  </div>
                </button>
              </div>
            )}
          </div>

          <button
            onClick={onViewLogs}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-muted-foreground"
          >
            <ScrollText className="h-3 w-3" />
            View Logs
          </button>
        </div>
      )}

      {/* View Logs button — shown for non-failed loggable posts */}
      {LOGGABLE_STATUSES.has(post.status) && post.status !== "failed" && (
        <div className="flex justify-end">
          <button
            onClick={onViewLogs}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-muted-foreground"
          >
            <ScrollText className="h-3 w-3" />
            View Logs
          </button>
        </div>
      )}
    </Card>
  );
}

/* ── Grid view ─────────────────────────────────────────────────────────────
 * Image-forward tile. The thumbnail is the subject, so it gets a full 4:3
 * frame; text and actions sit beneath it. Failure/review state collapses to a
 * single hint line — the full banners live in list view.
 */
function PostTile({
  post,
  isAdmin,
  highlighted,
  onImageClick,
  onReview,
  onViewLogs,
}: {
  post: PostDTO;
  isAdmin: boolean;
  highlighted?: boolean;
  onImageClick: (url: string) => void;
  onReview: () => void;
  onViewLogs: () => void;
}) {
  const actions = usePostActions(post);
  const { asset, confirm, setConfirm, cancelMutation, deleteMutation } = actions;

  return (
    <Card
      id={`post-${post.id}`}
      className={cn(
        "group flex flex-col overflow-hidden transition-shadow duration-300",
        highlighted && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      {/* Thumbnail */}
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden border-b border-border bg-secondary">
        {asset?.url ? (
          <button
            className="h-full w-full cursor-zoom-in"
            onClick={() => onImageClick(asset.url)}
            title="Click to view full size"
          >
            <img
              src={asset.url}
              alt={post.input.prompt ?? "generated image"}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          </button>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}
        {/* StatusBadge is built for the app's flat dark surfaces — its fills are
            translucent tints, which wash out completely over a bright photo.
            This scrim gives it a consistent dark backing on any image. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/70 via-black/30 to-transparent" />
        <div className="absolute left-2 top-2">
          <StatusBadge status={post.status} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] capitalize text-secondary-foreground">
            {post.workflow.replace(/_/g, " ")}
          </span>
          <SourceBadges asset={asset} workflow={post.workflow} />
        </div>

        <p className="line-clamp-2 text-sm text-foreground/90">{postSummary(post)}</p>

        <p className="text-xs">
          <StatusHint post={post} actions={actions} />
        </p>

        {/* Pushes the footer to the bottom so tiles in a row align. */}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <div className="flex min-w-0 flex-wrap gap-1">
            {post.targets.map((t) => (
              <span
                key={t.platform}
                className="rounded-full border border-border px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground"
              >
                {t.platform}
              </span>
            ))}
          </div>
          <PostActionIcons
            actions={actions}
            isAdmin={isAdmin}
            loggable={LOGGABLE_STATUSES.has(post.status)}
            onViewLogs={onViewLogs}
          />
        </div>

        {post.status === "pending_review" && (
          <button
            onClick={onReview}
            className="rounded-lg bg-warning px-3 py-1.5 text-xs font-semibold text-warning-foreground transition-colors hover:bg-warning/90"
          >
            Review &amp; Approve
          </button>
        )}

        {confirm && (
          <ConfirmBar
            kind={confirm}
            post={post}
            pending={cancelMutation.isPending || deleteMutation.isPending}
            onDismiss={() => setConfirm(null)}
            onConfirm={() =>
              confirm === "delete" ? deleteMutation.mutate() : cancelMutation.mutate()
            }
          />
        )}
        {actions.actionError && (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
            {actions.actionError}
          </p>
        )}
      </div>
    </Card>
  );
}

/* ── Compact view ──────────────────────────────────────────────────────────
 * One line per post for scanning many runs. Same actions, no banners.
 */
function PostCompactRow({
  post,
  isAdmin,
  highlighted,
  onImageClick,
  onReview,
  onViewLogs,
}: {
  post: PostDTO;
  isAdmin: boolean;
  highlighted?: boolean;
  onImageClick: (url: string) => void;
  onReview: () => void;
  onViewLogs: () => void;
}) {
  const actions = usePostActions(post);
  const { asset, confirm, setConfirm, cancelMutation, deleteMutation } = actions;

  return (
    <div
      id={`post-${post.id}`}
      className={cn(
        "rounded-lg border border-border bg-card transition-shadow duration-300",
        highlighted && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border bg-secondary">
          {asset?.url ? (
            <button
              className="h-full w-full cursor-zoom-in"
              onClick={() => onImageClick(asset.url)}
              title="Click to view full size"
            >
              <img
                src={asset.url}
                alt={post.input.prompt ?? "generated image"}
                className="h-full w-full object-cover"
              />
            </button>
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground/90">{postSummary(post)}</p>
          <p className="truncate text-xs">
            <StatusHint post={post} actions={actions} />
          </p>
        </div>

        <div className="hidden shrink-0 md:block">
          <StatusBadge status={post.status} />
        </div>

        <span className="hidden shrink-0 text-xs text-muted-foreground/50 lg:block">
          {new Date(post.createdAt).toLocaleDateString(undefined, {
            month: "short", day: "numeric",
          })}
        </span>

        {post.status === "pending_review" && (
          <button
            onClick={onReview}
            className="shrink-0 rounded-md bg-warning px-2.5 py-1 text-xs font-semibold text-warning-foreground transition-colors hover:bg-warning/90"
          >
            Review
          </button>
        )}

        <PostActionIcons
          actions={actions}
          isAdmin={isAdmin}
          loggable={LOGGABLE_STATUSES.has(post.status)}
          onViewLogs={onViewLogs}
        />
      </div>

      {confirm && (
        <div className="px-3 pb-2">
          <ConfirmBar
            kind={confirm}
            post={post}
            pending={cancelMutation.isPending || deleteMutation.isPending}
            onDismiss={() => setConfirm(null)}
            onConfirm={() =>
              confirm === "delete" ? deleteMutation.mutate() : cancelMutation.mutate()
            }
          />
        </div>
      )}
      {actions.actionError && (
        <p className="flex items-start gap-1.5 px-3 pb-2 text-xs text-destructive">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
          {actions.actionError}
        </p>
      )}
    </div>
  );
}

function ReviewModal({
  post,
  onClose,
  onApprove,
  onReject,
  isPending,
  error,
}: {
  post: PostDTO;
  onClose: () => void;
  onApprove: (opts: { scheduledAt?: string; scheduleMode: "instant" | "scheduled" }) => void;
  onReject: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const { data: asset } = useQuery<AssetDTO>({
    queryKey: ["asset", post.primaryAssetId],
    queryFn: () => api.getAsset(post.primaryAssetId!),
    enabled: !!post.primaryAssetId,
  });

  const [imageZoomed, setImageZoomed] = useState(false);

  // Initialise from the post's existing schedule (set by compose form / planner)
  const [scheduleMode, setScheduleMode] = useState<"instant" | "scheduled">(
    post.schedule?.mode === "scheduled" && post.schedule?.runAt ? "scheduled" : "instant",
  );
  const [publishAt, setPublishAt] = useState<Date | null>(
    post.schedule?.runAt ? new Date(post.schedule.runAt) : null,
  );

  function handleApprove() {
    if (scheduleMode === "scheduled" && publishAt && publishAt > new Date()) {
      onApprove({ scheduleMode: "scheduled", scheduledAt: publishAt.toISOString() });
    } else {
      onApprove({ scheduleMode: "instant" });
    }
  }

  const approveLabel =
    isPending
      ? "Processing…"
      : scheduleMode === "scheduled" && publishAt
      ? `Schedule · ${publishAt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
      : "Approve & Publish Now";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-lg border border-border bg-card shadow-elevate-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Review & Approve</h2>
            <p className="text-sm text-muted-foreground">
              Review the content, then choose when to publish.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto">
          <div className="p-6 space-y-5">
            {/* Image preview — click to fullscreen */}
            {asset?.url ? (
              <button
                className="group relative w-full cursor-zoom-in overflow-hidden rounded-xl bg-secondary/50"
                onClick={() => setImageZoomed(true)}
                title="Click to view full size"
              >
                <img
                  src={asset.url}
                  alt="Generated content"
                  className="w-full max-h-72 object-contain"
                />
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 transition-colors group-hover:bg-black/25">
                  <ZoomIn className="h-8 w-8 text-white opacity-0 drop-shadow-lg transition-opacity group-hover:opacity-100" />
                </div>
              </button>
            ) : (
              <div className="flex h-40 items-center justify-center rounded-xl bg-secondary">
                <ImageIcon className="h-10 w-10 text-muted-foreground/30" />
              </div>
            )}

            {/* Fullscreen image overlay */}
            {imageZoomed && asset?.url && (
              <div
                className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm"
                onClick={() => setImageZoomed(false)}
              >
                <button
                  className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition-colors"
                  onClick={() => setImageZoomed(false)}
                  aria-label="Close fullscreen"
                >
                  <X className="h-5 w-5" />
                </button>
                <img
                  src={asset.url}
                  alt="Full-size preview"
                  className="max-h-[95vh] max-w-[95vw] object-contain shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}

            {/* Caption */}
            {post.caption?.text && (
              <div className="rounded-xl border border-border bg-secondary/40 px-4 py-3">
                <p className="mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Caption
                </p>
                <p className="text-sm">{post.caption.text}</p>
                {post.caption.hashtags?.length > 0 && (
                  <p className="mt-1.5 text-xs text-primary/70">
                    {post.caption.hashtags.map((h) => `#${h}`).join(" ")}
                  </p>
                )}
              </div>
            )}

            {/* Targets */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Publishing to:</span>
              {post.targets.map((t) => (
                <span
                  key={t.platform}
                  className="rounded-full border border-border px-2 py-0.5 capitalize"
                >
                  {t.platform}
                </span>
              ))}
            </div>

            {/* ── Publish time ────────────────────────────────────────── */}
            <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3">
              <p className="text-sm font-medium">When to publish</p>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleMode("instant")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    scheduleMode === "instant"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary/50",
                  )}
                >
                  <Send className="h-3.5 w-3.5" />
                  Publish now
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleMode("scheduled")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    scheduleMode === "scheduled"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary/50",
                  )}
                >
                  <Clock className="h-3.5 w-3.5" />
                  Schedule
                </button>
              </div>

              {scheduleMode === "scheduled" && (
                <div className="space-y-2">
                  <InlineCalendar
                    value={publishAt}
                    onChange={setPublishAt}
                    minDate={new Date()}
                  />
                  {publishAt && publishAt > new Date() && (
                    <p className="text-xs text-muted-foreground">
                      Post will auto-publish on{" "}
                      <span className="text-foreground font-medium">
                        {publishAt.toLocaleString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </p>
                  )}
                  {publishAt && publishAt <= new Date() && (
                    <p className="text-xs text-warning">
                      Selected time is in the past — pick a future date.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 border-t border-border px-6 py-4">
          <button
            disabled={
              isPending ||
              (scheduleMode === "scheduled" && (!publishAt || publishAt <= new Date()))
            }
            onClick={handleApprove}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-success py-3 text-sm font-semibold text-success-foreground hover:bg-success/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <CheckCircle className="h-4 w-4" />
            {approveLabel}
          </button>
          <button
            disabled={isPending}
            onClick={onReject}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-secondary py-3 text-sm font-semibold text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 disabled:opacity-50 transition-colors"
          >
            <XCircle className="h-4 w-4" />
            {isPending ? "Processing…" : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}
