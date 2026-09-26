# Architecture

> Status: scaffold + audit fixes (2026-09-26). Full build plan lives in [`docs/plan.md`](./plan.md).
> This file is the live inventory (file → purpose → functions), updated on every change.
> Docs audit 2026-09-26: full file scan (25 files, excl. .next/.git/node_modules) — inventory complete, no missing/stale rows; verified RootLayout signature + env table (no process.env in code yet, all vars template/planned only).

## Environment Variables

| Var | Purpose | Referenced in |
|---|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string | `docs/plan.md` §2/§5, `.env.example` (planned: `src/lib/db/*`) |
| `AUTH_SECRET` | Signs the admin session cookie (jose) | `.env.example` (planned: `src/middleware.ts`, `/api/auth/login`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Single-admin login credentials (simple auth, no DB user) | `.env.example` (planned: `/api/auth/login`) |
| `ENV_MASTER_KEY` | AES-256-GCM master key for secrets vault | `.env.example` (planned: `src/lib/crypto.ts`) |
| `VISITOR_PEPPER` | Secret HMAC key for hashing anonymous analytics visitor IDs (makes offline reversal of hashed IPs infeasible) | `.env.example`, analytics ingest (planned) |
| `CREATE_USER_EMAIL` / `CREATE_USER_PASSWORD` / `CREATE_USER_ROLE` | Inputs for `scripts/create-user.js` — never hardcoded in the file (commit-leak risk) | `scripts/create-user.js` (planned) |
| `GITHUB_TOKEN` *(optional)* | Higher rate limit for repo enrichment | `.env.example` (planned: `src/lib/github.ts`) |
| `APP_TZ` *(optional)* | Display timezone for dashboards (default UTC) | `.env.example`, dashboard pages (planned) |

## Files

| File | Purpose | Functions |
|---|---|---|
| `app/layout.tsx` | Root layout: Geist fonts, global CSS, HTML shell | `RootLayout({ children })` — wraps all routes; exports `metadata` (Manager title/description) |
| `app/page.tsx` | Default landing page (create-next-app scaffold, to be replaced in P0) | `Home()` — static starter UI |
| `app/globals.css` | Global Tailwind v4 theme + CSS vars | _(styles only)_ |
| `app/favicon.ico` | App favicon | _(static asset)_ |
| `app/api/ping/route.ts` | Public health check (plan §5) | `GET()` — returns `{ ok: true }` with `Cache-Control: no-store` |
| `next.config.ts` | Next.js config | _(config)_ |
| `tsconfig.json` | TypeScript config (`@/*` path alias) | _(config)_ |
| `eslint.config.mjs` | ESLint flat config (next core-web-vitals + TS) | _(config)_ |
| `postcss.config.mjs` | PostCSS + Tailwind v4 plugin | _(config)_ |
| `package.json` | Deps + scripts (`dev`, `build`, `start`, `lint`) | _(manifest)_ |
| `package-lock.json` | Pinned dependency tree | _(generated)_ |
| `next-env.d.ts` | Next.js TypeScript declarations | _(generated)_ |
| `public/next.svg`, `public/vercel.svg`, `public/file.svg`, `public/globe.svg`, `public/window.svg` | Static placeholder assets | _(static)_ |
| `.gitignore` | Ignore rules incl. `.env*` (un-ignores `.env.example`) | _(config)_ |
| `.env.example` | Documented template for all required env vars | _(template, no secrets)_ |
| `README.md` | Upstream create-next-app readme (to be replaced in P0) | _(docs)_ |
| `AGENTS.md` | Owner's main AI behavior/architecture guidelines (synced copy — do not diverge) | _(docs)_ |
| `CLAUDE.md` | Pointer to AGENTS.md | _(docs)_ |
| `docs/plan.md` | Full product plan (F1–F6, phases P0–P5, security §7/§7.6) | _(spec)_ |
| `docs/suggestions.md` | Parked post-v1 ideas + closed security-review log | _(docs)_ |
| `docs/architecture.md` | This file — live inventory + env vars | _(docs)_ |
