import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import argon2 from "argon2";
import { connectMongo, disconnectMongo } from "../db/connection.js";
import { UserModel } from "../db/models/index.js";

/**
 * Creates a SaaS-operator (platform) account.
 *
 * Replaces the old ROOT_EMAILS environment variable, which granted platform
 * access on *login* to any account whose email appeared in a list — with
 * registration open, whoever claimed that address first became platform root.
 *
 * Credentials are prompted for interactively rather than passed as arguments,
 * so they never land in shell history, `ps` output or CI logs.
 *
 *   docker exec -it visora-api-1 node dist/cli/create-platform-admin.js
 */
/**
 * Reads credentials interactively when attached to a terminal, or as four
 * newline-separated values on stdin when piped.
 *
 * The non-interactive path exists so this can run from a provisioning script
 * or a test; `readline` rejects with "readline was closed" once piped stdin
 * hits EOF, so it cannot serve both.
 */
async function readAnswers(): Promise<{
  name: string;
  email: string;
  password: string;
  confirm: string;
}> {
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
    const [name = "", email = "", password = "", confirm = ""] = Buffer.concat(chunks)
      .toString("utf8")
      .split("\n")
      .map((l) => l.trim());
    return { name, email, password, confirm };
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const name = (await rl.question("Name: ")).trim();
    const email = (await rl.question("Email: ")).trim().toLowerCase();
    const password = (await rl.question("Password (min 8 chars): ")).trim();
    const confirm = (await rl.question("Confirm password: ")).trim();
    return { name, email, password, confirm };
  } finally {
    rl.close();
  }
}

async function main() {
  try {
    await connectMongo();

    const answers = await readAnswers();
    const name = answers.name;
    const email = answers.email.toLowerCase();

    if (!name || !email) throw new Error("Name and email are required");

    const existing = await UserModel.findOne({ email });
    if (existing) {
      // Promote rather than refuse: the operator's own account may already
      // exist as an ordinary customer user.
      existing.platformRole = "root";
      await existing.save();
      console.log(`✅ Promoted existing user ${email} to platform admin.`);
      return;
    }

    const { password, confirm } = answers;
    if (password.length < 8) throw new Error("Password must be at least 8 characters");
    if (password !== confirm) throw new Error("Passwords do not match");

    await UserModel.create({
      name,
      email,
      passwordHash: await argon2.hash(password),
      status: "active",
      // Platform staff belong to no tenant — this is the one account type for
      // which organizationId is legitimately null (see the User validator).
      organizationId: null,
      orgRole: null,
      platformRole: "root",
    });

    console.log(`✅ Created platform admin ${email}.`);
  } finally {
    await disconnectMongo();
  }
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
