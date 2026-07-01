"use client";

import { useQuery } from "@tanstack/react-query";
import type { AssetDTO } from "@visora/shared";
import { api } from "@/lib/api";
import { useCallback, useEffect, useState } from "react";
import { Download, X, ZoomIn } from "lucide-react";

const KIND_FILTERS = [
  { label: "All", value: undefined },
  { label: "AI Generated", value: "ai_generated" },
  { label: "Enhanced", value: "enhanced" },
  { label: "Uploads", value: "upload" },
  { label: "Stock", value: "stock" },
  { label: "Scraped", value: "scraped" },
] as const;

const KIND_LABELS: Record<string, string> = {
  upload: "Upload",
  ai_generated: "AI",
  enhanced: "Enhanced",
  stock: "Stock",
  scraped: "Scraped",
};

const KIND_COLORS: Record<string, string> = {
  upload: "bg-blue-500/20 text-blue-300",
  ai_generated: "bg-purple-500/20 text-purple-300",
  enhanced: "bg-amber-500/20 text-amber-300",
  stock: "bg-green-500/20 text-green-300",
  scraped: "bg-rose-500/20 text-rose-300",
};

export default function LibraryPage() {
  const [kind, setKind] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [lightbox, setLightbox] = useState<AssetDTO | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["assets", kind, page],
    queryFn: () => api.listAssets({ kind, page }),
    placeholderData: (prev) => prev,
  });

  const closeLightbox = useCallback(() => setLightbox(null), []);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeLightbox(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, closeLightbox]);

  // Reset to page 1 when filter changes
  useEffect(() => { setPage(1); }, [kind]);

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1;

  return (
    <>
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">Library</h1>
          <p className="text-muted-foreground">
            Every asset the agents have produced, with per-platform variants.
          </p>
        </header>

        {/* Kind filter tabs */}
        <div className="flex flex-wrap gap-2">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.label}
              onClick={() => setKind(f.value)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                kind === f.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/70"
              }`}
            >
              {f.label}
            </button>
          ))}
          {data && (
            <span className="ml-auto self-center text-xs text-muted-foreground">
              {data.total} asset{data.total !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* States */}
        {isLoading && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square animate-pulse rounded-xl bg-secondary"
              />
            ))}
          </div>
        )}

        {error && (
          <p className="text-red-300 text-sm">
            Failed to load assets: {(error as Error).message}
          </p>
        )}

        {data && data.items.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-24 text-center">
            <p className="text-lg font-medium text-muted-foreground">No assets yet</p>
            <p className="mt-1 text-sm text-muted-foreground/60">
              Generate or upload content from the Compose page.
            </p>
          </div>
        )}

        {/* Grid */}
        {data && data.items.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {data.items.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                onClick={() => setLightbox(asset)}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg bg-secondary px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-muted-foreground">
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg bg-secondary px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={closeLightbox}
        >
          {/* Close */}
          <button
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={closeLightbox}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Download */}
          <a
            href={lightbox.url}
            download
            target="_blank"
            rel="noreferrer"
            className="absolute right-14 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={(e) => e.stopPropagation()}
            aria-label="Download"
          >
            <Download className="h-5 w-5" />
          </a>

          <div
            className="flex max-h-[90vh] max-w-2xl flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightbox.url}
              alt={lightbox.origin.prompt ?? "asset"}
              className="max-h-[75vh] w-full rounded-xl object-contain shadow-2xl"
            />
            <div className="rounded-xl bg-white/5 px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_COLORS[lightbox.kind] ?? "bg-secondary text-secondary-foreground"}`}
                >
                  {KIND_LABELS[lightbox.kind] ?? lightbox.kind}
                </span>
                <span className="text-muted-foreground text-xs">
                  {(lightbox.bytes / 1024).toFixed(0)} KB
                  {lightbox.width ? ` · ${lightbox.width}×${lightbox.height}` : ""}
                </span>
                <span className="ml-auto text-xs text-muted-foreground/60">
                  {new Date(lightbox.createdAt).toLocaleString()}
                </span>
              </div>
              {lightbox.origin.prompt && (
                <p className="mt-2 text-muted-foreground line-clamp-3">
                  {lightbox.origin.prompt}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AssetCard({
  asset,
  onClick,
}: {
  asset: AssetDTO;
  onClick: () => void;
}) {
  return (
    <button
      className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-secondary transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onClick={onClick}
    >
      <img
        src={asset.url}
        alt={asset.origin.prompt ?? asset.kind}
        className="h-full w-full object-cover"
        loading="lazy"
      />

      {/* Hover overlay */}
      <div className="absolute inset-0 flex flex-col justify-between bg-black/0 p-2 opacity-0 transition-all group-hover:bg-black/50 group-hover:opacity-100">
        <span
          className={`self-start rounded-full px-2 py-0.5 text-[10px] font-medium ${KIND_COLORS[asset.kind] ?? "bg-secondary text-secondary-foreground"}`}
        >
          {KIND_LABELS[asset.kind] ?? asset.kind}
        </span>
        <div className="flex items-end justify-between gap-1">
          <p className="line-clamp-2 text-left text-[10px] text-white/80">
            {asset.origin.prompt ?? asset.origin.sourceUrl ?? ""}
          </p>
          <ZoomIn className="h-4 w-4 shrink-0 text-white/70" />
        </div>
      </div>
    </button>
  );
}
