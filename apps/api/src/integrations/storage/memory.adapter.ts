import type { StoredAssetRef } from "@visora/shared";
import { env } from "../../config/env.js";
import { NotFoundError } from "../../lib/errors.js";
import type { ObjectStore, PutObjectParams } from "../interfaces/ports.js";

/**
 * In-memory object store used when AWS credentials are absent. Lets the entire
 * pipeline run locally without S3. Not for production — data is process-local.
 */
export class MemoryObjectStore implements ObjectStore {
  readonly bucket = env.S3_BUCKET;
  readonly region = env.AWS_REGION;
  private store = new Map<string, { body: Buffer; contentType: string }>();

  async put(params: PutObjectParams): Promise<StoredAssetRef> {
    this.store.set(params.key, {
      body: params.body,
      contentType: params.contentType,
    });
    return {
      s3Key: params.key,
      bucket: this.bucket,
      region: this.region,
      mime: params.contentType,
      width: 0,
      height: 0,
      bytes: params.body.byteLength,
    };
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string }> {
    const found = this.store.get(key);
    if (!found) throw new NotFoundError(`Object ${key}`);
    return found;
  }

  async signedUrl(key: string): Promise<string> {
    return `memory://${this.bucket}/${key}`;
  }
}
