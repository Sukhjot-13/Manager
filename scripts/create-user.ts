#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import process from "node:process";

const VALID_ROLES = new Set(["admin", "developer", "user"]);
const RANKS: Record<string, number> = { admin: 0, developer: 50, user: 100 };
const MIN_PASSWORD_LENGTH = 10;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function prompt(
  question: string,
  { silent = false }: { silent?: boolean } = {},
): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  if (silent) {
    const sink = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    Object.assign(rl, { output: sink });
  }
  const answer = await rl.question(question);
  if (silent) {
    process.stdout.write("\n");
  }
  rl.close();
  return answer.trim();
}

async function resolve(
  name: string,
  label: string,
  options: { silent?: boolean } = {},
): Promise<string> {
  const fromEnv = process.env[name];
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    return fromEnv.trim();
  }
  if (process.stdin.isTTY !== true) {
    fail(
      `${name} is not set and stdin is not interactive. Provide ${name} (and the other CREATE_USER_* vars) as environment variables.`,
    );
  }
  return prompt(`${label}: `, options);
}

function validateEmail(email: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail("Email is not valid.");
  }
}

function validateRole(role: string): string {
  const normalized = role.toLowerCase();
  if (!VALID_ROLES.has(normalized)) {
    fail(`Role must be one of: ${[...VALID_ROLES].join(", ")}`);
  }
  return normalized;
}

function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (uri === undefined || uri.trim() === "") {
    fail("MONGODB_URI is not set. Add it to .env.local and export it before running this script.");
  }

  const email = (await resolve("CREATE_USER_EMAIL", "Email")).toLowerCase();
  validateEmail(email);
  const name = await resolve("CREATE_USER_NAME", "Display name (optional)");
  const password = await resolve("CREATE_USER_PASSWORD", "Password (min 10 chars)", {
    silent: true,
  });
  validatePassword(password);
  const role = validateRole(await resolve("CREATE_USER_ROLE", "Role (admin|developer|user)"));

  const [{ default: mongoose }, { default: bcrypt }, connect] = await Promise.all([
    import("mongoose"),
    import("bcryptjs"),
    import("../lib/db/connect"),
  ]);

  await connect.connectToDatabase(uri);
  const collection = mongoose.connection.collection("users");
  const passwordHash = await bcrypt.hash(password, 12);
  const accessLevel = RANKS[role];
  const document = {
    email,
    name,
    passwordHash,
    role: role.toUpperCase(),
    accessLevel,
    disabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await collection.updateOne(
    { email },
    { $set: document, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );

  process.stdout.write(
    `${result.upsertedCount > 0 ? "Created" : "Updated"} user ${email} (${document.role}, rank ${accessLevel})\n`,
  );
  process.stdout.write(
    accessLevel === 0
      ? "Warning: this user is a root admin with unrestricted access.\n"
      : "",
  );
  await connect.disconnectFromDatabase();
  await mongoose.disconnect().catch(() => undefined);
}

main().catch((error) => {
  process.stderr.write(`create-user failed: ${error?.message ?? error}\n`);
  process.exit(1);
});
