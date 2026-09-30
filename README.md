# Manager — Personal Project Control Center

One web app to manage every project: registry, centralized logging, an encrypted secrets
vault, GitHub links, and analytics. Single owner (plus optional extra users with roles),
Next.js App Router, MongoDB Atlas, deployed on Vercel Hobby.

> **Status: P0–P5 built.** 429 unit/integration tests + a 63-check production smoke test
> (`npm test`, `npm run test:e2e`).
> Specification: [`docs/plan.md`](docs/plan.md) · inventory: [`docs/architecture.md`](docs/architecture.md)

## Requirements

- Node.js 24+, npm 11+
- A free MongoDB Atlas M0 cluster (the app refuses to work without a reachable database)

## Setup

```bash
npm install
cp .env.example .env.local     # then fill in every value
npm run create-user            # optional: add developer/user accounts
npm run dev                    # http://localhost:3000
```

**Production = MongoDB Atlas.** The app has no in-repo database: without a reachable
`MONGODB_URI` it fails closed and `/login` tells you exactly what is missing.

**Local development without Atlas (testing only).** A real MongoDB is booted from
`mongodb-memory-server`, stored on disk in `.data/mongo/db` so data survives restarts:

```bash
npm run dev:local-db           # local MongoDB + next dev  (port 27099)
npm run dev:local-db:fresh     # same, but wipes the local data first
npm run provision:projects     # create projects + keys -> .manager-keys.local.json
```

`.data/` and `.manager-keys.local.json` are git-ignored, `/login` shows a "local database"
warning, and the helper refuses to run on Vercel. `npm run dev` / `npm start` are unaffected
and still require a real `MONGODB_URI`.

Generate the secrets instead of typing them:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # ENV_MASTER_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # VISITOR_PEPPER
```

Sign in at `/login` with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. The first successful login
registers that account as the root admin (rank 0).

If anything above is missing, the app tells you exactly what instead of failing silently:
`/login` shows a setup panel listing the unset variables, `POST /api/auth/login` answers
`503 {"error":"not_ready","setup":…,"missingEnv":[…]}`, and `GET /api/ping` reports
`{"ok":false,"setup":"env_missing"|"database_unreachable","missingEnv":[…]}`
(variable **names** only — never values).

> Back up `ENV_MASTER_KEY` in a password manager. It never touches the database, and
> without it every stored secret is unrecoverable. Rotating it is supported from
> **Settings → Rotate master key** (crash-safe and resumable).

## Environment variables

Copy [`.env.example`](.env.example) to `.env.local` for local development. For a
hosted deployment, set these in that Manager project's environment settings. Give
Manager its own database and generate independent secrets; never commit real values.

### Required for Manager

| Variable | Purpose / value |
|---|---|
| `MONGODB_URI` | Connection string including Manager's database name, e.g. `manager`. |
| `AUTH_SECRET` | Session-signing secret, at least 32 characters. Rotating it invalidates existing sessions. |
| `ADMIN_EMAIL` | Owner's login email. First successful owner login creates/promotes the root admin. |
| `ADMIN_PASSWORD` | Owner's login password. |
| `ENV_MASTER_KEY` | Vault encryption key: exactly **64 hex characters**. Back it up; existing encrypted secrets require this key. Use Settings for rotation on an existing database. |
| `VISITOR_PEPPER` | Random secret for anonymous analytics visitor IDs. Rotation changes visitor identity calculations. |

### Optional app settings

| Variable | Purpose / default |
|---|---|
| `GITHUB_TOKEN` | Read-only GitHub token for repository enrichment and higher API rate limits. |
| `APP_TZ` | Dashboard display timezone; defaults to `UTC`, e.g. `America/Toronto`. |

Manager uses password login and needs no email-provider or AI-provider credentials.
The `MANAGER_*` / `NEXT_PUBLIC_MANAGER_*` block under **Wiring your projects in**
belongs to the consuming sites; create separate project keys for Finance and Resume Builder.

### Local helpers and administration scripts (not required for hosting)

| Variable | Used by / purpose |
|---|---|
| `CREATE_USER_EMAIL` | `npm run create-user`: target account email; prompted when interactive. |
| `CREATE_USER_NAME` | `npm run create-user`: display name (may be empty when prompted). |
| `CREATE_USER_PASSWORD` | `npm run create-user`: password, at least 10 characters; prompted when interactive. |
| `CREATE_USER_ROLE` | `npm run create-user`: `admin`, `developer` or `user`; prompted when interactive. |
| `MANAGER_LOCAL_MONGO_PORT` | Local MongoDB launcher; defaults to `27099`. |
| `MANAGER_ALLOW_LOCAL_DB` | `1` explicitly permits the production-mode local database helper; `npm run start:local-db` sets it. Never a hosted database option. |
| `PORT` | `start:local-db` web port; defaults to `3000`. |
| `MANAGER_PUBLIC_ORIGIN` | Project provisioning: public Manager origin written into generated integration configuration. |
| `MANAGER_ENDPOINT` | Provisioning fallback origin (default `http://127.0.0.1:3000`); also benchmark target (default `http://127.0.0.1:3300`). |
| `MANAGER_LOG_KEY` | `scripts/bench-ingest.mjs`: synthetic test project's `mlk_` server key. |
| `MANAGER_APP_ID` | Benchmark SDK context; defaults to `resume-builder`. |

