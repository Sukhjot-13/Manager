# Architecture

> Status: P0 skeleton in progress (audit 2026-09-28). Full build plan lives in [`docs/plan.md`](./plan.md).
> This file is the live inventory (file → purpose → functions), updated on every change.
> Audit 2026-09-28: full scan of every project file (32 files, excl. `.next`/`.git`/`node_modules`) — inventory complete, no missing/stale rows.
> Product features from `docs/plan.md` §6 (P0 remainder → P5) are **not built yet**; see [`docs/to-do.md`](./to-do.md).

## Environment Variables

| Var | Purpose | Referenced in |
|---|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string | `.env.example` (planned: `lib/db/*` — P0) |
| `AUTH_SECRET` | Signs the admin session cookie (jose) | `.env.example` (planned: `proxy.ts` guard + `/api/auth/login` — P0) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Single-admin login credentials (simple auth, no DB user) | `.env.example` (planned: `/api/auth/login` — P0) |
| `ENV_MASTER_KEY` | AES-256-GCM master key for secrets vault (64 hex chars) | `.env.example` (planned: `lib/crypto.ts` — P2) |
| `VISITOR_PEPPER` | Secret HMAC key for hashing anonymous analytics visitor IDs | `.env.example` (planned: analytics ingest — P4) |
| `CREATE_USER_EMAIL` / `CREATE_USER_PASSWORD` / `CREATE_USER_ROLE` | Inputs for `scripts/create-user.js` — never hardcoded in the file (commit-leak risk) | `scripts/create-user.js` (planned) |
| `GITHUB_TOKEN` *(optional)* | Higher rate limit for repo enrichment | `.env.example` (planned: `lib/github.ts` — P1) |
| `APP_TZ` *(optional)* | Display timezone for dashboards (default UTC) | `.env.example` (planned: dashboard pages — P4) |
| `NODE_ENV` | Framework-managed; `proxy.ts` reads it to pick the dev-vs-production CSP (`'unsafe-eval'` + `ws:` + no `upgrade-insecure-requests` in dev) | `proxy.ts` |

No secret is read anywhere in code yet — every var above is template/planned until its phase lands.
`.env*` is git-ignored (`.env.example` is the only tracked env file; no `.env` exists in git history).

## Files

