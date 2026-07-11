"use client";

import { useQuery } from "@tanstack/react-query";
import type { AssetDTO, PostDTO, WorkflowType } from "@visora/shared";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { InlineCalendar } from "@/components/ui/inline-calendar";
import { LogDrawer } from "@/components/ui/log-drawer";
import { api } from "@/lib/api";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  ImageIcon,
  Send,
  XCircle,
  X,
  ScrollText,
  ZoomIn,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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

export default function PostsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["posts"],
    queryFn: () => api.listPosts(1),
    refetchInterval: 5000,
  });

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [reviewPost, setReviewPost] = useState<PostDTO | null>(null);
  const [logPost, setLogPost] = useState<PostDTO | null>(null);

  const closeLightbox = useCallback(() => setLightboxUrl(null), []);

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
    if (!lightboxUrl && !reviewPost && !logPost) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { closeLightbox(); closeReview(); setLogPost(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxUrl, reviewPost, logPost, closeLightbox, closeReview]);

  return (
    <>
      <div className="mx-auto max-w-4xl space-y-6">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">Posts</h1>
          <p className="text-muted-foreground">
            Every run, with live status as the agent graph progresses.
          </p>
        </header>

        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {error && (
          <p className="text-red-300">
            {(error as Error).message} — is the API running on :4000?
          </p>
        )}

        <div className="space-y-3">
          {data?.items.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              onImageClick={setLightboxUrl}
              onReview={() => setReviewPost(post)}
              onViewLogs={() => setLogPost(post)}
            />
          ))}
          {data && data.items.length === 0 && (
            <Card className="p-8 text-center text-muted-foreground">
              No posts yet. Head to Compose to create one.
            </Card>
          )}
        </div>
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={closeLightbox}
        >
          <button
            className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
            onClick={closeLightbox}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxUrl}
            alt="Full-size preview"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
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

      {/* Log drawer */}
      {logPost && (
        <LogDrawer
          postId={logPost.id}
          postWorkflow={logPost.workflow}
          onClose={() => setLogPost(null)}
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

function PostRow({
  post,
  onImageClick,
  onReview,
  onViewLogs,
}: {
  post: PostDTO;
  onImageClick: (url: string) => void;
  onReview: () => void;
  onViewLogs: () => void;
}) {
  const { data: asset } = useQuery<AssetDTO>({
    queryKey: ["asset", post.primaryAssetId],
    queryFn: () => api.getAsset(post.primaryAssetId!),
    enabled: !!post.primaryAssetId,
  });

  const isScheduledReady =
    post.status === "ready" &&
    post.schedule?.mode === "scheduled" &&
    !!post.schedule?.runAt;

  const { label: countdownLabel, overdue } = useCountdown(
    isScheduledReady ? post.schedule?.runAt : undefined,
  );

  return (
    <Card className="flex flex-col gap-3 p-4">
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

        {/* Targets + date */}
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
        </div>
      </div>

      {/* Pending review */}
      {post.status === "pending_review" && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
          <p className="text-xs text-yellow-300">
            Content is ready — review the image and caption before publishing.
          </p>
          <button
            onClick={onReview}
            className="shrink-0 rounded-lg bg-yellow-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-yellow-400 transition-colors"
          >
            Review & Approve
          </button>
        </div>
      )}

      {/* Scheduled ready — countdown or publishing spinner */}
      {isScheduledReady && (
        overdue ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
            <p className="text-xs text-emerald-300">Publishing to platforms…</p>
          </div>
        ) : countdownLabel ? (
          <div className="flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2">
            <Clock className="h-3.5 w-3.5 shrink-0 text-blue-400" />
            <p className="text-xs text-blue-300">
              Approved · auto-publishes{" "}
              <span className="font-semibold">{countdownLabel}</span>
              {" "}
              <span className="text-blue-400/70">
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
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{post.lastError}</span>
        </div>
      )}

      {/* View Logs button — shown for any post that has entered the pipeline */}
      {LOGGABLE_STATUSES.has(post.status) && (
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
        className="relative w-full max-w-2xl rounded-2xl border border-border bg-background shadow-2xl"
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
                    <p className="text-xs text-amber-400">
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
          <div className="mx-6 mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
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
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <CheckCircle className="h-4 w-4" />
            {approveLabel}
          </button>
          <button
            disabled={isPending}
            onClick={onReject}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-secondary py-3 text-sm font-semibold text-muted-foreground hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/30 disabled:opacity-50 transition-colors"
          >
            <XCircle className="h-4 w-4" />
            {isPending ? "Processing…" : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}