`NODE_ENV`, `VERCEL` and `VERCEL_ENV` are framework/platform-managed. The local helper
sets `MANAGER_DATABASE_KIND=local` internally; readiness still derives database kind
from the connection string. These are not additional secrets to provision.

Example app configuration (placeholders only):

```dotenv
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER/manager?retryWrites=true&w=majority
AUTH_SECRET=REPLACE_WITH_RANDOM_SECRET
ADMIN_EMAIL=owner@example.com
ADMIN_PASSWORD=REPLACE_WITH_OWNER_PASSWORD
ENV_MASTER_KEY=REPLACE_WITH_64_HEX_CHARACTERS
VISITOR_PEPPER=REPLACE_WITH_ANOTHER_RANDOM_SECRET
# GITHUB_TOKEN=
# APP_TZ=America/Toronto
```

After changing server configuration, restart locally or redeploy. On a fresh Manager
database, sign in as the owner, create each site's project, then generate its server,
client and analytics keys. Old keys from another Manager database do not authenticate.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (relaxed CSP: `unsafe-eval` + `ws:`, no https upgrade) |
| `npm run build` | Builds the SDK bundle, then the production app |
| `npm start` | Serves the production build (strict CSP) |
| `npm run lint` | ESLint (next core-web-vitals + TypeScript) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | **Single test entry point** — all unit + integration suites (Vitest + in-memory MongoDB) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Builds, boots a real production server against a real MongoDB and walks the whole product (63 checks) |
| `npm run verify` | lint → typecheck → test → build |
| `npm run build:logger` | Regenerates `packages/logger/dist/` from `packages/logger/src` |
| `npm run create-user` | Creates/updates a user (`CREATE_USER_*` env vars or interactive prompts) |

## Features

- **Projects hub** — CRUD, statuses, tags, emoji/colour, links, markdown notes, search, grid/table views, optional GitHub enrichment (stars, open issues, default branch, last push).
- **Secrets vault** — AES-256-GCM per project **and** environment, fresh 12-byte IV per write, masked lists, 👁 reveal that auto re-masks after 30 s, every reveal/copy/export audited, `.env` file drop/picker or multiline paste with parsed-key preview and validation; exports guarded by type-to-confirm + password re-entry, resumable master-key rotation.
- **Logger** — API keys per project (`mlk_` server, `mck_` client, `mak_` analytics), hardened ingest (Zod whitelist, 128 KB cap, batch caps, replay guard, key-kind scoping, two-layer rate limits, kill switches, fingerprint dedupe), viewer with All/Server/Client tabs, trace correlation, error grouping, live tail, CSV/JSON export (formula-injection safe), and a zero-dependency isomorphic SDK you vendor into any app.
- **Analytics** — one `<script>` tag per site: pageviews (SPA-aware), auto click maps, custom events, referrers/UTM, devices/browsers/OS, countries, live "active now", lazy daily rollups.
- **Access control** — named permissions resolved server-side, root admin (rank 0) with permanent full access, per-user allow/deny overrides, delegated permission managers bounded by rank **and** an explicit permission ceiling, audit log for every sensitive change.

