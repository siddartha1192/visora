import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StoredAssetRef } from "@visora/shared";
import { env } from "../../config/env.js";
import { ProviderError } from "../../lib/errors.js";
import type { ObjectStore, PutObjectParams } from "../interfaces/ports.js";

async function streamToBuffer(stream: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class S3ObjectStore implements ObjectStore {
  readonly bucket = env.S3_BUCKET;
  readonly region = env.AWS_REGION;
  private client: S3Client;

  constructor() {
    this.client = new S3Client({
      region: env.AWS_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: env.AWS_ACCESS_KEY_ID,
              secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    });
  }

  async put(params: PutObjectParams): Promise<StoredAssetRef> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: params.key,
          Body: params.body,
          ContentType: params.contentType,
        }),
      );
    } catch (err) {
      throw new ProviderError("s3", (err as Error).message);
    }
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
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = await streamToBuffer(out.Body);
      return { body, contentType: out.ContentType ?? "application/octet-stream" };
    } catch (err) {
      throw new ProviderError("s3", (err as Error).message);
    }
  }

  async signedUrl(key: string, expiresInSec = 3600): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSec },
    );
  }
}