| File | Purpose | Functions |
|---|---|---|
| `proxy.ts` | Next.js 16 proxy (middleware) — runs before every request; mints a per-request CSP nonce, sets the CSP header on both request and response so Next stamps the nonce onto every `<script>` it emits. Matcher skips static assets + prefetches. CSP is defined **only** here (no second source in `next.config.ts`). | `proxy(request)` — generates nonce, builds CSP, forwards via `NextResponse.next({ request: { headers } })`, mirrors CSP on the response; `config.matcher` — exclusion pattern |
| `lib/csp.ts` | Single source of truth for the Content-Security-Policy string (extracted from `proxy.ts` so it is unit-testable) | `generateNonce()` — 16 CSPRNG bytes → 32 lowercase hex chars (valid CSP nonce source, never `Math.random`); `buildCsp(nonce, isDev)` — directive list: `default-src 'self'`, nonce-bound `script-src` + `'strict-dynamic'` (+ `'unsafe-eval'` in dev), `style-src 'self' 'unsafe-inline'`, self-only `img-src`/`font-src`/`connect-src`, `object-src`/`frame-src`/`media-src 'none'`, `base-uri`/`form-action 'self'`, `frame-ancestors 'none'`, `upgrade-insecure-requests` (prod only) |
| `app/layout.tsx` | Root layout: Geist fonts, global CSS, HTML shell; private-app metadata | `RootLayout({ children })` — wraps all routes; exports `metadata` (title template `Manager`/`%s · Manager`, description, `applicationName`, `referrer: no-referrer`, `robots` noindex/nofollow/nocache) |
| `app/page.tsx` | Manager-branded landing/status page (replaces create-next-app boilerplate). Exports `dynamic = "force-dynamic"` so the HTML is produced per request and can carry the CSP nonce | `Home()` — renders intro, P0–P5 build-status list, health-check + spec pointers; `PHASES` — static phase table |
| `app/api/ping/route.ts` | Public health check (plan §5) | `GET()` — returns `{ ok: true }` with `Cache-Control: no-store` |
| `app/globals.css` | Global Tailwind v4 theme + CSS vars | _(styles only — body/mono font families now read the Geist vars; `color-scheme` follows `prefers-color-scheme`)_ |
| `app/favicon.ico` | App favicon | _(static asset)_ |
| `next.config.ts` | Next config: `poweredByHeader: false`, `reactStrictMode: true`, global response headers | `securityHeaders` — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic/geolocation/payment/usb off), `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `X-DNS-Prefetch-Control: off`, HSTS (2y + includeSubDomains + preload); `headers()` — applies them to `/:path*` |
| `vitest.config.mts` | Vitest config (ESM; `.mts` avoids the CJS-loader warning) | _(config — `resolve.alias` maps `@/` → repo root, `test.include` = `tests/**/*.test.ts`, node environment)_ |
| `tests/unit/csp.test.ts` | CSP regression suite | `directive(csp, name)` — extracts one directive; asserts nonce format/uniqueness, nonce-bound `script-src`, locked-down `object-src`/`frame-src`/`frame-ancestors`/`base-uri`/`form-action`, no inline script source, prod/dev directive differences, well-formed output |
| `tests/unit/security-headers.test.ts` | `next.config.ts` regression suite | `headerMap()` — flattens `headers()`; asserts `poweredByHeader: false`, `reactStrictMode`, `/:path*` coverage, every plan §7 header present, restrictive `Permissions-Policy`, and that CSP is *not* duplicated here |
| `tests/unit/api-ping.test.ts` | Health route contract | asserts `200`, body `{ ok: true }`, `Cache-Control: no-store` |
| `tests/unit/page-rendering.test.ts` | Render-mode guard | asserts `app/page.tsx` exports `dynamic = "force-dynamic"` (static prerender cannot carry a per-request nonce → hydration would be CSP-blocked) |
| `tsconfig.json` | TypeScript config (`@/*` path alias, strict) | _(config)_ |
| `eslint.config.mjs` | ESLint flat config (next core-web-vitals + TS) | _(config)_ |
| `postcss.config.mjs` | PostCSS + Tailwind v4 plugin | _(config)_ |
| `package.json` | Deps + scripts (`dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:watch`, `verify`) | _(manifest)_ |
| `package-lock.json` | Pinned dependency tree (`npm audit` clean as of 2026-09-28) | _(generated)_ |
| `next-env.d.ts` | Next.js TypeScript declarations | _(generated)_ |
| `public/next.svg`, `public/vercel.svg`, `public/file.svg`, `public/globe.svg`, `public/window.svg` | Static placeholder assets (unused by `app/page.tsx`; can be deleted) | _(static)_ |
| `.gitignore` | Ignore rules incl. `.env*` (un-ignores `.env.example`) | _(config)_ |
| `.env.example` | Documented template for all required env vars | _(template, no secrets)_ |
| `README.md` | Project README: setup, scripts, security posture, layout | _(docs)_ |
| `AGENTS.md` | Owner's main AI behavior/architecture guidelines (synced copy — do not diverge) | _(docs)_ |
| `CLAUDE.md` | Pointer to AGENTS.md | _(docs)_ |
| `docs/plan.md` | Full product plan (F1–F6, phases P0–P5, security §7/§7.6) | _(spec)_ |
| `docs/suggestions.md` | Open ideas + closed audit findings (2026-09-28) | _(docs)_ |
| `docs/to-do.md` | Remaining P0 work + audit handoff notes | _(docs)_ |
| `docs/architecture.md` | This file — live inventory + env vars | _(docs)_ |

## Security model (as implemented)

- **CSP** — one canonical builder (`lib/csp.ts`), applied by `proxy.ts`; no `'unsafe-inline'`
  in `script-src` in production, so any injected inline script is inert. Nonces are per-request
  and per-response matched.
- **Render mode** — every authenticated view must be dynamic (`force-dynamic`) so no shared
  cache can serve another session's HTML; `app/page.tsx` is the current example.
- **Transport/browser** — HSTS, `frame-ancestors 'none'`/`X-Frame-Options: DENY` (clickjacking
  defence for the future vault reveal button), `nosniff`, COOP/CORP, restrictive `Permissions-Policy`.
- **Caching** — no authenticated response may be cached; `no-store` is asserted for
  authenticated GETs as each phase lands (plan §7 line 299).
- **Dependency floor** — minimal dep set (plan §7.6 #10/#26); `npm audit` reports 0 vulnerabilities.
