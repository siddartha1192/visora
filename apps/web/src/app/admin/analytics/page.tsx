"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi, type AnalyticsData } from "@/lib/admin-api";
import { Loader2, ImageIcon, Cpu, FileText, DollarSign, CheckCircle2, XCircle, Clock, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

type Range = "7d" | "30d" | "90d" | "all";

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(n: number) {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

const WORKFLOW_LABELS: Record<string, string> = {
  ai_generate:     "AI Generate",
  ai_enhance:      "AI Enhance",
  stock_discovery: "Stock",
  scrape:          "Scrape",
  autonomous:      "Autonomous",
  passthrough:     "Passthrough",
};

const STATUS_COLORS: Record<string, string> = {
  published:      "bg-success/15 text-success",
  failed:         "bg-destructive/15 text-destructive",
  pending_review: "bg-warning/15 text-warning",
  cancelled:      "bg-slate-500/15 text-slate-400",
  rejected:       "bg-orange-500/15 text-orange-400",
  processing:     "bg-primary/15 text-primary",
  queued:         "bg-indigo-500/15 text-indigo-400",
  scheduled:      "bg-violet-500/15 text-violet-400",
  ready:          "bg-cyan-500/15 text-cyan-400",
  draft:          "bg-zinc-500/15 text-zinc-400",
  publishing:     "bg-sky-500/15 text-sky-400",
};

const WORKFLOW_COLORS: Record<string, string> = {
  ai_generate:     "bg-primary",
  ai_enhance:      "bg-violet-500",
  stock_discovery: "bg-cyan-500",
  scrape:          "bg-amber-500",
  autonomous:      "bg-emerald-500",
  passthrough:     "bg-slate-500",
};

const PROVIDER_COLORS: Record<string, string> = {
  openai:    "bg-emerald-500/15 text-emerald-400",
  anthropic: "bg-orange-500/15 text-orange-400",
  google:    "bg-blue-500/15 text-blue-400",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, accent }: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  accent?: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-border bg-secondary/10 p-5 text-center">
      <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg", accent ?? "bg-secondary/50")}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <p className="mt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-[-0.02em]">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary/40">
      <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>("30d");

  const { data, isLoading, isError } = useQuery<AnalyticsData>({
    queryKey: ["admin-analytics", range],
    queryFn: () => adminApi.getAnalytics(range),
    staleTime: 60_000,
  });

  const ov = data?.overview;
  const successRate = ov && ov.totalPosts > 0
    ? ((ov.publishedPosts / ov.totalPosts) * 100).toFixed(1)
    : "—";
  const totalTokens = ov ? ov.totalPromptTokens + ov.totalCompletionTokens : 0;
  const maxWorkflow = Math.max(...(data?.byWorkflow.map((w) => w.count) ?? [1]));

  const RANGES: { value: Range; label: string }[] = [
    { value: "7d",  label: "7 days"  },
    { value: "30d", label: "30 days" },
    { value: "90d", label: "90 days" },
    { value: "all", label: "All time" },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Analytics</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Platform usage, token consumption, and post metrics</p>
        </div>
        <div className="flex rounded-lg border border-border p-1 gap-1">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                range === r.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
          Failed to load analytics. Make sure the API server is running.
        </div>
      )}

      {data && ov && (
        <>
          {/* ── Overview cards ────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Total Posts"    value={String(ov.totalPosts)}     sub={`${successRate}% success rate`}  icon={FileText}     accent="bg-secondary/50" />
            <StatCard label="Published"      value={String(ov.publishedPosts)} sub="successfully delivered"           icon={CheckCircle2} accent="bg-success/15 text-success" />
            <StatCard label="Failed"         value={String(ov.failedPosts)}    sub={`${ov.rejectedPosts} rejected`}   icon={XCircle}      accent="bg-destructive/15 text-destructive" />
            <StatCard label="Pending Review" value={String(ov.pendingReviewPosts)} sub="awaiting approval"            icon={Clock}        accent="bg-warning/15 text-warning" />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Prompt Tokens"     value={fmt(ov.totalPromptTokens)}     sub="input tokens consumed"    icon={BarChart3} />
            <StatCard label="Completion Tokens" value={fmt(ov.totalCompletionTokens)} sub="output tokens generated"  icon={BarChart3} />
            <StatCard label="Total Cost"        value={fmtCost(ov.totalCostUsd)}      sub="across all models"        icon={DollarSign} accent="bg-violet-500/15 text-violet-400" />
            <StatCard label="Images Generated"  value={fmt(ov.totalImagesGenerated)}  sub="via generation nodes"     icon={ImageIcon}  accent="bg-cyan-500/15 text-cyan-400" />
          </div>

          {/* ── Breakdown row ──────────────────────────────────────────────── */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Posts by workflow */}
            <div className="rounded-xl border border-border">
              <div className="border-b border-border px-5 py-4">
                <h2 className="text-sm font-medium">Posts by Workflow</h2>
              </div>
              <div className="space-y-4 px-5 py-4">
                {data.byWorkflow.length === 0 && (
                  <p className="text-sm text-muted-foreground">No posts in range.</p>
                )}
                {data.byWorkflow.map((w) => (
                  <div key={w.workflow} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{WORKFLOW_LABELS[w.workflow] ?? w.workflow}</span>
                      <span className="tabular-nums text-muted-foreground">{w.count}</span>
                    </div>
                    <MiniBar value={w.count} max={maxWorkflow} color={WORKFLOW_COLORS[w.workflow] ?? "bg-primary"} />
                  </div>
                ))}
              </div>
            </div>

            {/* Posts by status */}
            <div className="rounded-xl border border-border">
              <div className="border-b border-border px-5 py-4">
                <h2 className="text-sm font-medium">Posts by Status</h2>
              </div>
              <div className="px-5 py-4">
                {data.byStatus.length === 0 && (
                  <p className="text-sm text-muted-foreground">No posts in range.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {data.byStatus.map((s) => (
                    <div
                      key={s.status}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border border-white/5 px-3 py-2",
                        STATUS_COLORS[s.status] ? STATUS_COLORS[s.status].split(" ")[0] + "/10" : "bg-secondary/20",
                      )}
                    >
                      <span className={cn("text-xs font-medium", STATUS_COLORS[s.status]?.split(" ")[1])}>
                        {s.status.replace(/_/g, " ")}
                      </span>
                      <span className="text-sm font-bold tabular-nums">{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Token usage by model ────────────────────────────────────────── */}
          <div className="rounded-xl border border-border">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-medium">Token Usage by Model</h2>
            </div>
            {data.byModel.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">No model usage data in range.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3">Provider</th>
                    <th className="px-4 py-3">Model</th>
                    <th className="px-4 py-3 text-right">Prompt Tokens</th>
                    <th className="px-4 py-3 text-right">Completion</th>
                    <th className="px-4 py-3 text-right">Images</th>
                    <th className="px-4 py-3 text-right">Cost</th>
                    <th className="px-4 py-3 text-right">Requests</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.byModel.map((m, i) => (
                    <tr key={i} className="hover:bg-secondary/20 transition-colors">
                      <td className="px-4 py-3">
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", PROVIDER_COLORS[m.provider] ?? "bg-secondary/30 text-muted-foreground")}>
                          {m.provider}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{m.model}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{m.promptTokens > 0 ? fmt(m.promptTokens) : <span className="text-muted-foreground/40">—</span>}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{m.completionTokens > 0 ? fmt(m.completionTokens) : <span className="text-muted-foreground/40">—</span>}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{m.imagesGenerated > 0 ? m.imagesGenerated : <span className="text-muted-foreground/40">—</span>}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{fmtCost(m.costUsd)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{m.requests}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border bg-secondary/10 text-xs font-semibold">
                    <td className="px-4 py-3 text-muted-foreground" colSpan={2}>Total</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmt(ov.totalPromptTokens)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmt(ov.totalCompletionTokens)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{ov.totalImagesGenerated > 0 ? ov.totalImagesGenerated : "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtCost(ov.totalCostUsd)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {data.byModel.reduce((a, m) => a + m.requests, 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* ── Per-user analytics ─────────────────────────────────────────── */}
          <div className="rounded-xl border border-border">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-medium">Per-User Analytics</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Token consumption and post outcomes per account</p>
            </div>
            {data.byUser.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">No activity in range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/30 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3 text-right">Posts</th>
                      <th className="px-4 py-3 text-right">Published</th>
                      <th className="px-4 py-3 text-right">Failed</th>
                      <th className="px-4 py-3 text-right">Pending</th>
                      <th className="px-4 py-3">Workflows</th>
                      <th className="px-4 py-3 text-right">Tokens</th>
                      <th className="px-4 py-3 text-right">Images</th>
                      <th className="px-4 py-3 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.byUser.map((u) => {
                      const published = u.byStatus["published"] ?? 0;
                      const failed    = u.byStatus["failed"]    ?? 0;
                      const pending   = u.byStatus["pending_review"] ?? 0;
                      const userTokens = u.promptTokens + u.completionTokens;
                      const workflows = Object.entries(u.byWorkflow)
                        .sort(([, a], [, b]) => b - a)
                        .slice(0, 3);

                      return (
                        <tr key={u.userId} className="hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-3">
                            <p className="font-medium leading-none">{u.name}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{u.email}</p>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-medium">{u.totalPosts}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-success">{published || <span className="text-muted-foreground/40">—</span>}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-destructive">{failed || <span className="text-muted-foreground/40">—</span>}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-warning">{pending || <span className="text-muted-foreground/40">—</span>}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {workflows.map(([wf, cnt]) => (
                                <span
                                  key={wf}
                                  className="rounded-full bg-secondary/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                                >
                                  {WORKFLOW_LABELS[wf] ?? wf} {cnt}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{userTokens > 0 ? fmt(userTokens) : <span className="opacity-40">—</span>}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{u.imagesGenerated > 0 ? u.imagesGenerated : <span className="opacity-40">—</span>}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-medium">{u.costUsd > 0 ? fmtCost(u.costUsd) : <span className="text-muted-foreground/40">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
