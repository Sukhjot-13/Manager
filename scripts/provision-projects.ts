#!/usr/bin/env tsx
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

async function loadEnvFile(file: string): Promise<void> {
  if (!existsSync(file)) {
    return;
  }
  const raw = await readFile(file, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index < 1) {
      continue;
    }
    const name = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (process.env[name] === undefined) {
      process.env[name] = value;
    }
  }
}

const outFile = resolve(root, ".manager-keys.local.json");
const specFile = resolve(root, "scripts", "projects.local.json");

const DEFAULT_PROJECTS = [
  { slug: "resume-builder", name: "Resume Builder", emoji: "📄", tags: ["next", "mongodb"] },
  { slug: "adminsukhjotportfolio", name: "Admin Portfolio", emoji: "🗂️", tags: ["next", "mongodb"] },
  { slug: "finance-app", name: "Finance App", emoji: "💰", tags: ["next", "mongodb", "capacitor"] },
  { slug: "french-book", name: "French Book", emoji: "📚", tags: ["next"] },
  { slug: "sukhjotportfolio", name: "Portfolio", emoji: "🌐", tags: ["next", "mongodb"] },
  { slug: "workout", name: "Workout", emoji: "🏋️", tags: ["next"] },
  { slug: "writer", name: "Writer", emoji: "✍️", tags: ["next"] },
];

const KEY_PLAN = [
  { kind: "server", name: "server logs", file: "MANAGER_LOG_KEY", source: "server" },
  { kind: "client", name: "client logs", file: "MANAGER_CLIENT_KEY", source: "client" },
  { kind: "analytics", name: "analytics tracker", file: "MANAGER_ANALYTICS_KEY", source: "analytics" },
] as const;

type ProjectSpec = { slug: string; name: string; emoji: string; tags: string[] };

async function readSpecs(): Promise<ProjectSpec[]> {
  if (!existsSync(specFile)) {
    return DEFAULT_PROJECTS;
  }
  const parsed = JSON.parse(await readFile(specFile, "utf8")) as ProjectSpec[];
  return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_PROJECTS;
}

async function main(): Promise<void> {
  await loadEnvFile(resolve(root, ".env.local"));
  await loadEnvFile(resolve(root, ".env"));

  if (process.env.MONGODB_URI === undefined || process.env.MONGODB_URI.trim() === "") {
    process.stderr.write(
      "MONGODB_URI is not set. Start Manager with a local database first:\n  npm run dev:local-db\n",
    );
    process.exit(1);
  }
  const { connectToDatabase } = await import("../lib/db/connect");
  const { ProjectModel } = await import("../lib/db/projects");
  const { createApiKey } = await import("../lib/keyManagement");
  const { databaseKind } = await import("../lib/readiness");

  // Manager's own origin, never the consuming app's port. MANAGER_PUBLIC_ORIGIN wins when
  // the deployment is behind a public domain; otherwise fall back to MANAGER_ENDPOINT, and
  // finally to the local dev server this script usually runs against.
  const managerEndpoint =
    process.env.MANAGER_PUBLIC_ORIGIN ??
    process.env.MANAGER_ENDPOINT ??
    "http://127.0.0.1:3000";
  process.stdout.write(`target manager: ${managerEndpoint}\n`);

  const target = databaseKind();
  await connectToDatabase();
  const specs = await readSpecs();
  process.stdout.write(
    `target database: ${target.kind}${target.host === "" ? "" : ` (${target.host})`}\n`,
  );
  const out: Record<
    string,
    { project: { slug: string; name: string }; env: Record<string, string>; keys: { kind: string; value: string }[] }
  > = {};

  for (const spec of specs) {
    const existing = await ProjectModel.findOne({ slug: spec.slug });
    const project =
      existing ??
      (await ProjectModel.create({
        name: spec.name,
        slug: spec.slug,
        emoji: spec.emoji,
        tags: spec.tags,
        status: "live",
        description: "Provisioned for Manager integration",
      }));
    const projectId = String(project._id);
    const keys: { kind: string; value: string }[] = [];
    const env: Record<string, string> = {
      MANAGER_ENDPOINT: managerEndpoint,
      MANAGER_APP_ID: spec.slug,
    };
    for (const plan of KEY_PLAN) {
      const created = await createApiKey({
        projectId,
        name: plan.name,
        kind: plan.kind,
      });
      keys.push({ kind: plan.kind, value: created.key });
      env[plan.file] = created.key;
    }
    env.MANAGER_LOG_SOURCE = "server";
    out[spec.slug] = { project: { slug: spec.slug, name: spec.name }, env, keys };
    process.stdout.write(`${spec.slug}: 3 keys minted\n`);
  }

  await writeFile(outFile, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  process.stdout.write(
    `\nWrote ${out.length} projects x ${KEY_PLAN.length} keys to .manager-keys.local.json (git-ignored).\n`,
  );
  process.stdout.write("Set these as Vercel env vars per repo when you deploy:\n");
  for (const [slug, entry] of Object.entries(out)) {
    process.stdout.write(`\n  ${slug}\n`);
    for (const [name, value] of Object.entries(entry.env)) {
      process.stdout.write(`    ${name}=${value}\n`);
    }
  }
  process.exit(0);
}

main().catch((error: unknown) => {
  process.stderr.write(`provision failed: ${(error as Error)?.message ?? String(error)}\n`);
  process.exit(1);
});
