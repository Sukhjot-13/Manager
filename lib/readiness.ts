import { connectToDatabase } from "@/lib/db/connect";

const REQUIRED_VARS = [
  "MONGODB_URI",
  "AUTH_SECRET",
  "ENV_MASTER_KEY",
  "VISITOR_PEPPER",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
] as const;

export type DatabaseKind = "atlas" | "local" | "memory_server" | "unknown";

export type ReadinessReport = {
  env: { ok: boolean; missing: string[] };
  database: { ok: boolean; error: string; kind: DatabaseKind; host: string };
  setup: "ready" | "env_missing" | "database_unreachable";
};

export function databaseKind(uri = process.env.MONGODB_URI): { kind: DatabaseKind; host: string } {
  const value = (uri ?? "").trim();
  if (value === "") {
    return { kind: "unknown", host: "" };
  }
  if (value.startsWith("mongodb+srv://")) {
    return { kind: "atlas", host: "cluster" };
  }
  let host = value.replace(/^mongodb(\+srv)?:\/\//, "").split("/")[0];
  host = host.split("?")[0];
  if (host === "" || host === "localhost" || host.startsWith("127.0.0.1") || host.startsWith("0.0.0.0")) {
    return { kind: "local", host };
  }
  return { kind: "unknown", host };
}

export function missingEnvVars(): string[] {
  return REQUIRED_VARS.filter((name) => {
    const value = process.env[name];
    return value === undefined || value.trim() === "";
  });
}

export async function checkReadiness(): Promise<ReadinessReport> {
  const missing = missingEnvVars();
  if (missing.length > 0) {
    return {
      env: { ok: false, missing },
      database: { ok: false, error: "not_configured", kind: "unknown", host: "" },
      setup: "env_missing",
    };
  }
  const target = databaseKind();
  try {
    await connectToDatabase(undefined, { serverSelectionTimeoutMS: 2500 });
    return {
      env: { ok: true, missing: [] },
      database: { ok: true, error: "", kind: target.kind, host: target.host },
      setup: "ready",
    };
  } catch {
    return {
      env: { ok: true, missing: [] },
      database: { ok: false, error: "unreachable", kind: target.kind, host: target.host },
      setup: "database_unreachable",
    };
  }
}

export function setupHint(report: ReadinessReport): string {
  if (report.setup === "env_missing") {
    return `Copy .env.example to .env.local and set: ${report.env.missing.join(", ")}`;
  }
  if (report.setup === "database_unreachable") {
    return "MONGODB_URI is set but the database could not be reached — check the URI, the Atlas IP access list and that the cluster exists.";
  }
  return "";
}
