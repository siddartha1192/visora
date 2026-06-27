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
] as const;
export type WorkflowType = (typeof WORKFLOWS)[number];

export const PLATFORMS = ["instagram", "facebook", "x", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const POST_STATUSES = [
  "draft",
  "queued",
  "processing",
  "ready",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "cancelled",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const TARGET_STATUSES = ["pending", "published", "failed"] as const;
export type TargetStatus = (typeof TARGET_STATUSES)[number];

export const SCHEDULE_MODES = ["instant", "scheduled"] as const;
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

export const WORKSPACE_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const JOB_STATES = [
  "pending",
  "active",
  "completed",
  "failed",
  "delayed",
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const AGENT_NODES = [
  "ingest",
  "router",
  "passthrough",
  "generation",
  "enhancement",
  "stock",
  "scraping",
  "optimization",
  "caption",
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
