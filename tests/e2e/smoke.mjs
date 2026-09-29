#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";
import { MongoMemoryServer } from "mongodb-memory-server";

const PORT = Number(process.env.E2E_PORT ?? 3200 + Math.floor(Math.random() * 400));
const ORIGIN = `http://127.0.0.1:${PORT}`;

const ENV = {
  AUTH_SECRET: "e2e-auth-secret-that-is-at-least-32-characters",
  ENV_MASTER_KEY: "b".repeat(64),
  VISITOR_PEPPER: "e2e-visitor-pepper",
  ADMIN_EMAIL: "owner@example.com",
  ADMIN_PASSWORD: "correct-horse-battery-staple",
  APP_TZ: "UTC",
};

let passed = 0;
let server = null;
const failures = [];
let cookie = "";

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    process.stdout.write(`  ok  ${name}\n`);
    return true;
  }
  failures.push(`${name}${detail === "" ? "" : ` — ${detail}`}`);
  process.stdout.write(`FAIL  ${name}${detail === "" ? "" : ` — ${detail}`}\n`);
  return false;
}

async function call(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (cookie !== "" && headers.get("cookie") === null) {
    headers.set("cookie", cookie);
  }
  if (init.body !== undefined && headers.get("content-type") === null) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie !== null && setCookie.includes("mgr_session=") && !setCookie.includes("Max-Age=0")) {
    cookie = setCookie.split(";")[0];
  }
  return response;
}