## Wiring your projects in

Start by creating a project in Manager, then open **Project → API keys**. Copy each key
when it is created: Manager stores a hash and cannot show the full key again. The
**Integrate** page follows this guide: paste separate server, client and analytics keys
to fill the JS/TS downloads, environment block, server helper, browser provider and tracker
examples. Keys stay in the current tab only.

| Key | Where it belongs | What it can write |
|---|---|---|
| `mlk_…` | Server environment only; never `NEXT_PUBLIC_`, HTML, or browser code | Server logs |
| `mck_…` | Browser configuration; intentionally public | Client logs only |
| `mak_…` | Browser tracker; intentionally public | Analytics events only |

The key selects the destination project and log source. Use its project slug as `appId`
for consistent SDK context; `appId` does not grant access or override the key's project.
`endpoint` is Manager's origin (for example `https://your-manager-host`), not the consuming
app's URL and not `/api/ingest/logs`.

### 1. Download the SDK and set configuration

Use either a server or client log key to download. An analytics key cannot download it.

```bash
mkdir -p src/lib/manager
# JavaScript apps:
curl -fsSL -H "x-manager-key: YOUR_LOG_KEY" \
  "https://your-manager-host/api/sdk/logger?format=js" -o src/lib/manager/sdk.js
# TypeScript apps (choose this instead):
curl -fsSL -H "x-manager-key: YOUR_LOG_KEY" \
  "https://your-manager-host/api/sdk/logger" -o src/lib/manager/sdk.ts
```

The file is the complete SDK, with zero runtime dependencies or registry installation.
Commit it to the consuming app. SDK fixes reach existing apps only after you download
the updated file from the updated Manager deployment and rebuild the app.

For Next.js, put the following in the consuming app's environment. Replace placeholders
with keys from the same Manager project; omit any channel you do not want enabled.

```dotenv
MANAGER_ENDPOINT=https://your-manager-host
MANAGER_APP_ID=my-store
MANAGER_LOG_KEY=mlk_REPLACE_ME

NEXT_PUBLIC_MANAGER_ENDPOINT=https://your-manager-host
NEXT_PUBLIC_MANAGER_APP_ID=my-store
NEXT_PUBLIC_MANAGER_CLIENT_KEY=mck_REPLACE_ME
NEXT_PUBLIC_MANAGER_ANALYTICS_KEY=mak_REPLACE_ME
```

Server and browser initialization must live in separate modules. Next.js only inlines
literal accesses such as `process.env.NEXT_PUBLIC_MANAGER_CLIENT_KEY`; dynamic lookups
like `process.env[name]` will silently leave browser configuration undefined. Restart
development after env changes; rebuild/redeploy for public env changes in production.

### 2. Server logs and request completion

Create `src/lib/manager/server.js` (or `.ts`, adding types). This example is for Next.js
App Router on the Node runtime. Import it only from server code:

```js
import { after } from "next/server";
import { initLogger, traceIdFromHeaders } from "./sdk.js";

export function getManagerLogger() {
  const endpoint = process.env.MANAGER_ENDPOINT;
  const appId = process.env.MANAGER_APP_ID;
  const apiKey = process.env.MANAGER_LOG_KEY;
  if (!endpoint || !appId || !apiKey) return null;
  return (globalThis.__managerServerLogger ??= initLogger({
    endpoint, appId, apiKey,
    environment: process.env.NODE_ENV,
    captureConsole: null,
    captureGlobalErrors: false,
    captureProcessErrors: false,
    captureFetch: false,
    flushIntervalMs: 250,
    redactKeys: ["password", "token", "authorization"],
  }));
}

export function withManagerLogs(handler) {
  return async (request, context) => {
    const root = getManagerLogger();
    const traceId = traceIdFromHeaders(request.headers) || crypto.randomUUID();
    const requestLog = root?.withTrace(traceId);
    try {
      return await handler(request, context, requestLog);
    } catch (error) {
      requestLog?.error("Unhandled route error", { error });
      throw error; // Keep the app's existing error response policy.
    } finally {
      if (root) after(() => root.flush());
    }
  };
}
```

