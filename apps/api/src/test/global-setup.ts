import { MongoMemoryServer } from "mongodb-memory-server";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Runs once for the whole test run, in a separate process from the test
 * files themselves. Starts a single ephemeral `mongod` and hands its URI to
 * every test file via a temp file, since env vars set here do not propagate
 * to vitest's worker processes.
 */
const uriFile = fileURLToPath(new URL("./.mongo-uri", import.meta.url));

export default async function globalSetup() {
  const mongod = await MongoMemoryServer.create({
    instance: { dbName: "visora-test" },
  });
  const uri = mongod.getUri();
  writeFileSync(uriFile, uri, "utf-8");

  return async () => {
    await mongod.stop();
  };
}
