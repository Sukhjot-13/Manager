# Manager — Personal Project Control Center

One web app to manage all projects: registry, centralized logging, an encrypted secrets
vault, GitHub links, and analytics. Single admin, Next.js App Router, MongoDB Atlas,
deployed on Vercel Hobby.

> **Status: P0 (skeleton) in progress — no product features are built yet.**
> Full specification: [`docs/plan.md`](docs/plan.md) · Live file inventory:
> [`docs/architecture.md`](docs/architecture.md) · Open items: [`docs/to-do.md`](docs/to-do.md)

## Requirements

- Node.js 24+
- npm 11+
- MongoDB Atlas M0 (needed from the projects feature onward)

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in values; .env* is git-ignored
npm run dev                  # http://localhost:3000
```

Generate the secrets instead of typing them:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # ENV_MASTER_KEY (64 hex chars)
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (relaxed CSP: `unsafe-eval` + `ws:`, no https upgrade) |
| `npm run build` | Production build |
| `npm start` | Serve the production build (strict CSP) |
| `npm run lint` | ESLint (next core-web-vitals + TypeScript) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | **Single test entry point** — all Vitest suites (`tests/unit/`, `tests/integration/`) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run verify` | lint → typecheck → test → build (what CI should run) |

## Security posture

Implemented today (see `lib/csp.ts`, `proxy.ts`, `next.config.ts`):

- **Per-request nonce CSP** — `script-src` has no `'unsafe-inline'` in production, so injected
  markup cannot execute. Every script tag Next emits carries the matching nonce.
- `frame-ancestors 'none'` + `X-Frame-Options: DENY` — no clickjacking (matters once the
  secrets vault renders reveal buttons).
- `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `nosniff`, HSTS, COOP/CORP.
- `X-Powered-By` disabled; `reactStrictMode` on.
- Pages render per request (`force-dynamic`) because static HTML cannot carry a per-request
  nonce — this also keeps authenticated views out of shared caches.
- `robots: noindex` — this is a private admin app and must not be indexed.
- `Cache-Control: no-store` on `/api/ping` and (from P0 auth onward) on every authenticated GET.
- `npm audit` is clean.

Still to land with their phases: admin session cookie + middleware guard (P0), API-key
hashing and rate limiting (P3), AES-256-GCM vault with audited reveals (P2), ingest hardening
(P3/P4). The full threat model is `docs/plan.md` §7.6.

## Layout

```
app/            routes + API routes (App Router, no src/ dir)
lib/            shared server logic (CSP builder today; crypto, db, ratelimit later)
proxy.ts        runs before every request: mints the CSP nonce
tests/unit/     Vitest suites
tests/integration/  reserved for DB-backed route tests
docs/           plan, architecture inventory, suggestions, to-do
```

## Conventions

`AGENTS.md` holds the working rules: keep `docs/architecture.md` current, log ideas and
vulnerabilities in `docs/suggestions.md`, test every feature, and keep one test runner
(`npm test`).
