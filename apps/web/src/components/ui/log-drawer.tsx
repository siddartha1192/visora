"use client";

import { useQuery } from "@tanstack/react-query";
import { api, type LogEntry, type LogsResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useState } from "react";
import {
  X,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Zap,
  Database,
  Brain,
  GitBranch,
  ImageIcon,
  Wand2,
  Sparkles,
  Search,
  Globe,
  Crop,
  Type,
  Eye,
  Send,
  Save,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ── Node metadata ────────────────────────────────────────────────────────────

const NODE_META: Record<string, { label: string; Icon: LucideIcon }> = {
  pipeline:    { label: "Pipeline",         Icon: Zap },
  ingest:      { label: "Ingest",           Icon: Database },
  planner:     { label: "Planner (AI)",     Icon: Brain },
  router:      { label: "Router",           Icon: GitBranch },
  passthrough: { label: "Pass-through",     Icon: ImageIcon },
  generation:  { label: "Image Generation", Icon: Wand2 },
  enhancement: { label: "AI Enhancement",   Icon: Sparkles },
  stock:       { label: "Stock Search",     Icon: Search },
  scraping:    { label: "Web Scraper",      Icon: Globe },
  optimization:{ label: "Optimisation",     Icon: Crop },
  caption:     { label: "Caption (AI)",     Icon: Type },
  review:      { label: "Review Gate",      Icon: Eye },
  publish:     { label: "Publish",          Icon: Send },
  persist:     { label: "Finalise",         Icon: Save },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number | null) {
  if (ms === null) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Merges "started" + terminal events for the same sequence+node into one row.
 * A row is "pending" when only the "started" entry has arrived so far.
 */
function processLogs(logs: LogEntry[]) {
  const map = new Map<string, { started?: LogEntry; terminal?: LogEntry }>();

  for (const log of logs) {
    const key = `${log.node}-${log.sequence}`;
    const slot = map.get(key) ?? {};
    if (log.status === "started") slot.started = log;
    else slot.terminal = log;
    map.set(key, slot);
  }

  return Array.from(map.values())
    .map(({ started, terminal }) => ({
      entry: terminal ?? started!,
      isPending: !terminal && !!started,
    }))
    .sort((a, b) => {
      const ds = a.entry.sequence - b.entry.sequence;
      if (ds !== 0) return ds;
      return new Date(a.entry.createdAt).getTime() - new Date(b.entry.createdAt).getTime();
    });
}

// ── Single log row ───────────────────────────────────────────────────────────

function LogRow({ entry, isPending }: { entry: LogEntry; isPending: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isPipeline = entry.node === "pipeline";
  const effectiveStatus = isPending ? "started" : entry.status;
  const meta = NODE_META[entry.node] ?? { label: entry.node, Icon: Zap };
  const { Icon } = meta;

  const statusStyles = {
    started:   { icon: "text-blue-400 animate-spin",   row: "border-blue-500/20 bg-blue-500/5"    },
    succeeded: { icon: "text-emerald-400",              row: "border-emerald-500/15 bg-emerald-500/5" },
    failed:    { icon: "text-red-400",                  row: "border-red-500/20 bg-red-500/5"      },
    skipped:   { icon: "text-muted-foreground",         row: "border-border bg-secondary/20"        },
  }[effectiveStatus];

  const StatusIcon =
    effectiveStatus === "started"   ? Loader2 :
    effectiveStatus === "succeeded" ? CheckCircle2 :
    effectiveStatus === "failed"    ? XCircle :
    ChevronRight;

  const hasExpandableData = !isPending && entry.data && Object.keys(entry.data).length > 0;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 transition-colors",
        statusStyles.row,
        isPipeline && "ring-1 ring-inset ring-white/5",
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* Node icon (left column) */}
        <Icon className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0",
          isPipeline ? "text-primary" : "text-muted-foreground/60",
        )} />

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            {/* Node label */}
            <span className={cn(
              "text-[11px] font-semibold leading-none",
              isPipeline ? "text-foreground" : "text-muted-foreground",
            )}>
              {meta.label}
            </span>

            {/* Right: duration + expand toggle */}
            <div className="flex shrink-0 items-center gap-1.5">
              {entry.durationMs !== null && (
                <span className="font-mono text-[10px] text-muted-foreground/50">
                  {formatDuration(entry.durationMs)}
                </span>
              )}
              {hasExpandableData && (
                <button
                  onClick={() => setExpanded((e) => !e)}
                  className="rounded p-0.5 text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors"
                  title="Show details"
                >
                  {expanded
                    ? <ChevronDown className="h-3 w-3" />
                    : <ChevronRight className="h-3 w-3" />}
                </button>
              )}
              {/* Status icon */}
              <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", statusStyles.icon)} />
            </div>
          </div>

          {/* Message */}
          <p className={cn(
            "mt-1 text-xs leading-relaxed",
            entry.status === "failed" ? "text-red-300" : "text-foreground/75",
            isPending && "italic text-muted-foreground",
          )}>
            {isPending ? "Running…" : entry.message}
          </p>

          {/* Inline error detail */}
          {entry.error && !isPending && (
            <p className="mt-1 break-all font-mono text-[10px] text-red-400">
              {entry.error}
            </p>
          )}

          {/* Expandable structured data */}
          {expanded && entry.data && (
            <div className="mt-2 space-y-0.5 border-t border-white/5 pt-2">
              {Object.entries(entry.data).map(([k, v]) => (
                <div key={k} className="flex gap-2 text-[10px]">
                  <span className="w-28 shrink-0 truncate font-mono text-muted-foreground/50">
                    {k}
                  </span>
                  <span className="break-all font-mono text-foreground/60">
                    {Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Drawer ───────────────────────────────────────────────────────────────────

interface LogDrawerProps {
  postId: string;
  postWorkflow: string;
  onClose: () => void;
}

export function LogDrawer({ postId, postWorkflow, onClose }: LogDrawerProps) {
  const { data: logsData, isLoading } = useQuery<LogsResponse>({
    queryKey: ["logs", postId],
    queryFn: () => api.getLogs(postId),
    // Poll every 800 ms while the pipeline is still running; stop once done.
    refetchInterval: (query) => (!query.state.data?.done ? 800 : false),
  });

  const items = processLogs(logsData?.logs ?? []);
  const isDone = logsData?.done ?? false;
  const hasFailed = items.some((i) => i.entry.status === "failed" && i.entry.node !== "pipeline");

  const pipelineStatus =
    isLoading ? "loading" :
    !isDone    ? "running" :
    hasFailed  ? "failed"  :
                 "done";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative z-10 flex h-full w-full max-w-[420px] flex-col border-l border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Execution Logs</h2>
            <p className="mt-0.5 text-xs capitalize text-muted-foreground">
              {postWorkflow.replace(/_/g, " ")}
              <span className="ml-1.5 font-mono text-muted-foreground/40">
                ·{postId.slice(-8)}
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Status banner */}
        <div className={cn(
          "flex items-center gap-2 border-b border-border px-5 py-2.5 text-xs font-medium",
          pipelineStatus === "loading" && "text-muted-foreground",
          pipelineStatus === "running" && "bg-blue-500/5 text-blue-400",
          pipelineStatus === "done"    && "bg-emerald-500/5 text-emerald-400",
          pipelineStatus === "failed"  && "bg-red-500/5 text-red-400",
        )}>
          {pipelineStatus === "loading" && (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading logs…</>
          )}
          {pipelineStatus === "running" && (
            <><span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" /> Pipeline running — auto-refreshing</>
          )}
          {pipelineStatus === "done" && (
            <><CheckCircle2 className="h-3.5 w-3.5" /> Pipeline completed successfully</>
          )}
          {pipelineStatus === "failed" && (
            <><XCircle className="h-3.5 w-3.5" /> Pipeline finished with errors</>
          )}
        </div>

        {/* Timeline */}
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isLoading && items.length === 0 && (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No log entries yet.
              <br />
              <span className="text-xs text-muted-foreground/50">
                The pipeline may still be queued.
              </span>
            </div>
          )}

          {items.map(({ entry, isPending }) => (
            <LogRow
              key={`${entry.node}-${entry.sequence}-${entry.status}`}
              entry={entry}
              isPending={isPending}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-2.5 text-[10px] text-muted-foreground/40">
          {logsData
            ? `${logsData.logs.length} event${logsData.logs.length !== 1 ? "s" : ""}${!isDone ? " · refreshing every 800ms" : ""}`
            : "Connecting…"}
        </div>
      </div>
    </div>
  );
}
