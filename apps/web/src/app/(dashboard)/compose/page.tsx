"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  PLATFORMS,
  type Platform,
  type WorkflowType,
  type CreatePostInput,
} from "@visora/shared";
import { Wand2, Sparkles, Images, Globe, Upload, Send, Clock, Bot, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

const WORKFLOW_OPTIONS: Array<{
  id: WorkflowType;
  title: string;
  desc: string;
  icon: typeof Wand2;
}> = [
  { id: "passthrough", title: "Upload", desc: "Post a photo directly", icon: Upload },
  { id: "ai_generate", title: "Generate", desc: "Create with DALL·E 3", icon: Sparkles },
  { id: "ai_enhance", title: "Enhance", desc: "AI-edit an upload", icon: Wand2 },
  { id: "stock_discovery", title: "Stock", desc: "Find stock imagery", icon: Images },
  { id: "scrape", title: "Extract", desc: "Pull from a URL", icon: Globe },
];

const PLACEHOLDER_ACCOUNT = "17841480000696385";

export default function ComposePage() {
  const [autonomousMode, setAutonomousMode] = useState(false);

  // Manual mode state
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

  // Autonomous mode state
  const [brief, setBrief] = useState("");
  const [autonomousAssetId, setAutonomousAssetId] = useState<string | null>(null);
  // null = no explicit selection (agent reads from brief, then defaults)
  const [autonomousScheduleMode, setAutonomousScheduleMode] = useState<null | "instant" | "scheduled">(null);
  const [autonomousRunAt, setAutonomousRunAt] = useState<Date | null>(null);

  // Shared state (platforms — empty in autonomous until user picks)
  const [targets, setTargets] = useState<Platform[]>(["instagram"]);
  // Manual mode delivery
  const [scheduleMode, setScheduleMode] = useState<"instant" | "scheduled">("instant");
  const [runAt, setRunAt] = useState<Date | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadAsset(file),
    onSuccess: (a) => setUploadedAssetId(a.id),
  });

  const autonomousUpload = useMutation({
    mutationFn: (file: File) => api.uploadAsset(file),
    onSuccess: (a) => setAutonomousAssetId(a.id),
  });

  const submit = useMutation({
    mutationFn: () => api.createPost(buildPayload()),
  });

  function buildSchedule(autonomous = false) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (autonomous) {
      if (autonomousScheduleMode === "scheduled" && autonomousRunAt) {
        return { mode: "scheduled" as const, runAt: autonomousRunAt.toISOString(), timezone: tz };
      }
      if (autonomousScheduleMode === "instant") {
        return { mode: "instant" as const, timezone: tz };
      }
      // No UI selection — signal the planner to decide from the brief
      return { mode: "auto" as const, timezone: tz };
    }
    return {
      mode: scheduleMode,
      runAt: scheduleMode === "scheduled" && runAt ? runAt.toISOString() : undefined,
      timezone: tz,
    };
  }

  function buildTargets() {
    return targets.map((p) => ({ platform: p, accountId: PLACEHOLDER_ACCOUNT }));
  }

  function buildPayload(): CreatePostInput {
    if (autonomousMode) {
      return {
        workflow: "autonomous" as const,
        brief,
        uploadedAssetId: autonomousAssetId ?? undefined,
        targets: buildTargets(),
        schedule: buildSchedule(true),
        caption: { generate: true, hashtags: [] },
      } as CreatePostInput;
    }

    const base = {
      targets: buildTargets(),
      schedule: buildSchedule(),
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

  const needsUpload = !autonomousMode && (workflow === "passthrough" || workflow === "ai_enhance");

  // Platforms are optional in autonomous mode — the agent extracts them from the brief.
  const autonomousDisabled = submit.isPending || brief.trim().length < 10;

  const manualDisabled =
    submit.isPending || (needsUpload && !uploadedAssetId) || targets.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Header + mode toggle */}
      <div className="flex items-start justify-between gap-4">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">Compose</h1>
          <p className="text-muted-foreground">
            {autonomousMode
              ? "Describe what you want — the agent decides how to get it."
              : "Pick a workflow, give the agent its input, choose where and when to post."}
          </p>
        </header>

        <button
          onClick={() => {
            const next = !autonomousMode;
            setAutonomousMode(next);
            if (next) {
              setTargets([]);                    // no default — agent reads from brief
              setAutonomousScheduleMode(null);   // no default — agent reads from brief
              setAutonomousRunAt(null);
            } else {
              setTargets(["instagram"]);         // restore manual default
            }
            setAutonomousAssetId(null);
            autonomousUpload.reset();
            submit.reset();
          }}
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all",
            autonomousMode
              ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
              : "glass border border-border text-muted-foreground hover:text-foreground",
          )}
        >
          <Bot className="h-4 w-4" />
          {autonomousMode ? "Autonomous ON" : "Fully Autonomous"}
        </button>
      </div>

      {/* ── AUTONOMOUS MODE ─────────────────────────────────── */}
      {autonomousMode ? (
        <div className="space-y-6">
          {/* Ambient indicator */}
          <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
            <Zap className="h-4 w-4 shrink-0 text-primary" />
            <p className="text-sm text-muted-foreground">
              The agent will read your brief, choose whether to search stock photos or generate an image, write a caption, and route to the right platforms — no manual steps.
            </p>
          </div>

          <Card className="p-6 space-y-6">
            {/* Brief input */}
            <Field label="What do you want to post?">
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder={
                  "E.g. \"A serene mountain lake at golden hour — post to Instagram and LinkedIn with an inspiring caption about stillness.\"\n\nOr: \"Make my product photo look more premium and post to Instagram.\"\n\nOr: \"Grab the hero product image from https://example.com/product and post to Twitter.\""
                }
                rows={5}
                className="w-full resize-y rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {brief.length}/2000 · Mention a URL to scrape, upload an image to enhance/post, or let the agent find or generate one.
              </p>
            </Field>

            {/* Optional image upload for enhance / passthrough */}
            <div className="rounded-xl border border-border/60 bg-secondary/20 p-4 space-y-3">
              <div>
                <p className="text-sm font-medium">Source image <span className="text-muted-foreground font-normal">(optional)</span></p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Upload if you want the agent to enhance or post your own image. Without an upload the agent will find or generate one from your brief.
                </p>
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && autonomousUpload.mutate(e.target.files[0])}
                className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
              />
              {autonomousUpload.isPending && (
                <p className="text-xs text-muted-foreground">Uploading…</p>
              )}
              {autonomousAssetId && (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-emerald-400">✓ Image ready — agent will decide whether to enhance or post as-is</p>
                  <button
                    type="button"
                    onClick={() => { setAutonomousAssetId(null); autonomousUpload.reset(); }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Remove
                  </button>
                </div>
              )}
              {autonomousUpload.isError && (
                <p className="text-xs text-red-400">Upload failed: {(autonomousUpload.error as Error).message}</p>
              )}
            </div>

            {/* Platforms */}
            <div>
              <Label>Platforms <span className="text-muted-foreground font-normal">(optional — overrides brief)</span></Label>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                  <button
                    key={p}
                    onClick={() =>
                      setTargets((t) =>
                        t.includes(p) ? t.filter((x) => x !== p) : [...t, p],
                      )
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
              <p className="mt-1.5 text-xs text-muted-foreground">
                {targets.length === 0
                  ? "No selection — agent reads platforms from your brief, defaults to Instagram."
                  : `${targets.length} selected — overrides whatever the brief says.`}
              </p>
            </div>

            {/* Delivery */}
            <div>
              <Label>Delivery <span className="text-muted-foreground font-normal">(optional — overrides brief)</span></Label>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant={autonomousScheduleMode === "instant" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setAutonomousScheduleMode(
                      autonomousScheduleMode === "instant" ? null : "instant",
                    );
                    setAutonomousRunAt(null);
                  }}
                >
                  <Send className="h-4 w-4" /> Publish now
                </Button>
                <Button
                  variant={autonomousScheduleMode === "scheduled" ? "default" : "outline"}
                  size="sm"
                  onClick={() =>
                    setAutonomousScheduleMode(
                      autonomousScheduleMode === "scheduled" ? null : "scheduled",
                    )
                  }
                >
                  <Clock className="h-4 w-4" /> Schedule
                </Button>
                {autonomousScheduleMode === "scheduled" && (
                  <DateTimePicker
                    value={autonomousRunAt}
                    onChange={setAutonomousRunAt}
                    minDate={new Date()}
                    placeholder="Pick a date & time"
                  />
                )}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {autonomousScheduleMode === null
                  ? "No selection — agent reads timing from your brief, defaults to publish now."
                  : autonomousScheduleMode === "instant"
                  ? "Will publish immediately after approval — overrides any time mentioned in the brief."
                  : "Will publish at the selected time — overrides any time mentioned in the brief."}
              </p>
            </div>

            {/* Submit */}
            <div className="flex items-center gap-4">
              <Button
                size="lg"
                disabled={autonomousDisabled}
                onClick={() => submit.mutate()}
                className="gap-2"
              >
                <Bot className="h-4 w-4" />
                {submit.isPending
                  ? "Agent working…"
                  : autonomousScheduleMode === "scheduled"
                  ? "Schedule (Autonomous)"
                  : "Let the Agent Post"}
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
      ) : (
        /* ── MANUAL MODE ──────────────────────────────────────── */
        <>
          {/* Workflow picker */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {WORKFLOW_OPTIONS.map((w) => (
              <button
                key={w.id}
                onClick={() => setWorkflow(w.id)}
                className={cn(
                  "glass rounded-xl p-4 text-left transition-all",
                  workflow === w.id
                    ? "ring-2 ring-primary"
                    : "opacity-70 hover:opacity-100",
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
                </Field>
              )}

              {workflow === "scrape" && (
                <>
                  <Field label="Source URL">
                    <Input value={sourceUrl} onChange={setSourceUrl} placeholder="https://example.com/product" />
                  </Field>
                  <Field label="Context (what to extract)">
                    <Input value={context} onChange={setContext} placeholder="the main hero product photo" />
                  </Field>
                </>
              )}

              {/* Caption */}
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

            {/* Targets */}
            <div className="mt-6">
              <Label>Platforms</Label>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                  <button
                    key={p}
                    onClick={() =>
                      setTargets((t) =>
                        t.includes(p) ? t.filter((x) => x !== p) : [...t, p],
                      )
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
              <Button
                size="lg"
                disabled={manualDisabled}
                onClick={() => submit.mutate()}
              >
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
        </>
      )}
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
function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
    />
  );
}
function Textarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
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