Wrap every exported route method, including auth, webhooks, PDF and early-return paths:

```js
// src/app/api/example/route.js
import { withManagerLogs } from "@/lib/manager/server";

export const GET = withManagerLogs(async (request, context, log) => {
  log?.info("example_requested", { route: "/api/example" });
  return Response.json({ ok: true });
});
```

If a handler catches an exception and returns a response itself, log the exception there
with `log?.error("operation_failed", { error })`. Native `Error` objects and serialized
objects containing `stack` produce a top-level, redacted stack. A generic message alone
cannot preserve the exception stack.

Log methods enqueue and return `void`: `await log.error(...)` does **not** flush. `after`
keeps delivery alive after the response, including thrown errors and early returns.
A timer or initialization only in `instrumentation.js` is insufficient on serverless.
For plain Node jobs, omit the Next.js wrapper and `await log.flush()` in the job's
`finally` before exit. Flush at request/job completion, rather than after every line.

Use `root.withTrace(incomingTrace)` for a request-local child. Avoid `root.newTrace()`
or `root.setContext()` to store request state on the shared root: concurrent requests
can overwrite each other's context. Pass the child through your services, or bind it
using Node `AsyncLocalStorage` in a server-only module.

### 3. Browser logs and analytics

Create `src/lib/manager/ManagerProvider.jsx` and mount it once in your root layout.
For TypeScript, use `.tsx`, typed window globals, and extensionless SDK imports.

```jsx
"use client";

import { useEffect } from "react";
import { initLogger } from "./sdk.js";

const endpoint = process.env.NEXT_PUBLIC_MANAGER_ENDPOINT;
const appId = process.env.NEXT_PUBLIC_MANAGER_APP_ID;
const clientKey = process.env.NEXT_PUBLIC_MANAGER_CLIENT_KEY;
const analyticsKey = process.env.NEXT_PUBLIC_MANAGER_ANALYTICS_KEY;

export default function ManagerProvider() {
  useEffect(() => {
    if (endpoint && appId && clientKey && !window.__managerClientLogger) {
      window.__managerClientLogger = initLogger({
        endpoint, appId, apiKey: clientKey,
        captureConsole: ["warn", "error"],
        captureGlobalErrors: true,
        captureFetch: true,
        redactKeys: ["password", "token", "authorization"],
      });
    }
    // Analytics is independent: do not require a client log key.
    if (endpoint && appId && analyticsKey && !document.getElementById("manager-tracker")) {
      const script = document.createElement("script");
      script.id = "manager-tracker";
      script.async = true;
      script.src = `${endpoint.replace(/\/+$/, "")}/t.js?v=1`;
      script.dataset.app = appId;
      script.dataset.key = analyticsKey;
      document.head.appendChild(script);
    }
  }, []);
  return null;
}
```

The window cache prevents duplicate listeners/uploads under Strict Mode or hot reload.
Browser capture includes console warnings/errors, uncaught errors, rejected promises and
fetch outcomes. Explicit messages use `window.__managerClientLogger?.info("checkout_opened")`.
Wrapped same-origin fetch requests carry `x-trace-id`; adopt that header on the server to
show both sources in Manager's combined journey. Cross-origin fetch tracing needs its
own deliberate CORS/header setup.

For any other browser framework, initialize the SDK once in its client bootstrap and
use its public configuration mechanism. For static sites, analytics alone is one tag:

```html
<script async src="https://your-manager-host/t.js?v=1"
        data-app="my-store" data-key="mak_REPLACE_ME"></script>
```

