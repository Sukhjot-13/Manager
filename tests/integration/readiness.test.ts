import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as ping } from "@/app/api/ping/route";
import {
  checkReadiness,
  missingEnvVars,
  setupHint,
} from "@/lib/readiness";
import { startTestDatabase, stopTestDatabase, TEST_ENV } from "../helpers/mongo";
import { resetEnvCache } from "@/lib/env";

const ORIGIN = "http://localhost:3000";
const REQUIRED = [
  "MONGODB_URI",
  "AUTH_SECRET",
  "ENV_MASTER_KEY",
  "VISITOR_PEPPER",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
];

function loginRequest(): NextRequest {
  return new NextRequest(`${ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.com", password: "whatever" }),
  });
}

describe("unconfigured deployment", () => {
  beforeAll(() => {
    for (const [key, value] of Object.entries(TEST_ENV)) {
      process.env[key] = value;
    }
    process.env.MONGODB_URI = "mongodb://127.0.0.1:1/manager_test";
    resetEnvCache();
  });

  afterEach(() => {
    for (const name of REQUIRED) {
      process.env[name] = TEST_ENV[name];
    }
    process.env.MONGODB_URI = TEST_ENV.MONGODB_URI ?? "";
    resetEnvCache();
  });

  it("lists exactly the variables that are missing", () => {
    const original = process.env.ENV_MASTER_KEY;
    delete process.env.ENV_MASTER_KEY;
    expect(missingEnvVars()).toEqual(["ENV_MASTER_KEY"]);
    process.env.ENV_MASTER_KEY = original;
  });

  it("reports env_missing without trying to reach the database", async () => {
    const original = process.env.MONGODB_URI;
    delete process.env.MONGODB_URI;
    const report = await checkReadiness();
    expect(report.setup).toBe("env_missing");
    expect(report.env.missing).toContain("MONGODB_URI");
    expect(report.database.ok).toBe(false);
    expect(setupHint(report)).toContain(".env.local");
    process.env.MONGODB_URI = original;
  });

  it("answers login with an actionable 503 instead of a bare 500", async () => {
    const original = process.env.MONGODB_URI;
    delete process.env.MONGODB_URI;
    const response = await login(loginRequest());
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      error: string;
      setup: string;
      missingEnv: string[];
    };
    expect(body.error).toBe("not_ready");
    expect(body.setup).toBe("env_missing");
    expect(body.missingEnv).toContain("MONGODB_URI");
    expect(response.headers.get("cache-control")).toBe("no-store");
    process.env.MONGODB_URI = original;
  });

  it("never sets a session cookie while unconfigured", async () => {
    const original = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    const response = await login(loginRequest());
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    process.env.AUTH_SECRET = original;
  });

  it("reports database_unreachable when the URI cannot be connected", async () => {
    process.env.MONGODB_URI =
      "mongodb://127.0.0.1:1/manager_test?serverSelectionTimeoutMS=50";
    const report = await checkReadiness();
    expect(report.setup).toBe("database_unreachable");
    expect(report.env.ok).toBe(true);
    expect(setupHint(report)).toMatch(/could not be reached/i);
  });

  it("keeps the health route answering 200 with ok:false so probes can report why", async () => {
    const original = process.env.MONGODB_URI;
    delete process.env.MONGODB_URI;
    const response = await ping();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; setup: string };
    expect(body.ok).toBe(false);
    expect(body.setup).toBe("env_missing");
    process.env.MONGODB_URI = original;
  });
});

describe("configured deployment", () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  it("reports ready once every variable is set and the database answers", async () => {
    for (const [key, value] of Object.entries(TEST_ENV)) {
      process.env[key] = value;
    }
    resetEnvCache();
    const report = await checkReadiness();
    expect(report.setup).toBe("ready");
    expect(report.env.missing).toEqual([]);
    expect(report.database.ok).toBe(true);
    expect(setupHint(report)).toBe("");
  });

  it("lets a configured owner sign in normally", async () => {
    const response = await login(
      new NextRequest(`${ORIGIN}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: TEST_ENV.ADMIN_EMAIL,
          password: TEST_ENV.ADMIN_PASSWORD,
        }),
      }),
    );
    expect(response.status).toBe(200);
  });
});
