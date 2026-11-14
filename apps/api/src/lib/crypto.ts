import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { env } from "../config/env.js";

/**
 * Encrypts customer OAuth tokens at rest (AES-256-GCM — authenticated, so
 * tampering with the ciphertext is detected, not just decrypted incorrectly).
 * Keyed by TOKEN_ENCRYPTION_KEY; losing that key makes every ciphertext
 * produced here permanently undecryptable.
 *
 * The key is hashed to a fixed 32 bytes so any string length works in
 * TOKEN_ENCRYPTION_KEY, matching how JWT_SECRET imposes no exact length.
 */
const KEY = createHash("sha256").update(env.TOKEN_ENCRYPTION_KEY).digest();
const IV_LENGTH = 12; // recommended IV size for GCM

/** Returns base64(iv || authTag || ciphertext) — one opaque string to store. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/** Inverse of encryptSecret. Throws if the key is wrong or the ciphertext was tampered with. */
export function decryptSecret(encoded: string): string {
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = raw.subarray(IV_LENGTH + 16);

  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
