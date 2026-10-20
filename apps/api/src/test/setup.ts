import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll } from "vitest";

// Must happen before any other test file imports app code — `config/env.ts`
// validates process.env at import time via zod.
const uriFile = fileURLToPath(new URL("./.mongo-uri", import.meta.url));
const uri = readFileSync(uriFile, "utf-8").trim();

process.env.NODE_ENV = "test";
process.env.MONGODB_URI = uri;
process.env.JWT_SECRET = "test-jwt-secret-not-for-production-use";
process.env.WEB_ORIGIN = "http://localhost:3000";
// "silent" isn't in the env schema's LOG_LEVEL enum (fatal|error|warn|info|
// debug|trace) — "fatal" is the quietest legal value and keeps test output
// readable without changing the app's own validation.
process.env.LOG_LEVEL = "fatal";
// No OPENAI_API_KEY / provider keys — every integration degrades to a stub or
// a graceful no-op (see lib/moderation.ts, config/container.ts), which is
// exactly the behaviour the app already ships for credential-less local dev.

const { default: mongoose } = await import("mongoose");

beforeAll(async () => {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
});
