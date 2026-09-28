import { connectToDatabase } from "@/lib/db/connect";

const REQUIRED_VARS = [
  "MONGODB_URI",
  "AUTH_SECRET",
  "ENV_MASTER_KEY",
  "VISITOR_PEPPER",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
] as const;

export type ReadinessReport = {
  env: { ok: boolean; missing: string[] };
  database: { ok: boolean; error: string };
  setup: "ready" | "env_missing" | "database_unreachable";
};

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
      database: { ok: false, error: "not_configured" },
      setup: "env_missing",
    };
  }
  try {
    await connectToDatabase(undefined, { serverSelectionTimeoutMS: 2500 });
    return {
      env: { ok: true, missing: [] },
      database: { ok: true, error: "" },
      setup: "ready",
    };
  } catch {
    return {
      env: { ok: true, missing: [] },
      database: { ok: false, error: "unreachable" },
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
