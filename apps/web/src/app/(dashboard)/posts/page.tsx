"use client";

import { useQuery } from "@tanstack/react-query";
import type { AssetDTO, PostDTO } from "@visora/shared";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { ImageIcon } from "lucide-react";

export default function PostsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["posts"],
    queryFn: () => api.listPosts(1),
    refetchInterval: 5000,
  });

  return (
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
        {data?.items.map((post) => <PostRow key={post.id} post={post} />)}
        {data && data.items.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            No posts yet. Head to Compose to create one.
          </Card>
        )}
      </div>
    </div>
  );
}

function PostRow({ post }: { post: PostDTO }) {
  const { data: asset } = useQuery<AssetDTO>({
    queryKey: ["asset", post.primaryAssetId],
    queryFn: () => api.getAsset(post.primaryAssetId!),
    enabled: !!post.primaryAssetId,
  });

  return (
    <Card className="flex items-center gap-4 p-4">
      {/* Thumbnail */}
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-secondary">
        {asset?.url ? (
          <img
            src={asset.url}
            alt={post.input.prompt ?? "generated image"}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-secondary px-2 py-0.5 text-xs capitalize text-secondary-foreground">
            {post.workflow.replace("_", " ")}
          </span>
          <StatusBadge status={post.status} />
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
    </Card>
  );
}
