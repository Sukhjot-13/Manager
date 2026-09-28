# To-Do

> Session handoff. Newest first. Product phases live in [`plan.md`](./plan.md) §6.

## 2026-09-28 — Full audit + hardening of the P0 skeleton

**Verified working:** `npm run lint`, `npm run typecheck` (`tsc --noEmit`), `npm test` (19 tests),
`npm run build`, `npm audit` (0 vulnerabilities), and a live production-server check of headers,
nonce propagation, and a real-Chromium CSP run (no violations).

**Fixed in this pass**

1. `npm audit` — 2 high-severity transitive advisories (`js-yaml`, `sharp`) → `npm audit fix`; bumped
   `@types/node` to `^24` (Node 24 runtime) so Vitest 5 resolves.
2. No security headers at all (plan §7 required them): `next.config.ts` now sets
   `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP,
   `X-DNS-Prefetch-Control`, HSTS; `poweredByHeader: false`, `reactStrictMode: true`.
3. No CSP anywhere → nonce-based CSP via `proxy.ts` + `lib/csp.ts` (per-request nonce,
   `'strict-dynamic'`, no `'unsafe-inline'` script source in production).
4. **Latent breakage found while verifying #3:** `/` was statically prerendered, so its inline
   hydration scripts carried no nonce and would have been CSP-blocked in a browser. Fixed with
   `export const dynamic = "force-dynamic"` and locked in by `tests/unit/page-rendering.test.ts`.
5. `app/globals.css` forced `font-family: Arial` over the Geist vars — both `next/font` faces were
   downloaded and never used. Now reads `var(--font-geist-sans)` / `var(--font-geist-mono)`.
6. `robots` meta was absent — a private admin app is now `noindex, nofollow, nocache`.
7. `app/page.tsx` still shipped the create-next-app boilerplate (Next.js logo, "Deploy Now" links,
   UTM-tagged outbound URLs) → replaced with a Manager status page, no external links.
8. `README.md` was upstream boilerplate → real setup/scripts/security docs.
9. No tests at all → Vitest + single runner `npm test` (plus `typecheck` and `verify` scripts).

**Remaining P0 work (plan §6, none of it started)**

- [ ] Mongo connection module `lib/db/*` (mongoose, connection cached on `globalThis`) + indexes from plan §4
- [ ] `lib/crypto.ts` AES-256-GCM helper (fresh 12-byte IV per write, `keyVer`, tamper detection) — needed by P2
- [ ] `lib/permissions.ts` access-level map + `can()` (plan §7.5) with admin bypass, wired into `proxy.ts` and every API route
- [ ] `lib/ratelimit.ts` in-memory token bucket (durable Mongo counters come with ingest, P3)
- [ ] `POST /api/auth/login` (env creds, `crypto.timingSafeEqual`, per-IP + per-account attempt
      counters, 5 fails → 15 min lockout, generic errors) + logout route
- [ ] Session cookie: `jose`-signed, HttpOnly + Secure + SameSite=Lax, 7-day expiry, read by `proxy.ts`
- [ ] `(auth)/login` page and `(dash)/` shell + nav
- [ ] `tests/integration/` suite: login + proxy gating, `Cache-Control: no-store` on authed GETs
- [ ] `scripts/create-user.js` (env/prompt only, never hardcoded creds)
- [ ] Dependency decision: repo uses **npm**, but `plan.md` §7.6 #10/#26 and §10 assume **pnpm**
      workspaces + `pnpm.lock` + `pnpm test` — reconcile the spec with reality (see `suggestions.md`)

**Verification command for any future change:** `npm run verify`
