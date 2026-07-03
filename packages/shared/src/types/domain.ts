import type {
  AssetKind,
  AssetSource,
  Platform,
  PostStatus,
  ScheduleMode,
  TargetStatus,
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
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMembership {
  workspaceId: string;
  role: WorkspaceRole;
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
