"use client";

import { useQuery } from "@tanstack/react-query";
import type { AssetDTO, PostDTO, WorkflowType } from "@visora/shared";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { AlertCircle, CheckCircle, ImageIcon, XCircle, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

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

  // Stock photo that was subsequently AI-enhanced: show original provider + AI Enhanced
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

  // ai_enhance workflow: user uploaded then AI-edited
  if (source === "dalle3" && workflow === "ai_enhance") return <Chip metaKey="dalle3_enhance" />;

  // ai_generate workflow
  if (source === "dalle3") return <Chip metaKey="dalle3_generate" />;

  // all other sources map directly
  return <Chip metaKey={source} />;
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

  const closeLightbox = useCallback(() => setLightboxUrl(null), []);

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.approvePost(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["posts"] }); setReviewPost(null); },
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.rejectPost(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["posts"] }); setReviewPost(null); },
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
    if (!lightboxUrl && !reviewPost) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { closeLightbox(); closeReview(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxUrl, reviewPost, closeLightbox, closeReview]);

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
          onApprove={() => approveMutation.mutate(reviewPost.id)}
          onReject={() => rejectMutation.mutate(reviewPost.id)}
          isPending={approveMutation.isPending || rejectMutation.isPending}
          error={reviewError}
        />
      )}
    </>
  );
}

function PostRow({
  post,
  onImageClick,
  onReview,
}: {
  post: PostDTO;
  onImageClick: (url: string) => void;
  onReview: () => void;
}) {
  const { data: asset } = useQuery<AssetDTO>({
    queryKey: ["asset", post.primaryAssetId],
    queryFn: () => api.getAsset(post.primaryAssetId!),
    enabled: !!post.primaryAssetId,
  });

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

      {/* Pending review — prompt the user to approve or reject */}
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

      {/* Error banner — only shown when status is failed and lastError is present */}
      {post.status === "failed" && post.lastError && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{post.lastError}</span>
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
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const { data: asset } = useQuery<AssetDTO>({
    queryKey: ["asset", post.primaryAssetId],
    queryFn: () => api.getAsset(post.primaryAssetId!),
    enabled: !!post.primaryAssetId,
  });

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
              Approve to publish, or reject to discard.
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

        {/* Image preview */}
        <div className="p-6 space-y-5">
          {asset?.url ? (
            <img
              src={asset.url}
              alt="Generated content"
              className="w-full max-h-80 rounded-xl object-contain bg-secondary/50"
            />
          ) : (
            <div className="flex h-48 items-center justify-center rounded-xl bg-secondary">
              <ImageIcon className="h-10 w-10 text-muted-foreground/30" />
            </div>
          )}

          {/* Caption */}
          {post.caption?.text && (
            <div className="rounded-xl border border-border bg-secondary/40 px-4 py-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">Caption</p>
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
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 border-t border-border px-6 py-4">
          <button
            disabled={isPending}
            onClick={onApprove}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-50 transition-colors"
          >
            <CheckCircle className="h-4 w-4" />
            {isPending ? "Processing…" : "Approve & Publish"}
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
