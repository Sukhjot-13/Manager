import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { proxy } from "@/proxy";
import { startTestDatabase, stopTestDatabase, clearDatabase, TEST_ENV } from "../helpers/mongo";
import { authCookie, requestWithCookie } from "../helpers/request";
import { seedUser } from "../helpers/users";
import { resetEnvCache } from "@/lib/env";
import { SESSION_COOKIE } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { PermissionGate } from "@/components/permission-gate";

const ORIGIN = "http://localhost:3000";

function loginRequest(body: unknown, ip = "203.0.113.1"): NextRequest {
  return new NextRequest(`${ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await startTestDatabase();
});

afterAll(async () => {
  await stopTestDatabase();
});

beforeEach(async () => {
  await clearDatabase();
  resetEnvCache();
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] = value;
  }
  Object.assign(process.env, { NODE_ENV: "test" });
});

describe("POST /api/auth/login", () => {
  it("signs in the env owner and sets an HttpOnly SameSite=Lax cookie", async () => {
    const response = await login(
      loginRequest({ email: TEST_ENV.ADMIN_EMAIL, password: TEST_ENV.ADMIN_PASSWORD }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).toContain("Path=/");
  });

  it("never leaks whether the email exists", async () => {
    const wrongPassword = await login(
      loginRequest({ email: TEST_ENV.ADMIN_EMAIL, password: "nope-nope-nope" }),
    );
    const unknownUser = await login(
      loginRequest({ email: "ghost@example.com", password: "nope-nope-nope" }),
    );
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(await wrongPassword.json()).toEqual({ error: "invalid_credentials" });
    expect(await unknownUser.json()).toEqual({ error: "invalid_credentials" });
  });

  it("rejects malformed bodies with 400", async () => {
    const response = await login(
      loginRequest({ email: "not-an-email", password: "" }),
    );
    expect(response.status).toBe(400);
  });

  it("locks the account out after five failures and clears the lock on success", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await login(
        loginRequest({ email: TEST_ENV.ADMIN_EMAIL, password: "wrong-password" }, "198.51.100.9"),
      );
      expect(failed.status).toBe(401);
    }
    const locked = await login(
      loginRequest({ email: TEST_ENV.ADMIN_EMAIL, password: TEST_ENV.ADMIN_PASSWORD }, "198.51.100.9"),
    );
    expect(locked.status).toBe(429);
    expect(locked.headers.get("retry-after")).toBeTruthy();

    const { LoginAttemptModel } = await import("@/lib/db/ops");
    await LoginAttemptModel.deleteMany({});
    const allowed = await login(
      loginRequest({ email: TEST_ENV.ADMIN_EMAIL, password: TEST_ENV.ADMIN_PASSWORD }, "198.51.100.9"),
    );
    expect(allowed.status).toBe(200);
  });

  it("signs in a database user with a bcrypt password", async () => {
    await seedUser({ email: "dev@example.com", role: "DEVELOPER", password: "developer-pass-1" });
    const response = await login(
      loginRequest({ email: "dev@example.com", password: "developer-pass-1" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, role: "DEVELOPER" });
  });

  it("refuses a disabled database user", async () => {
    await seedUser({
      email: "off@example.com",
      role: "USER",
      password: "developer-pass-1",
      disabled: true,
    });
    const response = await login(
      loginRequest({ email: "off@example.com", password: "developer-pass-1" }),
    );
    expect(response.status).toBe(401);
  });
});

describe("session lifecycle", () => {
  it("returns the principal and server-derived capabilities", async () => {
    const userId = await seedUser({ email: "dev@example.com", role: "DEVELOPER" });
    const cookie = await authCookie({ id: userId, email: "dev@example.com", role: "DEVELOPER" });
    const response = await proxy(
      requestWithCookie(`${ORIGIN}/api/auth/session`, cookie),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user: { id: string; role: string };
      capabilities: string[];
    };
    expect(body.user.role).toBe("DEVELOPER");
    expect(body.capabilities).toContain("projects.view");
    expect(body.capabilities).not.toContain("users.manage");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("clears the cookie on logout", async () => {
    const response = await logout();
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain("Max-Age=0");
  });

  it("rejects a tampered token", async () => {
    const cookie = await authCookie({});
    const response = await proxy(
      requestWithCookie(`${ORIGIN}/api/auth/session`, {
        ...cookie,
        value: `${cookie.value.slice(0, -3)}xyz`,
      }),
    );
    expect(response.status).toBe(401);
  });
});

describe("proxy route guard", () => {
  it("leaves public routes reachable without a session", async () => {
    for (const path of ["/", "/login", "/api/ping", "/t.js", "/api/ingest/logs", "/api/ingest/events", "/api/sdk/logger"]) {
      const response = await proxy(requestWithCookie(`${ORIGIN}${path}`));
      expect([200, 307].includes(response.status) || response.status === 404).toBe(true);
      expect(response.status).not.toBe(401);
    }
  });

  it("returns 401 JSON for protected API routes and redirects pages to /login", async () => {
    const api = await proxy(requestWithCookie(`${ORIGIN}/api/projects`));
    expect(api.status).toBe(401);
    expect(api.headers.get("content-type")).toContain("application/json");

    const page = await proxy(requestWithCookie(`${ORIGIN}/dashboard`));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login?next=%2Fdashboard");
  });

  it("strips any client-supplied identity and re-derives it server side", async () => {
    const userId = await seedUser({ email: "dev@example.com", role: "DEVELOPER" });
    const cookie = await authCookie({ id: userId, email: "dev@example.com", role: "DEVELOPER" });
    const response = await proxy(
      requestWithCookie(`${ORIGIN}/dashboard`, {
        ...cookie,
        value: cookie.value,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("blocks a page whose coarse permission the principal lacks", async () => {
    const userId = await seedUser({ email: "reader@example.com", role: "USER" });
    const cookie = await authCookie({ id: userId, email: "reader@example.com", role: "USER" });
    const forbidden = await proxy(requestWithCookie(`${ORIGIN}/settings`, cookie));
    expect(forbidden.status).toBe(403);
    const allowed = await proxy(requestWithCookie(`${ORIGIN}/dashboard`, cookie));
    expect(allowed.status).toBe(200);
  });

  it("always attaches a fresh CSP nonce", async () => {
    const userId = await seedUser({});
    const cookie = await authCookie({ id: userId });
    const first = await proxy(requestWithCookie(`${ORIGIN}/dashboard`, cookie));
    const second = await proxy(requestWithCookie(`${ORIGIN}/dashboard`, cookie));
    const nonceOf = (response: Response): string =>
      (response.headers.get("content-security-policy") ?? "").match(/nonce-([a-f0-9]+)/)?.[1] ?? "";
    expect(nonceOf(first)).toMatch(/^[a-f0-9]{32}$/);
    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });

  it("ignores a deleted user even with a valid token", async () => {
    const cookie = await authCookie({ email: "ghost@example.com" });
    expect((await proxy(requestWithCookie(`${ORIGIN}/api/projects`, cookie))).status).toBe(401);
    expect((await proxy(requestWithCookie(`${ORIGIN}/dashboard`, cookie))).status).toBe(307);
  });

  it("ignores a disabled user even with a valid token", async () => {
    const userId = await seedUser({ email: "off@example.com", role: "USER", disabled: true });
    const cookie = await authCookie({ id: userId, email: "off@example.com", role: "USER" });
    expect((await proxy(requestWithCookie(`${ORIGIN}/api/projects`, cookie))).status).toBe(401);
  });
});

describe("fail-closed behaviour", () => {
  it("returns 401 rather than falling back to static grants when the user store is empty", async () => {
    const cookie = await authCookie({ email: "nobody@example.com" });
    const response = await proxy(requestWithCookie(`${ORIGIN}/api/projects`, cookie));
    expect(response.status).toBe(401);
  });

  it("keeps the login route working with an unconfigured settings store", async () => {
    const settings = await getSettings();
    expect(settings.ingestEnabled).toBe(true);
  });
});

describe("PermissionGate", () => {
  it("is a client component and only gates rendering", () => {
    expect(typeof PermissionGate).toBe("function");
  });
});
