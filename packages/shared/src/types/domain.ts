import type {
  AssetKind,
  AssetSource,
  OrgRole,
  Platform,
  PlatformRole,
  PostStatus,
  ScheduleMode,
  TargetStatus,
  UserRole,
  WorkflowType,
  WorkspaceRole,
} from "../constants/enums.js";

/** A resized, platform-tailored rendition of an asset. */
export interface AssetVariant {
  platform: Platform;
  aspectRatio: string;
  cloudinaryUrl: string;
  s3Key: string;
  width: number;
  height: number;
}

export interface AssetDTO {
  id: string;
  workspaceId: string;
  kind: AssetKind;
  origin: {
    source: AssetSource;
    sourceUrl?: string;
    prompt?: string;
    providerMeta?: Record<string, unknown>;
  };
  s3: { bucket: string; key: string; region: string };
  url: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  checksum?: string;
  variants: AssetVariant[];
  createdByJobId?: string;
  createdAt: string;
}

export interface PostTargetDTO {
  platform: Platform;
  accountId: string;
  assetVariantId?: string;
  status: TargetStatus;
  externalPostId?: string;
  permalink?: string;
  error?: string;
}

export interface PostDTO {
  id: string;
  workspaceId: string;
  authorId: string;
  workflow: WorkflowType;
  status: PostStatus;
  input: {
    prompt?: string;
    instructions?: string;
    sourceUrl?: string;
    uploadedAssetId?: string;
    context?: string;
  };
  caption: { text: string; hashtags: string[]; generated: boolean };
  targets: PostTargetDTO[];
  primaryAssetId?: string;
  schedule: {
    mode: ScheduleMode;
    runAt?: string;
    timezone: string;
    publishedAt?: string;
  };
  jobId?: string;
  lastError?: string;
  /** Set when status is `cancelled` — who stopped it and when. */
  cancelledAt?: string;
  cancelledBy?: { userId: string; role: UserRole };
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMembership {
  workspaceId: string;
  role: WorkspaceRole;
}

/** A customer organization — the tenant, and the boundary a subscription attaches to. */
export interface OrganizationDTO {
  id: string;
  name: string;
  slug: string;
  plan: string;
  creditBalance: number;
  status: "active" | "suspended";
  createdAt: string;
}

/** A workspace (brand/product) within an organization. */
export interface WorkspaceDTO {
  id: string;
  organizationId: string;
  name: string;
  ownerId: string | null;
  /** Present only when the caller's own membership role is relevant. */
  myRole?: WorkspaceRole;
  createdAt: string;
}

/** The caller's identity and everything the UI needs to gate on. */
export interface MeDTO {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  platformRole: PlatformRole | null;
  orgRole: OrgRole | null;
  organization: OrganizationDTO | null;
  /** Workspaces the caller can actually reach, already resolved server-side. */
  workspaces: WorkspaceDTO[];
  activeWorkspaceId: string | null;
}

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  workspaces: WorkspaceMembership[];
  defaultWorkspaceId?: string;
  createdAt: string;
}

export interface SocialAccountDTO {
  id: string;
  platform: Platform;
  handle: string;
  externalAccountId: string;
  status: "connected" | "expired" | "revoked";
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** A workspace's machine-to-machine credential. Never carries the secret. */
export interface ApiKeyDTO {
  keyId: string;
  label: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revoked: boolean;
  revokedAt: string | null;
  /** Display label ("Name (email)") of whoever revoked it — the key's own owner or an admin. Null until revoked. */
  revokedBy: string | null;
}

/** Response shape for key creation — the only moment the raw secret is ever returned. */
export interface CreatedApiKeyDTO {
  apiKey: ApiKeyDTO;
  secret: string;
}

/** Admin-oversight view of a key — same as ApiKeyDTO plus which workspace/owner it belongs to. */
export interface AdminApiKeyDTO extends ApiKeyDTO {
  workspaceId: string;
  workspaceName: string;
  ownerEmail: string;
  ownerName: string;
}
