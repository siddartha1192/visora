"use client";

import { Suspense, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  PLATFORMS,
  type Platform,
  type WorkflowType,
  type CreatePostInput,
} from "@visora/shared";
import { Wand2, Sparkles, Images, Globe, Upload, Send, Clock, Zap, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { PromptTemplatePanel } from "@/components/ui/prompt-templates";
import { ContentPolicyModal } from "@/components/ui/content-policy-modal";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";

const WORKFLOW_OPTIONS: Array<{
  id: WorkflowType;
  title: string;
  desc: string;
  icon: typeof Wand2;
}> = [
  { id: "passthrough",    title: "Upload",   desc: "Post a photo directly",  icon: Upload   },
  { id: "ai_generate",   title: "Generate", desc: "Create with LLM",        icon: Sparkles },
  { id: "ai_enhance",    title: "Enhance",  desc: "AI-edit an upload",       icon: Wand2    },
  { id: "stock_discovery", title: "Stock",  desc: "Find stock imagery",      icon: Images   },
  { id: "scrape",         title: "Extract", desc: "Pull from a URL",         icon: Globe    },
];

const PLACEHOLDER_ACCOUNT = "17841480000696385";

/* ── Validation ────────────────────────────────────────────────────────────
 * Mirrors packages/shared/src/schemas/workflows.ts. The server is still the
 * authority — this exists so a missing field is named and explained *before*
 * a round trip, instead of coming back as a bare 422 "Validation failed".
 * Keep the rules here in step with the schema; anything that slips through is
 * caught by serverIssues() below, which unpacks the server's own field errors.
 */

type FieldKey =
  | "upload"
  | "prompt"
  | "instructions"
  | "sourceUrl"
  | "context"
  | "enhanceInstructions"
  | "caption"
  | "targets"
  | "runAt";

/**
 * Visual top-to-bottom order of the fields. validate() builds its result in
 * rule order, which doesn't match the form; the summary and the "jump to the
 * first problem" focus both read better following the page.
 */
const FIELD_ORDER: FieldKey[] = [
  "upload",
  "prompt",
  "sourceUrl",
  "context",
  "instructions",
  "enhanceInstructions",
  "caption",
  "targets",
  "runAt",
];

function orderedKeys(errors: Errors): FieldKey[] {
  return FIELD_ORDER.filter((k) => errors[k]);
}

/** Human names, used by the error summary and to label the server's fields. */
const FIELD_LABELS: Record<FieldKey, string> = {
  upload: "Source image",
  prompt: "Prompt",
  instructions: "Modification instructions",
  sourceUrl: "Source URL",
  context: "Context",
  enhanceInstructions: "Enhancement instructions",
  caption: "Caption",
  targets: "Platforms",
  runAt: "Schedule time",
};

type FormState = {
  workflow: WorkflowType;
  prompt: string;
  instructions: string;
  sourceUrl: string;
  context: string;
  enhanceAfterStock: boolean;
  enhanceInstructions: string;
  caption: string;
  uploadedAssetId: string | null;
  targets: Platform[];
  scheduleMode: "instant" | "scheduled";
  runAt: Date | null;
};

type Errors = Partial<Record<FieldKey, string>>;

/** Which fields the selected workflow requires — drives the `*` markers. */
function requiredFields(workflow: WorkflowType): Set<FieldKey> {
  const base: FieldKey[] = ["targets"];
  switch (workflow) {
    case "passthrough":
      return new Set([...base, "upload"]);
    case "ai_generate":
    case "stock_discovery":
      return new Set([...base, "prompt"]);
    case "ai_enhance":
      return new Set([...base, "upload", "instructions"]);
    case "scrape":
      return new Set([...base, "sourceUrl", "context"]);
    default:
      return new Set(base);
  }
}

/** Every message names the field, says what's wrong, and says what to do. */
function validate(s: FormState): Errors {
  const errors: Errors = {};
  const req = requiredFields(s.workflow);

  // Free-text fields the schema requires at 3+ characters.
  const text: Array<[FieldKey, string, string, string]> = [
    [
      "prompt",
      s.prompt,
      s.workflow === "ai_generate"
        ? "Describe the image you want the agent to create — or pick one of the prompt templates below."
        : "Describe the stock photo you're looking for, e.g. “minimalist workspace, natural light”.",
      s.workflow === "ai_generate" ? "Image prompt" : "Search prompt",
    ],
    [
      "instructions",
      s.instructions,
      "Describe the edit you want, e.g. “replace the background with a soft studio backdrop”.",
      "Modification instructions",
    ],
    [
      "context",
      s.context,
      "Tell the agent which image to pull, e.g. “the main hero product photo”.",
      "Context",
    ],
  ];
  for (const [key, value, guidance, label] of text) {
    if (!req.has(key)) continue;
    const v = value.trim();
    if (!v) errors[key] = `${label} is required. ${guidance}`;
    else if (v.length < 3)
      errors[key] = `${label} is too short — use at least 3 characters. ${guidance}`;
  }

  if (req.has("upload") && !s.uploadedAssetId) {
    errors.upload =
      s.workflow === "passthrough"
        ? "Choose a photo to post — use the file picker above."
        : "Upload the image you want the agent to edit — use the file picker above.";
  }

  if (req.has("sourceUrl")) {
    const v = s.sourceUrl.trim();
    if (!v) {
      errors.sourceUrl =
        "Source URL is required. Paste the address of the page to pull an image from.";
    } else if (!isHttpUrl(v)) {
      errors.sourceUrl =
        "That isn't a valid URL. Include the full address, e.g. https://example.com/product.";
    }
  }

  if (s.targets.length === 0) {
    errors.targets =
      "Pick at least one platform to publish to — tap Instagram, Facebook, X, or LinkedIn above.";
  }

  if (s.scheduleMode === "scheduled") {
    if (!s.runAt) {
      errors.runAt =
        "Pick the date and time to publish, or switch to “Publish now”.";
    } else if (s.runAt.getTime() <= Date.now()) {
      errors.runAt =
        "That time has already passed. Pick a future date and time, or switch to “Publish now”.";
    }
  }

  // Length ceilings from the schema — worth catching here so a long caption
  // isn't rejected only after the request is sent.
  if (s.caption.length > 4000) {
    errors.caption = `Caption is ${s.caption.length.toLocaleString()} characters — trim it to 4,000 or fewer.`;
  }
  if (s.enhanceAfterStock && s.enhanceInstructions.length > 2000) {
    errors.enhanceInstructions = `Enhancement instructions are ${s.enhanceInstructions.length.toLocaleString()} characters — trim them to 2,000 or fewer.`;
  }

  return errors;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Unpacks a server-side 422 into readable lines. Covers the case the client
 * rules missed — the user sees which field the API rejected rather than
 * "Validation failed".
 */
function serverIssues(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.code !== "VALIDATION_ERROR") return [];
  const details = error.details as
    | { formErrors?: string[]; fieldErrors?: Record<string, string[]> }
    | undefined;
  if (!details) return [];

  const lines: string[] = [];
  for (const [field, messages] of Object.entries(details.fieldErrors ?? {})) {
    const label = FIELD_LABELS[field as FieldKey] ?? field;
    for (const m of messages) lines.push(`${label}: ${m}`);
  }
  lines.push(...(details.formErrors ?? []));
  return lines;
}

/**
 * The controls differ per field — textarea, file input, a row of pill buttons —
 * so the summary locates them by `data-field` and focuses whatever is focusable
 * inside, rather than threading a ref through every primitive.
 */
function focusField(key: FieldKey) {
  const el = document.querySelector<HTMLElement>(`[data-field="${key}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.querySelector<HTMLElement>(
    "textarea, input, button, [tabindex]",
  )?.focus({ preventScroll: true });
}

export default function ComposePage() {
  return (
    <Suspense fallback={null}>
      <ComposePageInner />
    </Suspense>
  );
}

function ComposePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [policyError, setPolicyError] = useState<string | null>(null);
  // Errors appear only after the first submit attempt, then track live — so a
  // half-filled form isn't scolded while it's still being filled in.
  const [attempted, setAttempted] = useState(false);

  const form: FormState = {
    workflow, prompt, instructions, sourceUrl, context,
    enhanceAfterStock, enhanceInstructions, caption,
    uploadedAssetId, targets, scheduleMode, runAt,
  };
  const errors = attempted ? validate(form) : {};
  const errorKeys = orderedKeys(errors);

  // Deep link from the Calendar's "New post" action: /compose?date=yyyy-mm-dd —
  // preselect that day for scheduling; the user still picks the time.
  const dateParam = searchParams.get("date");
  useEffect(() => {
    if (!dateParam) return;
    const [y, m, d] = dateParam.split("-").map(Number);
    if (!y || !m || !d) return;
    const now = new Date();
    const isToday = y === now.getFullYear() && m - 1 === now.getMonth() && d === now.getDate();
    // Default to the next full hour for "today" (9am might already be past); 9am otherwise.
    const hour = isToday ? Math.min(now.getHours() + 1, 23) : 9;
    setScheduleMode("scheduled");
    setRunAt(new Date(y, m - 1, d, hour, 0));
    router.replace("/compose", { scroll: false });
  }, [dateParam, router]);

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadAsset(file),
    onSuccess: (a) => setUploadedAssetId(a.id),
  });

  const refine = useMutation({
    mutationFn: () => api.refinePrompt(prompt),
    onSuccess: (r) => setPrompt(r.refined),
  });

  const submit = useMutation({
    onError: (err) => {
      if (err instanceof ApiError && err.code === "CONTENT_POLICY_VIOLATION") {
        setPolicyError(err.message);
      }
    },
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

  /**
   * Validates on click rather than disabling the button. A dead button with no
   * explanation is the same dead end as an unexplained "Validation failed" —
   * the user needs to be told which field is missing and what to put in it.
   */
  function handleSubmit() {
    setAttempted(true);
    const found = validate(form);
    const keys = orderedKeys(found);
    if (keys.length > 0) {
      focusField(keys[0]);
      return;
    }
    submit.mutate();
  }

  return (
    <>
    {policyError && (
      <ContentPolicyModal
        message={policyError}
        onDismiss={() => { setPolicyError(null); submit.reset(); }}
      />
    )}
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        icon={<Wand2 className="h-5 w-5" />}
        title="Compose"
        description="Pick a workflow, give the agent its input, choose where and when to post."
      />

      {/* Workflow picker */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {WORKFLOW_OPTIONS.map((w) => (
          <button
            key={w.id}
            onClick={() => setWorkflow(w.id)}
            className={cn(
              "flex flex-col items-center rounded-xl border border-border bg-card p-3 text-center shadow-elevate-xs transition-all",
              workflow === w.id
                ? "border-primary ring-2 ring-primary bg-primary/10"
                : "hover:border-muted-foreground/30 hover:bg-secondary/40",
            )}
          >
            <w.icon
              className={cn(
                "mb-1.5 h-5 w-5",
                workflow === w.id ? "text-primary" : "text-accent",
              )}
            />
            <p
              className={cn(
                "text-sm font-semibold",
                workflow === w.id && "text-primary",
              )}
            >
              {w.title}
            </p>
            <p className="text-xs text-muted-foreground">{w.desc}</p>
          </button>
        ))}
      </div>

      <Card className="p-5">
        <div className="space-y-3">
          {needsUpload && (
            <div data-field="upload">
              <Label required>Source image</Label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
                className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
              />
              {upload.isPending && <Hint>Uploading…</Hint>}
              {uploadedAssetId && <Hint>✓ Uploaded ({uploadedAssetId.slice(-6)})</Hint>}
              {upload.isError && (
                <p className="mt-1 text-xs text-destructive">
                  Upload failed: {(upload.error as Error).message}
                </p>
              )}
              <FieldError message={errors.upload} />
            </div>
          )}

          {(workflow === "ai_generate" || workflow === "stock_discovery") && (
            <Field
              label={workflow === "ai_generate" ? "Image prompt" : "Search prompt"}
              field="prompt"
              required
            >
              <Textarea
                value={prompt}
                onChange={setPrompt}
                invalid={Boolean(errors.prompt)}
                placeholder={
                  workflow === "ai_generate"
                    ? "A cinematic product shot of a matte-black espresso machine on marble…"
                    : "minimalist workspace, natural light, plants"
                }
              />
              <FieldError message={errors.prompt} />
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
                  <span className="text-xs text-destructive">
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
                  <Field
                    label="Enhancement instructions"
                    field="enhanceInstructions"
                    optional
                  >
                    <Textarea
                      value={enhanceInstructions}
                      onChange={setEnhanceInstructions}
                      invalid={Boolean(errors.enhanceInstructions)}
                      placeholder="Improve the lighting and add a warm tone suitable for a lifestyle brand…"
                    />
                    <FieldError message={errors.enhanceInstructions} />
                    <Hint>Leave blank to use the default enhancement prompt.</Hint>
                  </Field>
                )}
              </div>
            </>
          )}

          {workflow === "ai_enhance" && (
            <Field
              label="Modification instructions"
              field="instructions"
              required
            >
              <Textarea
                value={instructions}
                onChange={setInstructions}
                invalid={Boolean(errors.instructions)}
                placeholder="Replace the background with a soft gradient studio backdrop…"
              />
              <FieldError message={errors.instructions} />
              <PromptTemplatePanel workflow="ai_enhance" onSelect={setInstructions} />
            </Field>
          )}

          {workflow === "scrape" && (
            <>
              <Field label="Source URL" field="sourceUrl" required>
                <Input
                  value={sourceUrl}
                  onChange={setSourceUrl}
                  invalid={Boolean(errors.sourceUrl)}
                  placeholder="https://example.com/product"
                />
                <FieldError message={errors.sourceUrl} />
              </Field>
              <Field label="Context (what to extract)" field="context" required>
                <Input
                  value={context}
                  onChange={setContext}
                  invalid={Boolean(errors.context)}
                  placeholder="the main hero product photo"
                />
                <FieldError message={errors.context} />
                <PromptTemplatePanel workflow="scrape" onSelect={setContext} />
              </Field>
            </>
          )}

          <Field label="Caption" field="caption" optional>
            <Textarea
              value={caption}
              onChange={setCaption}
              invalid={Boolean(errors.caption)}
              placeholder="Write your own, or let the agent draft one."
            />
            <FieldError message={errors.caption} />
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

        {/* Platforms + delivery — grouped panel */}
        <div className="mt-4 rounded-xl border border-border bg-secondary/20 p-4 space-y-4">
          <div data-field="targets">
            <Label required>Platforms</Label>
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
                    errors.targets && !targets.includes(p) && "border-destructive/50",
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
            <FieldError message={errors.targets} />
          </div>

          <div data-field="runAt">
            <Label required={scheduleMode === "scheduled"}>Delivery</Label>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant={scheduleMode === "instant" ? "default" : "outline"}
                size="sm"
                onClick={() => setScheduleMode("instant")}
              >
                <Send className="h-4 w-4" /> Publish now
              </Button>
              <Button
                type="button"
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
            <FieldError message={errors.runAt} />
          </div>
        </div>

        {/* Submit */}
        <div className="mt-6 space-y-4">
          {errorKeys.length > 0 && (
            <IssuePanel
              title={
                errorKeys.length === 1
                  ? "One thing needs fixing before you can post"
                  : `${errorKeys.length} things need fixing before you can post`
              }
              // No label prefix — each client message already names its field.
              issues={errorKeys.map((key) => ({
                message: errors[key]!,
                onClick: () => focusField(key),
              }))}
            />
          )}

          {/* Anything the client rules didn't catch, named by the server. */}
          {submit.isError && !policyError && serverIssues(submit.error).length > 0 && (
            <IssuePanel
              title="The server rejected this post"
              issues={serverIssues(submit.error).map((message) => ({ message }))}
            />
          )}

          <div className="flex flex-col items-center gap-2">
            <Button size="lg" disabled={submit.isPending} onClick={handleSubmit}>
              {submit.isPending
                ? "Dispatching…"
                : scheduleMode === "scheduled"
                ? "Schedule Post"
                : workflow === "passthrough"
                ? "Upload & Publish"
                : "Generate & Publish"}
            </Button>
            {submit.isSuccess && (
              <span className="text-sm text-success">
                ✓ Queued — post {submit.data.id.slice(-6)} ({submit.data.status})
              </span>
            )}
            {/* Non-validation failures (network, server error) keep the plain
                message — there's no field to point at. */}
            {submit.isError && !policyError && serverIssues(submit.error).length === 0 && (
              <span className="text-sm text-destructive">
                {(submit.error as Error).message}
              </span>
            )}
          </div>
        </div>
      </Card>
    </div>
    </>
  );
}

/* — tiny local form primitives — */

/** `required` marks the field with a `*`; `optional` says so outright, so the
 *  absence of a marker never has to be interpreted. */
function Label({
  children,
  required,
  optional,
}: {
  children: React.ReactNode;
  required?: boolean;
  optional?: boolean;
}) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
      {children}
      {required && (
        <>
          <span aria-hidden className="text-destructive">
            *
          </span>
          <span className="sr-only">(required)</span>
        </>
      )}
      {optional && (
        <span className="text-xs font-normal text-muted-foreground">Optional</span>
      )}
    </p>
  );
}

/**
 * Errors are placed by the caller rather than appended here: several fields
 * carry trailing controls (template pickers, the Refine button), and the
 * message has to sit against its input, not below whatever follows it.
 */
function Field({
  label,
  children,
  field,
  required,
  optional,
}: {
  label: string;
  children: React.ReactNode;
  /** Anchor for focusField() and the error summary's jump-to links. */
  field?: FieldKey;
  required?: boolean;
  optional?: boolean;
}) {
  return (
    <div data-field={field}>
      <Label required={required} optional={optional}>
        {label}
      </Label>
      {children}
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

/** Collected problems, each jumping to its field when it has one. */
function IssuePanel({
  title,
  issues,
}: {
  title: string;
  issues: Array<{ label?: string; message: string; onClick?: () => void }>;
}) {
  return (
    <div
      role="alert"
      className="animate-fade-in rounded-xl border border-destructive/40 bg-destructive/10 p-4"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {title}
      </p>
      <ul className="mt-2.5 space-y-1.5">
        {issues.map((issue, i) => (
          <li key={i} className="text-sm text-foreground/90">
            <span className="text-destructive">•</span>{" "}
            {issue.onClick ? (
              <button
                type="button"
                onClick={issue.onClick}
                className="text-left underline-offset-2 hover:underline"
              >
                {issue.label && <span className="font-medium">{issue.label}: </span>}
                {issue.message}
              </button>
            ) : (
              <>
                {issue.label && <span className="font-medium">{issue.label}: </span>}
                {issue.message}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-muted-foreground">{children}</p>;
}

const controlCls =
  "w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2";
const invalidCls = "border-destructive/60 focus:ring-destructive";
const validCls = "border-border focus:ring-ring";

function Input({
  value,
  onChange,
  placeholder,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      className={cn(controlCls, invalid ? invalidCls : validCls)}
    />
  );
}

function Textarea({
  value,
  onChange,
  placeholder,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      aria-invalid={invalid || undefined}
      className={cn(controlCls, "resize-y", invalid ? invalidCls : validCls)}
    />
  );
}
