# Manager — Personal Project Control Center

One web app to manage every project: registry, centralized logging, an encrypted secrets
vault, GitHub links, and analytics. Single owner (plus optional extra users with roles),
Next.js App Router, MongoDB Atlas, deployed on Vercel Hobby.

> **Status: P0–P5 built.** 338 unit/integration tests + a 57-check production smoke test
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
| `npm run test:e2e` | Builds, boots a real production server against a real MongoDB and walks the whole product (57 checks) |
| `npm run verify` | lint → typecheck → test → build |
| `npm run build:logger` | Regenerates `packages/logger/dist/` from `packages/logger/src` |
| `npm run create-user` | Creates/updates a user (`CREATE_USER_*` env vars or interactive prompts) |

## Features

- **Projects hub** — CRUD, statuses, tags, emoji/colour, links, markdown notes, search, grid/table views, optional GitHub enrichment (stars, open issues, default branch, last push).
- **Secrets vault** — AES-256-GCM per project **and** environment, fresh 12-byte IV per write, masked lists, 👁 reveal that auto re-masks after 30 s, every reveal/copy/export audited, `.env` import/export guarded by type-to-confirm + password re-entry, resumable master-key rotation.
- **Logger** — API keys per project (`mlk_` server, `mck_` client, `mak_` analytics), hardened ingest (Zod whitelist, 128 KB cap, batch caps, replay guard, key-kind scoping, two-layer rate limits, kill switches, fingerprint dedupe), viewer with All/Server/Client tabs, trace correlation, error grouping, live tail, CSV/JSON export (formula-injection safe), and a zero-dependency isomorphic SDK you vendor into any app.
- **Analytics** — one `<script>` tag per site: pageviews (SPA-aware), auto click maps, custom events, referrers/UTM, devices/browsers/OS, countries, live "active now", lazy daily rollups.
- **Access control** — named permissions resolved server-side, root admin (rank 0) with permanent full access, per-user allow/deny overrides, delegated permission managers bounded by rank **and** an explicit permission ceiling, audit log for every sensitive change.

## Wiring your projects in

Everything below lives in each project's **Integrate** page in the app too, with your real
key filled in and copy buttons.

### 1. Logs — vendor the SDK

Create a **server** key (`mlk_…`, Node/server code) or **client** key (`mck_…`, browser code)
under *Project → API keys*. Keys are shown in full exactly once.

```bash
curl -fsSL -H "x-manager-key: mlk_…" \
  "https://your-manager-host/api/sdk/logger" -o src/lib/logger.ts
```

The downloaded file is the whole SDK: zero dependencies, zero registry, types included, and a
usage header so the file explains itself inside your repo.

```ts
import { initLogger } from "./lib/logger";

const log = initLogger({
  endpoint: "https://your-manager-host",
  appId: "my-store",                    // must match the Manager project
  apiKey: process.env.MANAGER_LOG_KEY,  // never hardcode
  environment: "production",
  release: process.env.GIT_SHA,
  captureConsole: ["warn", "error"],
  captureGlobalErrors: true,
  redactKeys: ["password", "token", "authorization"],
  sampleRate: { debug: 0.1 },
});

log.info("order_created", { orderId });
await log.error("payment_failed", { code: "card_declined" });

const req = log.child({ requestId });   // child logger with bound context
req.info("checkout_step", { step: 3 });

log.time("db_query");
await runQuery();
const ms = log.timeEnd("db_query");    // timing entry with durationMs

// Server: adopt the browser's trace so both sides show up in one view
const trace = log.withTrace(req.headers.get("x-trace-id") ?? log.newTrace());
trace.info("query_start", { sql });

await log.flush();                     // Node/browser also flush on shutdown automatically
```

What you get: isomorphic, levels `trace|debug|info|warn|error|fatal`, child loggers, timers,
batching (20 entries / 5 s), backoff + retry, offline queue, console + uncaught-error +
unhandled-rejection + fetch/XHR auto-capture, rich auto-context, trace correlation,
redaction, error fingerprinting, and a self rate limiter so a hot loop cannot flood the store.

### 2. Logs — plain HTTP (any language)

```bash
curl -X POST "https://your-manager-host/api/ingest/logs" \
  -H "content-type: application/json" \
  -H "x-api-key: mlk_…" \
  -d '{"logs":[{"level":"info","message":"job_done","ts":1700000000000,"meta":{"rows":12}}]}'
```

### 3. Analytics — one script tag

Create an **analytics** key (`mak_…`) and paste the tag from *Project → Integrate* (or
*Analytics → Install tracker*):

```html
<script async src="https://your-manager-host/t.js?v=1"
        data-app="my-store" data-key="mak_live_…"></script>
```

It auto-tracks pageviews (SPA history changes included), click targets as
`[path] element-text (#id .class)`, referrers and UTM params, and batches with
`navigator.sendBeacon`. Custom events: `window.__mgr("event", "signup_clicked", { plan: "pro" })`.
Visitor ids are HMAC-derived from IP + UA, cookie-free, and rotate daily.

### Integration contract

| Rule | Value |
|---|---|
| Key kinds | `mlk_` server logs · `mck_` browser logs · `mak_` analytics only (an analytics key can never post logs) |
| Source scoping | a server key may only write `source:"server"`, a client key only `source:"client"` |
| Batch limit | 100 entries per request |
| Field caps | `message` ≤ 1 KB · `meta` ≤ 8 KB (JSON) · whole body ≤ 128 KB |
| Timestamps | entries with `ts` older than 24 h or more than 10 min in the future are rejected |
| Server-stamped | `source`, `ip`, `country`, `hostname`, `pid`, `runtimeVersion`, `rssMb`, `uptimeSec`, `receivedAt` — rejected if you send them |
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
