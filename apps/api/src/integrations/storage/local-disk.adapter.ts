import { mkdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoredAssetRef } from "@visora/shared";
import { env } from "../../config/env.js";
import { NotFoundError } from "../../lib/errors.js";
import type { ObjectStore, PutObjectParams } from "../interfaces/ports.js";

/**
 * Local-disk object store used when AWS credentials are absent.
 * Saves image files under <project-root>/uploads/ and returns real
 * HTTP URLs so images are immediately viewable in the browser.
 * Fastify serves the folder as static files (see http/server.ts).
 */
export const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

// Create the root uploads directory at module load so @fastify/static
// doesn't warn about a missing root on startup.
mkdirSync(UPLOADS_DIR, { recursive: true });

const BASE_URL = `http://localhost:${env.PORT}`;

export class LocalDiskObjectStore implements ObjectStore {
  readonly bucket = "local";
  readonly region = "local";

  async put(params: PutObjectParams): Promise<StoredAssetRef> {
    const dest = path.join(UPLOADS_DIR, params.key);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, params.body);
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
    const filePath = path.join(UPLOADS_DIR, key);
    try {
      const body = await readFile(filePath);
      return { body, contentType: "application/octet-stream" };
    } catch {
      throw new NotFoundError(`Object ${key}`);
    }
  }

  async signedUrl(key: string): Promise<string> {
    return `${BASE_URL}/uploads/${key}`;
  }
}
