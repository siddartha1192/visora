"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi, type LlmConfig, type LlmRef } from "@/lib/admin-api";
import { CheckCircle2, Loader2, Brain, Type, Wand2, Sparkles, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const LLM_NODES: Array<{
  key: "planner" | "caption" | "generation" | "enhancement";
  label: string;
  description: string;
  icon: React.ElementType;
  type: "text" | "image";
}> = [
  { key: "planner",     label: "Planner",     description: "Resolves workflow and platform targets from brief",    icon: Brain,    type: "text" },
  { key: "caption",     label: "Caption",     description: "Writes captions and hashtags for the post",           icon: Type,     type: "text" },
  { key: "generation",  label: "Generation",  description: "Generates images from a text prompt (DALL-E)",        icon: Wand2,    type: "image" },
  { key: "enhancement", label: "Enhancement", description: "Edits and enhances existing images via AI",           icon: Sparkles, type: "image" },
];

const TYPE_HINT: Record<string, string> = {
  text:  "needs a chat/text model",
  image: "needs an image-generation model",
};

export default function NodesPage() {
  const queryClient = useQueryClient();
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const { data: nodeConfig, isLoading: configLoading } = useQuery({
    queryKey: ["admin-node-config"],
    queryFn: adminApi.getNodeConfig,
  });

  const { data: llmConfigs = [], isLoading: llmsLoading } = useQuery({
    queryKey: ["admin-llms"],
    queryFn: adminApi.listLlmConfigs,
  });

  const activeConfigs = llmConfigs.filter((c) => c.isActive);

  // Seed local state when server data loads
  useEffect(() => {
    if (!nodeConfig) return;
    const map: Record<string, string> = {};
    for (const node of LLM_NODES) {
      const ref = nodeConfig.assignments[node.key] as LlmRef | null;
      if (ref) map[node.key] = ref.id;
    }
    setAssignments(map);
  }, [nodeConfig]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, string | null> = {};
      for (const node of LLM_NODES) {
        payload[node.key] = assignments[node.key] ?? null;
      }
      return adminApi.updateNodeConfig(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-node-config"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (e: Error) => setError(e.message),
  });

  const isLoading = configLoading || llmsLoading;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Node Config</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Assign which LLM provider each pipeline node uses.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : activeConfigs.length === 0 ? (
        <div className="rounded-xl border border-border bg-secondary/20 p-8 text-center">
          <p className="text-sm text-muted-foreground">No active LLM configs available.</p>
          <p className="mt-1 text-xs text-muted-foreground/60">Go to <strong>LLM Configs</strong> to add and activate a provider first.</p>
        </div>
      ) : (
        <>
          {/* Node assignment cards */}
          <div className="space-y-3">
            {LLM_NODES.map(({ key, label, description, icon: Icon, type }) => {
              const selected = assignments[key];
              return (
                <div key={key} className="flex items-center gap-4 rounded-xl border border-border bg-secondary/10 p-4">
                  {/* Node info */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{label}</span>
                        <span className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                          type === "text"  ? "bg-blue-500/15 text-blue-400"   : "bg-purple-500/15 text-purple-400",
                        )}>
                          {TYPE_HINT[type]}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
                    </div>
                  </div>

                  {/* Dropdown */}
                  <select
                    value={selected ?? ""}
                    onChange={(e) =>
                      setAssignments((prev) => ({
                        ...prev,
                        [key]: e.target.value || "",
                      }))
                    }
                    className="w-48 shrink-0 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">— Not assigned —</option>
                    {activeConfigs.map((cfg) => (
                      <option key={cfg.id} value={cfg.id}>
                        {cfg.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          {/* Save bar */}
          <div className="flex items-center justify-between border-t border-border pt-4">
            {error && (
              <p className="flex items-center gap-1.5 text-sm text-red-400"><AlertCircle className="h-3.5 w-3.5" />{error}</p>
            )}
            {saved && !error && (
              <p className="flex items-center gap-1.5 text-sm text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" />Saved</p>
            )}
            {!saved && !error && <span />}
            <button
              onClick={() => { setError(""); saveMutation.mutate(); }}
              disabled={saveMutation.isPending}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saveMutation.isPending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
