#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { MongoMemoryServer } from "mongodb-memory-server";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dataDir = resolve(root, ".data", "mongo");
const dbPath = resolve(dataDir, "db");
const port = Number(process.env.MANAGER_LOCAL_MONGO_PORT ?? 27099);
const mode = process.argv[2] === "start" ? "start" : "dev";

if (process.env.VERCEL === "1" || process.env.VERCEL_ENV !== undefined) {
  process.stderr.write(
    "Refusing to start: this helper is for local development only and must never run on Vercel.\\n" +
      "Set MONGODB_URI to your MongoDB Atlas URI in the Vercel project settings instead.\\n",
  );
  process.exit(1);
}

if (process.env.NODE_ENV === "production" && mode === "start" && process.env.MANAGER_ALLOW_LOCAL_DB !== "1") {
  process.stderr.write(
    "Refusing to start: `npm run start:local-db` would run production mode against a local database.\\n" +
      "Use `npm run dev:local-db` for local work, or set MANAGER_ALLOW_LOCAL_DB=1 if this is deliberate.\\n",
  );
  process.exit(1);
}

mkdirSync(dataDir, { recursive: true });
mkdirSync(dbPath, { recursive: true });

const fresh = process.argv.includes("--fresh");
if (fresh && existsSync(dbPath)) {
  const { rmSync } = await import("node:fs");
  rmSync(dbPath, { recursive: true, force: true });
  process.stdout.write("wiped .data/mongo/db (--fresh)\n");
}

process.stdout.write(
  `starting local MongoDB on 127.0.0.1:${port} (data in .data/mongo/db, survives restarts)\n`,
);

const mongo = await MongoMemoryServer.create({
  instance: { dbPath, port, storageEngine: "wiredTiger" },
});

const uri = mongo.getUri("manager");
process.stdout.write(`local database ready: ${uri}\n`);

const env = {
  ...process.env,
  MONGODB_URI: uri,
  NODE_ENV: mode === "start" ? "production" : "development",
  MANAGER_DATABASE_KIND: "local",
};

const child = spawn("npx", ["next", mode, ...(mode === "start" ? ["--port", process.env.PORT ?? "3000"] : [])], {
  env,
  stdio: "inherit",
});

const stop = async () => {
  child.kill("SIGINT");
  await mongo.stop({ doCleanup: false, force: false });
  process.exit(0);
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => {
  void mongo.stop({ doCleanup: false, force: false }).then(() => process.exit(code ?? 0));
});
