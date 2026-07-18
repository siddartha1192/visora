"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  PLATFORMS,
  type Platform,
  type WorkflowType,
  type CreatePostInput,
} from "@visora/shared";
import { Wand2, Sparkles, Images, Globe, Upload, Send, Clock, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { PromptTemplatePanel } from "@/components/ui/prompt-templates";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

const WORKFLOW_OPTIONS: Array<{
  id: WorkflowType;
  title: string;
  desc: string;
  icon: typeof Wand2;
}> = [
  { id: "passthrough",    title: "Upload",   desc: "Post a photo directly",  icon: Upload   },
  { id: "ai_generate",   title: "Generate", desc: "Create with DALL·E 3",   icon: Sparkles },
  { id: "ai_enhance",    title: "Enhance",  desc: "AI-edit an upload",       icon: Wand2    },
  { id: "stock_discovery", title: "Stock",  desc: "Find stock imagery",      icon: Images   },
  { id: "scrape",         title: "Extract", desc: "Pull from a URL",         icon: Globe    },
];

const PLACEHOLDER_ACCOUNT = "17841480000696385";

export default function ComposePage() {
  const [workflow, setWorkflow] = useState<WorkflowType>("ai_generate");
  const [prompt, setPrompt] = useState("");
  const [instructions, setInstructions] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [context, setContext] = useState("");
  const [stockSource, setStockSource] = useState<"auto" | "pexels" | "unsplash">("auto");
  const [enhanceAfterStock, setEnhanceAfterStock] = useState(false);
  const [enhanceInstructions, setEnhanceInstructions] = useState("");
  const [caption, setCaption] = useState("");
  const [generateCaption, setGenerateCaption] = useState(false);
  const [uploadedAssetId, setUploadedAssetId] = useState<string | null>(null);
  const [targets, setTargets] = useState<Platform[]>(["instagram"]);
  const [scheduleMode, setScheduleMode] = useState<"instant" | "scheduled">("instant");
  const [runAt, setRunAt] = useState<Date | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadAsset(file),
    onSuccess: (a) => setUploadedAssetId(a.id),
  });

  const refine = useMutation({
    mutationFn: () => api.refinePrompt(prompt),
    onSuccess: (r) => setPrompt(r.refined),
  });

  const submit = useMutation({
    mutationFn: () => api.createPost(buildPayload()),
  });

  function buildPayload(): CreatePostInput {
    const base = {
      targets: targets.map((p) => ({ platform: p, accountId: PLACEHOLDER_ACCOUNT })),
      schedule: {
        mode: scheduleMode,
        runAt: scheduleMode === "scheduled" && runAt ? runAt.toISOString() : undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      caption: { text: caption || undefined, hashtags: [], generate: generateCaption },
    };
    switch (workflow) {
      case "passthrough":
        return { workflow, uploadedAssetId: uploadedAssetId!, ...base };
      case "ai_generate":
        return { workflow, prompt, ...base };
      case "ai_enhance":
        return { workflow, uploadedAssetId: uploadedAssetId!, instructions, ...base };
      case "stock_discovery":
        return {
          workflow,
          prompt,
          maxCandidates: 10,
          stockSource,
          enhanceAfterStock,
          enhanceInstructions: enhanceAfterStock ? enhanceInstructions || undefined : undefined,
          ...base,
        };
      case "scrape":
        return { workflow, sourceUrl, context, ...base };
      default:
        return { workflow: "ai_generate", prompt, ...base };
    }
  }

  const needsUpload = workflow === "passthrough" || workflow === "ai_enhance";
  const disabled = submit.isPending || (needsUpload && !uploadedAssetId) || targets.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">Compose</h1>
          <p className="text-muted-foreground">
            Pick a workflow, give the agent its input, choose where and when to post.
          </p>
        </header>
      </div>

      {/* Workflow picker */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {WORKFLOW_OPTIONS.map((w) => (
          <button
            key={w.id}
            onClick={() => setWorkflow(w.id)}
            className={cn(
              "glass rounded-xl p-4 text-left transition-all",
              workflow === w.id ? "ring-2 ring-primary" : "opacity-70 hover:opacity-100",
            )}
          >
            <w.icon
              className={cn(
                "mb-2 h-5 w-5",
                workflow === w.id ? "text-primary" : "text-accent",
              )}
            />
            <p className="text-sm font-semibold">{w.title}</p>
            <p className="text-xs text-muted-foreground">{w.desc}</p>
          </button>
        ))}
      </div>

      <Card className="p-6">
        <div className="space-y-4">
          {needsUpload && (
            <div>
              <Label>Source image</Label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
                className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
              />
              {upload.isPending && <Hint>Uploading…</Hint>}
              {uploadedAssetId && <Hint>✓ Uploaded ({uploadedAssetId.slice(-6)})</Hint>}
              {upload.isError && (
                <p className="mt-1 text-xs text-red-400">
                  Upload failed: {(upload.error as Error).message}
                </p>
              )}
            </div>
          )}

          {(workflow === "ai_generate" || workflow === "stock_discovery") && (
            <Field label={workflow === "ai_generate" ? "Image prompt" : "Search prompt"}>
              <Textarea
                value={prompt}
                onChange={setPrompt}
                placeholder={
                  workflow === "ai_generate"
                    ? "A cinematic product shot of a matte-black espresso machine on marble…"
                    : "minimalist workspace, natural light, plants"
                }
              />
              <PromptTemplatePanel workflow={workflow} onSelect={setPrompt} />
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  disabled={prompt.trim().length < 3 || refine.isPending}
                  onClick={() => refine.mutate()}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                    refine.isPending
                      ? "border-primary/40 bg-primary/10 text-primary/60 cursor-not-allowed"
                      : "border-primary/40 bg-primary/5 text-primary hover:bg-primary/15",
                    prompt.trim().length < 3 && "opacity-40 cursor-not-allowed",
                  )}
                >
                  <Zap className={cn("h-3 w-3", refine.isPending && "animate-pulse")} />
                  {refine.isPending ? "Refining…" : "Refine prompt"}
                </button>
                {refine.isError && (
                  <span className="text-xs text-red-400">
                    {(refine.error as Error).message}
                  </span>
                )}
              </div>
            </Field>
          )}

          {workflow === "stock_discovery" && (
            <>
              <Field label="Photo source">
                <div className="flex gap-2">
                  {(["auto", "pexels", "unsplash"] as const).map((src) => (
                    <button
                      key={src}
                      type="button"
                      onClick={() => setStockSource(src)}
                      className={cn(
                        "rounded-lg border px-4 py-2 text-sm font-medium capitalize transition-colors",
                        stockSource === src
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-secondary/50",
                      )}
                    >
                      {src === "auto" ? "Auto (Pexels → Unsplash)" : src === "pexels" ? "Pexels only" : "Unsplash only"}
                    </button>
                  ))}
                </div>
                <Hint>Auto tries Pexels first, falls back to Unsplash if no results.</Hint>
              </Field>

              <div className="rounded-lg border border-border p-4 space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enhanceAfterStock}
                    onChange={(e) => setEnhanceAfterStock(e.target.checked)}
                    className="h-4 w-4 rounded"
                  />
                  <div>
                    <p className="text-sm font-medium">Enhance with AI after download</p>
                    <p className="text-xs text-muted-foreground">
                      Runs the stock photo through AI to improve lighting, color, and visual impact.
                    </p>
                  </div>
                </label>
                {enhanceAfterStock && (
                  <Field label="Enhancement instructions (optional)">
                    <Textarea
                      value={enhanceInstructions}
                      onChange={setEnhanceInstructions}
                      placeholder="Improve the lighting and add a warm tone suitable for a lifestyle brand…"
                    />
                    <Hint>Leave blank to use the default enhancement prompt.</Hint>
                  </Field>
                )}
              </div>
            </>
          )}

          {workflow === "ai_enhance" && (
            <Field label="Modification instructions">
              <Textarea
                value={instructions}
                onChange={setInstructions}
                placeholder="Replace the background with a soft gradient studio backdrop…"
              />
              <PromptTemplatePanel workflow="ai_enhance" onSelect={setInstructions} />
            </Field>
          )}

          {workflow === "scrape" && (
            <>
              <Field label="Source URL">
                <Input value={sourceUrl} onChange={setSourceUrl} placeholder="https://example.com/product" />
              </Field>
              <Field label="Context (what to extract)">
                <Input value={context} onChange={setContext} placeholder="the main hero product photo" />
                <PromptTemplatePanel workflow="scrape" onSelect={setContext} />
              </Field>
            </>
          )}

          <Field label="Caption">
            <Textarea
              value={caption}
              onChange={setCaption}
              placeholder="Optional — write your own, or let the agent draft one."
            />
            <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={generateCaption}
                onChange={(e) => setGenerateCaption(e.target.checked)}
              />
              Let the agent author caption + hashtags
            </label>
          </Field>
        </div>

        {/* Platforms */}
        <div className="mt-6">
          <Label>Platforms</Label>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                onClick={() =>
                  setTargets((t) => t.includes(p) ? t.filter((x) => x !== p) : [...t, p])
                }
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors",
                  targets.includes(p)
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:bg-secondary/50",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Schedule */}
        <div className="mt-6">
          <Label>Delivery</Label>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant={scheduleMode === "instant" ? "default" : "outline"}
              size="sm"
              onClick={() => setScheduleMode("instant")}
            >
              <Send className="h-4 w-4" /> Publish now
            </Button>
            <Button
              variant={scheduleMode === "scheduled" ? "default" : "outline"}
              size="sm"
              onClick={() => setScheduleMode("scheduled")}
            >
              <Clock className="h-4 w-4" /> Schedule
            </Button>
            {scheduleMode === "scheduled" && (
              <DateTimePicker
                value={runAt}
                onChange={setRunAt}
                minDate={new Date()}
                placeholder="Pick a date & time"
              />
            )}
          </div>
        </div>

        {/* Submit */}
        <div className="mt-8 flex items-center gap-4">
          <Button size="lg" disabled={disabled} onClick={() => submit.mutate()}>
            {submit.isPending
              ? "Dispatching…"
              : scheduleMode === "scheduled"
              ? "Schedule Post"
              : workflow === "passthrough"
              ? "Upload & Publish"
              : "Generate & Publish"}
          </Button>
          {submit.isSuccess && (
            <span className="text-sm text-emerald-300">
              ✓ Queued — post {submit.data.id.slice(-6)} ({submit.data.status})
            </span>
          )}
          {submit.isError && (
            <span className="text-sm text-red-300">
              {(submit.error as Error).message}
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}

/* — tiny local form primitives — */
function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-sm font-medium">{children}</p>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-muted-foreground">{children}</p>;
}
function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
    />
  );
}
function Textarea({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      className="w-full resize-y rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
    />
  );
}
