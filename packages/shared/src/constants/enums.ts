/**
 * Canonical enums shared across the API, worker, and web app.
 * These are the single source of truth — never redeclare these strings elsewhere.
 */

export const WORKFLOWS = [
  "passthrough",
  "ai_generate",
  "ai_enhance",
  "stock_discovery",
  "scrape",
  "autonomous",
] as const;
export type WorkflowType = (typeof WORKFLOWS)[number];

export const PLATFORMS = ["instagram", "facebook", "x", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const POST_STATUSES = [
  "draft",
  "queued",
  "processing",
  "pending_review",
  "ready",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "cancelled",
  "rejected",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/**
 * Statuses a post can still be cancelled from. Everything else is either
 * already terminal (`published`, `failed`, `cancelled`, `rejected`) or in
 * flight (`publishing` — platform calls are already out the door, so stopping
 * it would leave the record disagreeing with what's live on the platforms).
 *
 * Shared so the API's guard and the UI's affordance can never drift: the web
 * app hides the button using exactly the set the server enforces.
 */
export const CANCELLABLE_POST_STATUSES = [
  "draft",
  "queued",
  "processing",
  "pending_review",
  "ready",
  "scheduled",
] as const satisfies readonly PostStatus[];

export function isCancellable(status: PostStatus): boolean {
  return (CANCELLABLE_POST_STATUSES as readonly string[]).includes(status);
}

export const TARGET_STATUSES = ["pending", "published", "failed"] as const;
export type TargetStatus = (typeof TARGET_STATUSES)[number];

export const SCHEDULE_MODES = ["instant", "scheduled", "auto"] as const;
export type ScheduleMode = (typeof SCHEDULE_MODES)[number];

export const ASSET_KINDS = [
  "upload",
  "ai_generated",
  "stock",
  "scraped",
  "enhanced",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_SOURCES = [
  "user",
  "dalle3",
  "pexels",
  "unsplash",
  "scrape",
] as const;
export type AssetSource = (typeof ASSET_SOURCES)[number];

/**
 * Authorization has three independent tiers. Keeping them in separate enums —
 * and separate fields on User — is deliberate: when the platform tier shared an
 * enum with customer roles, a single role write could grant cross-customer
 * access, which is how the pre-tenancy admin tier came to ignore the workspace
 * boundary entirely.
 *
 *   PlatformRole  — SaaS operator staff. Crosses organizations.
 *   OrgRole       — within one customer organization (the tenant).
 *   WorkspaceRole — within one workspace (a brand/product) of that org.
 */

/** SaaS operator staff. `null` for every customer account. */
export const PLATFORM_ROLES = ["root"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/**
 * `owner` is the tenant's root user: implicit access to every workspace in the
 * org, plus workspace creation, user provisioning and subscription. `member`
 * carries no implicit access — everything comes from workspace memberships.
 * There is deliberately no org-level `admin`: "admin" in this product means
 * workspace admin, and never crosses the workspace boundary.
 */
export const ORG_ROLES = ["owner", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/**
 * Role on a single workspace membership. `owner` is retained for documents
 * written before organizations existed (the migration maps them to `admin`);
 * new memberships should use admin/editor/viewer.
 */
export const WORKSPACE_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/**
 * @deprecated Legacy single-tier role, replaced by PlatformRole + OrgRole +
 * WorkspaceRole. Retained only so the backfill migration can read old documents;
 * remove once no user document carries `role`.
 */
export const USER_ROLES = ["root", "admin", "user"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const JOB_STATES = [
  "pending",
  "active",
  "completed",
  "failed",
  "delayed",
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const AGENT_NODES = [
  "pipeline",     // pseudo-node for pipeline-level start/complete/fail events
  "ingest",
  "moderation",   // content policy gate — runs after ingest, before any AI call
  "planner",
  "router",
  "passthrough",
  "generation",
  "enhancement",
  "stock",
  "scraping",
  "optimization",
  "caption",
  "review",
  "publish",
  "persist",
] as const;
export type AgentNode = (typeof AGENT_NODES)[number];

export const AGENT_LOG_STATUSES = [
  "started",
  "succeeded",
  "failed",
  "skipped",
] as const;
export type AgentLogStatus = (typeof AGENT_LOG_STATUSES)[number];
