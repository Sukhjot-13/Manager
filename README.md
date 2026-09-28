# Manager — Personal Project Control Center

One web app to manage every project: registry, centralized logging, an encrypted secrets
vault, GitHub links, and analytics. Single owner (plus optional extra users with roles),
Next.js App Router, MongoDB Atlas, deployed on Vercel Hobby.

> **Status: P0–P5 built.** 329 unit/integration tests + a 57-check production smoke test
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

**Logs** — create a server or client key under *Project → API keys*, then in your app:

```bash
curl -fsSL -H "x-manager-key: mlk_…" \
  "https://your-manager-host/api/sdk/logger" -o src/lib/logger.ts
```

```ts
import { initLogger } from "./lib/logger";

const log = initLogger({
  endpoint: "https://your-manager-host",
  appId: "my-store",
  apiKey: "mlk_…",
  environment: "production",
});
log.info("order_created", { orderId });
```

*Project → Integrate* has the exact copy-paste command and snippet for your key.

**Analytics** — create an analytics key, then paste the `<script async src="…/t.js?v=1" data-app="…" data-key="mak_…">` tag from *Project → Analytics → Install tracker*.

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