The tracker records SPA pageviews, click targets, referrers and UTM params, and batches
with `navigator.sendBeacon`. After it loads, send custom events with
`window.__mgr?.("event", "signup_clicked", { plan: "pro" })`. Visitor ids are HMAC-derived
from IP + UA, cookie-free, and rotate daily. On apps with CSP, allow Manager's origin
in `script-src` for the tracker and `connect-src` for log/event uploads.

### 4. Plain HTTP logs (any language)

```bash
curl -i -X POST "https://your-manager-host/api/ingest/logs" \
  -H "content-type: application/json" \
  -H "x-api-key: YOUR_SERVER_LOG_KEY" \
  -d '{"logs":[{"level":"info","message":"integration_probe","meta":{"rows":12}}]}'
```

Omitting `ts` uses Manager's current time. If you supply it, use a current epoch in
milliseconds or ISO timestamp. Check the response's `accepted` and `rejected` counts,
not just HTTP 200. The same endpoint accepts browser logs with a client key; never send
`source` or a project id in the entry. For analytics HTTP clients, use
`POST /api/ingest/events` with an analytics key and an `events` array.

### 5. Verify before calling the integration complete

1. Send a uniquely named server info message and browser console warning/error;
   confirm each appears under the intended project and source.
2. In an isolated test route, throw `new Error("integration_probe_<unique-id>")`.
   Confirm the app's expected error response and Manager's full exception stack.
   Also exercise a browser uncaught error and rejected promise.
3. Use a same-origin browser fetch to that route; confirm client and server rows share
   a trace and the combined journey reads chronologically.
4. Put **fake** password/token values in test metadata and confirm redaction. Verify
   repeated errors remain visible after another flush and separate traces stay separate.
5. Confirm a pageview and a custom event with only the analytics key configured.
   Wrong-kind, unknown and revoked keys must return 401 at their ingest endpoints.
6. Unset optional Manager configuration: the app should still work. Remove diagnostic
   routes/buttons after checking, and never spend AI credits or send real payments/emails
   just to prove log delivery.

### Delivery tuning and troubleshooting

| Option | Default | Use it to |
|---|---|---|
| `flushIntervalMs` | 5000 ms | Server example uses 250 ms to batch bursts promptly; request-completion flushing is still required. |
| `maxLogsPerSecond` | 500 | Guards runaway loops locally; does not replace Manager's per-key limits. |
| `captureProcessErrors` | `false` | Leave off under server frameworks; log in your handler/error boundary instead. |

Anything the client has to drop is reported to Manager as a `warn` entry named
`manager_sdk_dropped_entries` with `dropped` and `totalDropped`. SDK transport is best
effort: awaiting `flush()` attempts delivery, but is not an acknowledgement of durable
storage. Keep normal application error handling independent of Manager availability.

| Symptom | Check |
|---|---|
| Browser logs missing | Static `NEXT_PUBLIC_` reads, correct `mck_` key, rebuilt public env, network/CSP blockers. |
| Server logs missing after a successful response | Same cached logger used by routes; `after(() => root.flush())` runs on all exits. |
| Analytics missing while logs work | Separate `mak_` key, tracker loaded at `/t.js`, no client-key dependency, project/global analytics toggles. |
| HTTP 200 but no rows | `accepted`/`rejected` counts, current timestamps, key's project, viewer source/level/trace filters. |
| HTTP 401 | Correct endpoint and key kind; revoked or wrong-project configuration. |
| HTTP 429 | Honor `Retry-After`, batch messages and reduce volume; inspect ingest limits. |
| Duplicate browser messages | Multiple SDK instances or providers; initialize once per window. |
| Old behavior after SDK fix | Re-download the vendored SDK from the updated Manager deployment and rebuild. |

### Integration contract

