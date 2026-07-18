"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi, type LlmConfig } from "@/lib/admin-api";
import { Plus, Trash2, ToggleLeft, ToggleRight, X, AlertCircle, Loader2, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
] as const;

const PROVIDER_COLORS: Record<string, string> = {
  openai:    "bg-emerald-500/15 text-emerald-400",
  anthropic: "bg-orange-500/15 text-orange-400",
  google:    "bg-blue-500/15 text-blue-400",
};

// ── Add LLM modal ─────────────────────────────────────────────────────────────

function AddLlmModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState<"openai" | "anthropic" | "google">("openai");
  const [apiKey, setApiKey] = useState("");
  const [chatModel, setChatModel] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      adminApi.createLlmConfig({
        label,
        provider,
        apiKey,
        ...(chatModel ? { chatModel } : {}),
        ...(imageModel ? { imageModel } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-llms"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-semibold">Add LLM Config</h2>
          <button onClick={onClose} className="rounded-full p-1 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-4">
          <Field label="Label">
            <input required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. OpenAI GPT-4o" className={inputCls} />
          </Field>

          <Field label="Provider">
            <select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)} className={inputCls}>
              {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>

          <Field label="API Key">
            <div className="relative">
              <input
                required
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className={cn(inputCls, "pr-9")}
              />
              <button type="button" onClick={() => setShowKey((v) => !v)} className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground transition-colors">
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Chat Model">
              <input value={chatModel} onChange={(e) => setChatModel(e.target.value)} placeholder="e.g. gpt-4o" className={inputCls} />
            </Field>
            <Field label="Image Model">
              <input value={imageModel} onChange={(e) => setImageModel(e.target.value)} placeholder="e.g. dall-e-3" className={inputCls} />
            </Field>
          </div>

          {error && (
            <p className="flex items-center gap-1.5 text-sm text-red-400"><AlertCircle className="h-3.5 w-3.5" />{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-border py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity">
              {mutation.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── LLMs page ─────────────────────────────────────────────────────────────────

export default function LlmsPage() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<LlmConfig | null>(null);

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ["admin-llms"],
    queryFn: adminApi.listLlmConfigs,
  });

  const toggleActive = useMutation({
    mutationFn: (cfg: LlmConfig) => adminApi.updateLlmConfig(cfg.id, { isActive: !cfg.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-llms"] }),
  });

  const deleteConfig = useMutation({
    mutationFn: (id: string) => adminApi.deleteLlmConfig(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-llms"] }); setConfirmDelete(null); },
  });

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">LLM Configs</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Manage AI provider credentials and models</p>
          </div>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity">
            <Plus className="h-4 w-4" /> Add Config
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-border">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : configs.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground">No LLM configs yet.</p>
              <p className="mt-1 text-xs text-muted-foreground/60">Add a provider to assign it to pipeline nodes.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Label</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Chat Model</th>
                  <th className="px-4 py-3">Image Model</th>
                  <th className="px-4 py-3">API Key</th>
                  <th className="px-4 py-3">Active</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {configs.map((cfg) => (
                  <tr key={cfg.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="px-4 py-3 font-medium">{cfg.label}</td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", PROVIDER_COLORS[cfg.provider] ?? "bg-secondary text-muted-foreground")}>
                        {cfg.provider}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{cfg.chatModel ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{cfg.imageModel ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground/60">{cfg.apiKeyMasked}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleActive.mutate(cfg)} className="text-muted-foreground hover:text-foreground transition-colors" title={cfg.isActive ? "Deactivate" : "Activate"}>
                        {cfg.isActive
                          ? <ToggleRight className="h-5 w-5 text-emerald-400" />
                          : <ToggleLeft className="h-5 w-5" />}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setConfirmDelete(cfg)} className="rounded p-1 text-muted-foreground/40 hover:text-red-400 transition-colors" title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showAdd && <AddLlmModal onClose={() => setShowAdd(false)} />}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setConfirmDelete(null)}>
          <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold">Delete config?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{confirmDelete.label}</span> will be removed. Any node assignments using it will become unset.
            </p>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 rounded-lg border border-border py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors">Cancel</button>
              <button onClick={() => deleteConfig.mutate(confirmDelete.id)} disabled={deleteConfig.isPending} className="flex-1 rounded-lg bg-red-500 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50 transition-colors">
                {deleteConfig.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
