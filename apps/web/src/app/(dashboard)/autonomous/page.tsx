"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { PLATFORMS, type Platform, type CreatePostInput } from "@visora/shared";
import { Bot, Zap, Send, Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { PromptTemplatePanel } from "@/components/ui/prompt-templates";
import { ContentPolicyModal } from "@/components/ui/content-policy-modal";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";

const PLACEHOLDER_ACCOUNT = "17841480000696385";

export default function AutonomousPage() {
  const [brief, setBrief] = useState("");
  const [assetId, setAssetId] = useState<string | null>(null);
  const [targets, setTargets] = useState<Platform[]>([]);
  const [scheduleMode, setScheduleMode] = useState<null | "instant" | "scheduled">(null);
  const [runAt, setRunAt] = useState<Date | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadAsset(file),
    onSuccess: (a) => setAssetId(a.id),
  });

  const refine = useMutation({
    mutationFn: () => api.refinePrompt(brief),
    onSuccess: (r) => setBrief(r.refined),
  });

  const submit = useMutation({
    onError: (err) => {
      if (err instanceof ApiError && err.code === "CONTENT_POLICY_VIOLATION") {
        setPolicyError(err.message);
      }
    },
    mutationFn: () => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const schedule =
        scheduleMode === "scheduled" && runAt
          ? { mode: "scheduled" as const, runAt: runAt.toISOString(), timezone: tz }
          : scheduleMode === "instant"
          ? { mode: "instant" as const, timezone: tz }
          : { mode: "auto" as const, timezone: tz };

      const payload: CreatePostInput = {
        workflow: "autonomous",
        brief,
        uploadedAssetId: assetId ?? undefined,
        targets: targets.map((p) => ({ platform: p, accountId: PLACEHOLDER_ACCOUNT })),
        schedule,
        caption: { generate: true, hashtags: [] },
      } as CreatePostInput;

      return api.createPost(payload);
    },
  });

  const disabled = submit.isPending || brief.trim().length < 10;

  return (
    <>
    {policyError && (
      <ContentPolicyModal
        message={policyError}
        onDismiss={() => { setPolicyError(null); submit.reset(); }}
      />
    )}
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        icon={<Bot className="h-5 w-5" />}
        title="Autonomous"
        description="Describe what you want — the agent decides how to get it."
      />

      {/* Ambient indicator */}
      <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <Zap className="h-4 w-4 shrink-0 text-primary" />
        <p className="text-sm text-muted-foreground">
          The agent will read your brief, choose whether to search stock photos or generate an image,
          write a caption, and route to the right platforms — no manual steps needed.
        </p>
      </div>

      <Card className="p-6 space-y-6">
        {/* Brief */}
        <div>
          <p className="mb-2 text-sm font-medium">What do you want to post?</p>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={
              "E.g. \"A serene mountain lake at golden hour — post to Instagram and LinkedIn with an inspiring caption about stillness.\"\n\nOr: \"Make my product photo look more premium and post to Instagram.\"\n\nOr: \"Grab the hero product image from https://example.com/product and post to Twitter.\""
            }
            rows={5}
            className="w-full resize-y rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <PromptTemplatePanel workflow="autonomous" onSelect={setBrief} />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={brief.trim().length < 3 || refine.isPending}
              onClick={() => refine.mutate()}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                refine.isPending
                  ? "border-primary/40 bg-primary/10 text-primary/60 cursor-not-allowed"
                  : "border-primary/40 bg-primary/5 text-primary hover:bg-primary/15",
                brief.trim().length < 3 && "opacity-40 cursor-not-allowed",
              )}
            >
              <Sparkles className={cn("h-3 w-3", refine.isPending && "animate-pulse")} />
              {refine.isPending ? "Refining…" : "Refine brief"}
            </button>
            {refine.isError && (
              <span className="text-xs text-destructive">
                {(refine.error as Error).message}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {brief.length}/2000 · Mention a URL to scrape, upload an image to enhance/post, or let the agent find or generate one.
          </p>
        </div>

        {/* Optional image upload */}
        <div className="rounded-xl border border-border/60 bg-secondary/20 p-4 space-y-3">
          <div>
            <p className="text-sm font-medium">
              Source image <span className="font-normal text-muted-foreground">(optional)</span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Upload if you want the agent to enhance or post your own image. Without an upload the
              agent will find or generate one from your brief.
            </p>
          </div>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
            className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
          />
          {upload.isPending && <p className="text-xs text-muted-foreground">Uploading…</p>}
          {assetId && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-success">
                ✓ Image ready — agent will decide whether to enhance or post as-is
              </p>
              <button
                type="button"
                onClick={() => { setAssetId(null); upload.reset(); }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Remove
              </button>
            </div>
          )}
          {upload.isError && (
            <p className="text-xs text-destructive">
              Upload failed: {(upload.error as Error).message}
            </p>
          )}
        </div>

        {/* Platforms + delivery — grouped panel, both optional overrides of the brief */}
        <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium">
              Platforms <span className="font-normal text-muted-foreground">(optional — overrides brief)</span>
            </p>
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
            <p className="mt-1.5 text-xs text-muted-foreground">
              {targets.length === 0
                ? "No selection — agent reads platforms from your brief, defaults to Instagram."
                : `${targets.length} selected — overrides whatever the brief says.`}
            </p>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">
              Delivery <span className="font-normal text-muted-foreground">(optional — overrides brief)</span>
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant={scheduleMode === "instant" ? "default" : "outline"}
                size="sm"
                onClick={() => setScheduleMode(scheduleMode === "instant" ? null : "instant")}
              >
                <Send className="h-4 w-4" /> Publish now
              </Button>
              <Button
                type="button"
                variant={scheduleMode === "scheduled" ? "default" : "outline"}
                size="sm"
                onClick={() => setScheduleMode(scheduleMode === "scheduled" ? null : "scheduled")}
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
            <p className="mt-1.5 text-xs text-muted-foreground">
              {scheduleMode === null
                ? "No selection — agent reads timing from your brief, defaults to publish now."
                : scheduleMode === "instant"
                ? "Will publish immediately after approval — overrides any time mentioned in the brief."
                : "Will publish at the selected time — overrides any time mentioned in the brief."}
            </p>
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center gap-4">
          <Button size="lg" disabled={disabled} onClick={() => submit.mutate()} className="gap-2">
            <Bot className="h-4 w-4" />
            {submit.isPending
              ? "Agent working…"
              : scheduleMode === "scheduled"
              ? "Schedule (Autonomous)"
              : "Let the Agent Post"}
          </Button>
          {submit.isSuccess && (
            <span className="text-sm text-success">
              ✓ Queued — post {submit.data.id.slice(-6)} ({submit.data.status})
            </span>
          )}
          {submit.isError && !policyError && (
            <span className="text-sm text-destructive">
              {(submit.error as Error).message}
            </span>
          )}
        </div>
      </Card>
    </div>
    </>
  );
}