| Rule | Value |
|---|---|
| Key kinds | `mlk_` server logs · `mck_` browser logs · `mak_` analytics only (an analytics key can never post logs) |
| Source scoping | Manager derives `server`/`client` from the key; callers must not send `source` |
| Batch limit | 100 entries per request |
| Field caps | `message` ≤ 1,024 characters · `stack` ≤ 8,000 characters · `meta` ≤ 8 KB JSON · body ≤ 128 KB |
| Timestamps | entries with `ts` older than 24 h or more than 10 min in the future are rejected |
| Manager-owned fields | `source`, `ip`, `country`, `receivedAt`, `keyPrefix`, `projectId`, `fingerprint`, `count`, `_id` — rejected in entries |
| Node context | `hostname`, `pid`, `runtimeVersion`, `rssMb`, `uptimeSec` accepted for server-key logs; rejected for client-key logs |
| Repeated errors | Bounded SDK `meta.count` hints count occurrences; grouping preserves separate traces and sources |
| Auth failures | unknown / revoked / mismatched keys always return the same generic `401` |
| Rate limits | `429` + `Retry-After`; the SDK retries with exponential backoff, raw clients should too |
| Kill switches | per project (*Overview* / *Analytics*) and global (*Settings*) stop ingest immediately |
| SDK download | authenticated by the `x-manager-key` **header** only, `Cache-Control: no-store`, no CORS `*` — never put a key in a URL |
| Retention | logs 30 d · events 90 d · secret audit 180 d · daily rollups kept indefinitely |

Other things worth knowing: rotating `AUTH_SECRET` invalidates every session immediately;
per-project ingest toggles let you stop a runaway app without revoking keys; and every
reveal/copy/export in the vault is written to an audit log you can read in the UI.

## Security posture

- **Per-request nonce CSP** (`proxy.ts` + `lib/csp.ts`): no `'unsafe-inline'` in `script-src`, `object-src`/`frame-src 'none'`, `frame-ancestors 'none'`, self-only `connect-src`. Every route renders dynamically so no shared cache can serve another session's HTML.
- **Session** — `jose`-signed HttpOnly + Secure + SameSite=Lax cookie, 7-day expiry, verified against a live user lookup on every request (deleted/disabled users lose access immediately). Rotating `AUTH_SECRET` kills every session at once.
- **Authoritative server-side authorization** on every route; the UI gate is cosmetic only. Unknown roles, malformed ranks, protected permissions and delegation attempts all fail closed.
- **Login hardening** — `timingSafeEqual`, generic errors (no user enumeration), per-IP + per-account counters, 5 failures → 15-minute lockout, no global counter.
- **Ingest hardening** — hashed keys with constant-time compare, generic 401s, server-stamped fields never trusted from payloads, strict Zod, size/batch caps, replay guard, in-memory + durable Mongo rate limits (unique `(key, windowStart)` index), global and per-project kill switches, `no-store` on every authenticated response.
- **Vault** — encrypted at rest, `no-store` reveals, 30-second re-mask, full audit trail, resumable key rotation.
- **Headers** — `nosniff`, `X-Frame-Options: DENY`, HSTS, COOP/CORP, restrictive `Permissions-Policy`, `X-Powered-By` off, `noindex` (private app).
- `npm audit` is clean; the dep set is deliberately small.

## Layout

```
app/
  (auth)/login/         sign-in
  (dash)/               authenticated shell: dashboard, projects, settings, users
  t.js/                 public analytics tracker
  api/                  auth, projects, secrets, keys, ingest, tracker, SDK, settings, users
lib/
  db/                   mongoose models + cached connection
  permissions.ts        registry, roles, delegation rules — single source of truth
  crypto.ts             AES-256-GCM vault helpers, hashing, constant-time compare
  session.ts auth.ts authService.ts   session issuing, guards, login policy
  ingest.ts analytics.ts secrets.ts   feature services (authorize at the route layer)
  csp.ts ratelimit.ts rollup.ts csv.ts fingerprint.ts visitor.ts ua.ts github.ts
packages/logger/        @manager/logger SDK source + single-file bundler
scripts/create-user.ts  CLI user creation
tests/{unit,integration,e2e}/
docs/                   plan, architecture, suggestions, to-do
```

## Conventions

`AGENTS.md` holds the working rules: keep `docs/architecture.md` current, log ideas and
vulnerabilities in `docs/suggestions.md`, test every feature, keep one test runner
(`npm test`), and one verification command (`npm run verify`).