async function json(path, init) {
  const response = await call(path, init);
  const text = await response.text();
  let body = null;
  try {
    body = text === "" ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  return { response, body };
}

async function waitForServer(child, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${ORIGIN}/api/ping`);
      if (response.ok) {
        return true;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  return false;
}

function shutdown(child) {
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

for (const signal of ["SIGINT", "SIGTERM", "exit"]) {
  process.on(signal, () => {
    if (server !== null) {
      shutdown(server);
    }
  });
}

async function main() {
  process.stdout.write("starting in-memory MongoDB…\n");
  const mongo = await MongoMemoryServer.create();
  const env = {
    ...process.env,
    ...ENV,
    MONGODB_URI: mongo.getUri("manager_e2e"),
    NODE_ENV: "production",
    PORT: String(PORT),
  };

  process.stdout.write("building production bundle…\n");
  await new Promise((resolve, reject) => {
    const build = spawn("npx", ["next", "build"], { env, stdio: "ignore" });
    build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`build failed (${code})`))));
  });

  process.stdout.write("starting production server…\n");
  const logStream = process.env.E2E_LOG === "1" ? process.stdout : "ignore";
  server = spawn("npx", ["next", "start", "--port", String(PORT)], { env, stdio: ["ignore", logStream, logStream] });

  try {
    if (!(await waitForServer(server))) {
      throw new Error("server did not become healthy in time");
    }

    process.stdout.write("\nhealth + headers\n");
    const ping = await call("/api/ping");
    check("GET /api/ping returns ok", (await ping.json()).ok === true);
    check("ping is no-store", ping.headers.get("cache-control") === "no-store");
    const home = await call("/");
    const csp = home.headers.get("content-security-policy") ?? "";
    check("CSP present with a per-request nonce", /script-src[^;]*'nonce-[a-f0-9]{32}'/.test(csp));
    check("CSP forbids inline script", !/script-src[^;]*'unsafe-inline'/.test(csp));
    check("clickjacking denied", home.headers.get("x-frame-options") === "DENY");
    check("HSTS present", (home.headers.get("strict-transport-security") ?? "").includes("max-age="));
    check("no framework fingerprint", home.headers.get("x-powered-by") === null);
    check("private app is not indexable", (await home.text()).includes('name="robots" content="noindex'));

    process.stdout.write("\nauth gate\n");
    const anonDash = await call("/dashboard");
    check("unauthenticated page redirects to /login", anonDash.status === 307 && (anonDash.headers.get("location") ?? "").includes("/login"));
    const anonApi = await call("/api/projects");
    check("unauthenticated API returns 401", anonApi.status === 401);
    const badLogin = await json("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: ENV.ADMIN_EMAIL, password: "wrong-password" }),
    });
    check("wrong password is a generic 401", badLogin.response.status === 401 && badLogin.body.error === "invalid_credentials", `status ${badLogin.response.status} body ${JSON.stringify(badLogin.body)}`);
    const login = await json("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: ENV.ADMIN_EMAIL, password: ENV.ADMIN_PASSWORD }),
    });
    check("owner can sign in", login.response.status === 200, `status ${login.response.status} body ${JSON.stringify(login.body)} headers ${JSON.stringify([...login.response.headers])}`);
    check("session cookie is HttpOnly + SameSite", (login.response.headers.get("set-cookie") ?? "").toLowerCase().includes("httponly"));

    const dash = await call("/dashboard");
    const dashHtml = await dash.text();
    check("dashboard renders for the owner", dash.status === 200 && dashHtml.includes("Dashboard"));
    check("dashboard is no-store", dash.headers.get("cache-control")?.includes("no-store") === true);

    process.stdout.write("\nprojects\n");
    const created = await json("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "E2E Store",
        description: "created by the smoke test",
        status: "building",
        tags: ["next", "mongo"],
        links: [{ type: "github", url: "https://github.com/Sukhjot-13/Manager", label: "repo" }],
        notesMd: "# Notes\n- works",
      }),
    });
    check("project created", created.response.status === 201, JSON.stringify(created.body));
    const slug = created.body?.project?.slug ?? "";
    const list = await json("/api/projects");
    check("project appears in the list", list.body.projects.some((p) => p.slug === slug));
    const projectPage = await call(`/projects/${slug}`);
    check("project page renders with tabs", projectPage.status === 200 && (await projectPage.text()).includes("Env vault"));

    process.stdout.write("\nlog ingest + viewer\n");
    const keyResponse = await json(`/api/projects/${slug}/keys`, {
      method: "POST",
      body: JSON.stringify({ name: "server key", kind: "server" }),
    });
    const serverKey = keyResponse.body?.key?.key ?? "";
    check("server key minted", keyResponse.response.status === 201 && serverKey.startsWith("mlk_"));
    const relisted = await json(`/api/projects/${slug}/keys`);
    check("key list never returns the full key", JSON.stringify(relisted.body).includes(serverKey) === false);

    // The cross-project screen (/settings/keys) issues keys through POST /api/keys, a
    // different route from the per-project one above. It shipped as a 405 because only the
    // per-project POST was ever exercised, so it is checked here over real HTTP.
    process.stdout.write("\ncross-project keys\n");
    const projectId = created.body?.project?.id ?? "";
    // An explicit empty cookie stops call() from attaching the signed-in session.
    const anonCreate = await call("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: "" },
      body: JSON.stringify({ projectId, name: "anon", kind: "server" }),
    });
    check("POST /api/keys rejects an unauthenticated caller", anonCreate.status === 401);
    const noProject = await json("/api/keys", {
      method: "POST",
      body: JSON.stringify({ name: "orphan", kind: "server" }),
    });
    check("POST /api/keys requires an explicit project", noProject.response.status === 400);
    const ghostProject = await json("/api/keys", {
      method: "POST",
      body: JSON.stringify({ projectId: "6abb3abe7f54171579000000", name: "ghost", kind: "server" }),
    });
    check("POST /api/keys rejects an unknown project", ghostProject.response.status === 404);
    const cross = await json("/api/keys", {
      method: "POST",
      body: JSON.stringify({ projectId, name: "browser key", kind: "client" }),
    });
    const clientKey = cross.body?.key?.key ?? "";
    check(
      "POST /api/keys mints a key bound to the named project",
      cross.response.status === 201 && clientKey.startsWith("mck_") && cross.body?.key?.projectId === projectId,
      JSON.stringify(cross.body),
    );
    const allKeys = await json("/api/keys?all=1");
    check(
      "POST /api/keys never leaks the full value into the listing",
      JSON.stringify(allKeys.body).includes(clientKey) === false,
    );
    const revoked = await json(`/api/keys/${cross.body?.key?.id ?? ""}`, { method: "PATCH" });
    check("cross-project key revokes", revoked.response.status === 200 && Boolean(revoked.body?.key?.revokedAt));

    const ingest = await call("/api/ingest/logs", {
      method: "POST",
      headers: { "x-api-key": serverKey },
      body: JSON.stringify({
        logs: [
          { level: "error", message: "payment_failed", meta: { code: "declined" }, traceId: "trace-1" },
          { level: "info", message: "order_created", traceId: "trace-1" },
        ],
      }),
    });
    const ingestBody = await ingest.json();
    check("logs accepted", ingest.status === 200 && ingestBody.accepted === 2, JSON.stringify(ingestBody));
    const replay = await call("/api/ingest/logs", {
      method: "POST",
      headers: { "x-api-key": serverKey },
      body: JSON.stringify({ logs: [{ level: "info", message: "old", ts: new Date(Date.now() - 48 * 3600 * 1000).toISOString() }] }),
    });
    check("replayed timestamp rejected", (await replay.json()).rejected >= 1);
    const forged = await call("/api/ingest/logs", {
      method: "POST",
      headers: { "x-api-key": serverKey },
      body: JSON.stringify({ logs: [{ level: "info", message: "forged", source: "client", ip: "1.2.3.4" }] }),
    });
    check("forged server-set fields rejected", forged.status === 400 || (await forged.json()).rejected >= 1);
    const badKey = await call("/api/ingest/logs", {
      method: "POST",
      headers: { "x-api-key": "mlk_totally-wrong-key-value" },
      body: JSON.stringify({ logs: [{ level: "info", message: "x" }] }),
    });
    check("unknown key is a generic 401", badKey.status === 401 && (await badKey.json()).error === "unauthorized");
    const tooBig = await call("/api/ingest/logs", {
      method: "POST",
      headers: { "x-api-key": serverKey },
      body: JSON.stringify({ logs: [{ level: "info", message: "x", meta: "y".repeat(200_000) }] }),
    });
    check("oversized payload rejected", tooBig.status === 413 || tooBig.status === 400, `status ${tooBig.status}`);

    const logs = await json(`/api/projects/${slug}/logs?limit=10`);
    check("log viewer returns the ingested rows", logs.body.logs.length === 2, JSON.stringify(logs.body).slice(0, 200));
    const trace = await json(`/api/projects/${slug}/logs?traceId=trace-1`);
    check("trace view correlates client and server", trace.body.logs.length === 2);
    const logsPage = await call(`/projects/${slug}/logs`);
    check("log viewer page renders", logsPage.status === 200 && (await logsPage.text()).includes("Server"));
    const csv = await call(`/api/projects/${slug}/logs/export?format=csv`);
    const csvBody = await csv.text();
    check("CSV export works and is no-store", csv.status === 200 && csvBody.includes("payment_failed") && csv.headers.get("cache-control") === "no-store");

    process.stdout.write("\nsecrets vault\n");
    const secret = await json(`/api/projects/${slug}/secrets`, {
      method: "POST",
      body: JSON.stringify({ environment: "prod", key: "STRIPE_KEY", value: "sk-live-supersecret123" }),
    });
    check("secret stored", secret.response.status === 200 || secret.response.status === 201);
    const secrets = await json(`/api/projects/${slug}/secrets`);
    check("list is masked only", JSON.stringify(secrets.body).includes("sk-live-supersecret123") === false && JSON.stringify(secrets.body).includes("STRIPE_KEY"));
    const secretId = secrets.body.secrets[0].id;
    const reveal = await json(`/api/secrets/${secretId}/reveal`, { method: "POST" });
    check("reveal returns the value and is no-store", reveal.body.value === "sk-live-supersecret123" && reveal.response.headers.get("cache-control") === "no-store");
    const audit = await json(`/api/projects/${slug}/secrets/audit`);
    check("reveal is audited", (audit.body.audit ?? []).some((entry) => entry.action === "reveal"), JSON.stringify(audit.body).slice(0, 200));
    const envPage = await call(`/projects/${slug}/env`);
    check("vault page renders", envPage.status === 200 && (await envPage.text()).includes("STRIPE_KEY"));

    process.stdout.write("\nanalytics\n");
    const analyticsKey = await json(`/api/projects/${slug}/keys`, {
      method: "POST",
      body: JSON.stringify({ name: "tracker", kind: "analytics" }),
    });
    const mak = analyticsKey.body?.key?.key ?? "";
    check("analytics key minted", mak.startsWith("mak_"));
    const events = await call("/api/ingest/events", {
      method: "POST",
      body: JSON.stringify({
        key: mak,
        events: [
          { type: "pageview", path: "/", referrer: "https://google.com" },
          { type: "click", path: "/", name: "[/] Buy now (#buy)" },
          { type: "custom", name: "signup_clicked", props: { plan: "pro" } },
        ],
      }),
    });
    const eventsBody = await events.json();
    check("events accepted", events.status === 200 && eventsBody.accepted === 3, JSON.stringify(eventsBody));
    const analytics = await json(`/api/projects/${slug}/analytics?range=7d`);
    check("analytics summary counts pageviews", (analytics.body.totals?.pageviews ?? 0) >= 1, JSON.stringify(analytics.body).slice(0, 200));
    check("analytics keeps the dotted referrer", JSON.stringify(analytics.body).includes("google.com"));
    const wrongKind = await call("/api/ingest/events", {
      method: "POST",
      headers: { "x-api-key": serverKey },
      body: JSON.stringify({ events: [{ type: "pageview", path: "/" }] }),
    });
    check("server key cannot write events", wrongKind.status === 401);
    const analyticsPage = await call(`/projects/${slug}/analytics`);
    check("analytics page renders", analyticsPage.status === 200);
    const tracker = await call("/t.js");
    check("tracker served publicly and cacheable", tracker.status === 200 && (tracker.headers.get("cache-control") ?? "").includes("immutable"));
    check("tracker has no key in the query string", !(await tracker.text()).includes("?key="));

    process.stdout.write("\nSDK\n");
    const sdk = await call("/api/sdk/logger", { headers: { "x-manager-key": serverKey } });
    const sdkBody = await sdk.text();
    check("SDK download authorised by header key", sdk.status === 200 && sdkBody.includes("initLogger"));
    check("SDK response is no-store with no CORS wildcard", sdk.headers.get("cache-control") === "no-store" && sdk.headers.get("access-control-allow-origin") === null);
    const sdkNoKey = await call("/api/sdk/logger");
    check("SDK download refuses anonymous callers", sdkNoKey.status === 401);
    const integrate = await call(`/projects/${slug}/integrate`);
    check("integrate page renders", integrate.status === 200);

    process.stdout.write("\nsettings + users\n");
    const settings = await json("/api/settings", { method: "PATCH", body: JSON.stringify({ ingestEnabled: false }) });
    check("kill switch toggles", settings.body.settings.ingestEnabled === false);
    const blocked = await call("/api/ingest/logs", {
      method: "POST",
      headers: { "x-api-key": serverKey },
      body: JSON.stringify({ logs: [{ level: "info", message: "after kill switch" }] }),
    });
    check("kill switch blocks ingest", blocked.status === 403 || blocked.status === 429, `status ${blocked.status}`);
    await json("/api/settings", { method: "PATCH", body: JSON.stringify({ ingestEnabled: true }) });
    const settingsPage = await call("/settings");
    check("settings page renders", settingsPage.status === 200 && (await settingsPage.text()).includes("Ingest kill switches"));
    const users = await json("/api/users", {
      method: "POST",
      body: JSON.stringify({ email: "dev@example.com", password: "developer-pass-1", role: "DEVELOPER" }),
    });
    check("user created with the right rank", users.response.status === 201 && users.body.user.accessLevel === 50);
    const usersPage = await call("/settings/users");
    check("users page renders", usersPage.status === 200 && (await usersPage.text()).includes("dev@example.com"));

    process.stdout.write("\nnon-admin isolation\n");
    const ownerCookie = cookie;
    const devLogin = await json("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "dev@example.com", password: "developer-pass-1" }),
    });
    check("developer can sign in", devLogin.response.status === 200);
    const devSettings = await call("/api/settings");
    check("developer blocked from settings", devSettings.status === 403);
    const devUsers = await call("/api/users");
    check("developer blocked from user management", devUsers.status === 403);
    const devProjects = await call("/api/projects");
    check("developer can still view projects", devProjects.status === 200);
    cookie = ownerCookie;

    process.stdout.write("\nlogout\n");
    const logout = await call("/api/auth/logout", { method: "POST" });
    check("logout clears the cookie", (logout.headers.get("set-cookie") ?? "").includes("Max-Age=0"));
    cookie = "";
    const afterLogout = await call("/api/projects");
    check("session is gone after logout", afterLogout.status === 401);
  } finally {
    shutdown(server);
    server = null;
    await mongo.stop();
  }

  process.stdout.write(`\n${passed} checks passed, ${failures.length} failed\n`);
  if (failures.length > 0) {
    for (const failure of failures) {
      process.stdout.write(`  - ${failure}\n`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`e2e failed: ${error?.stack ?? error}\n`);
  process.exit(1);
});
