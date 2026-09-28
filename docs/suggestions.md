# Suggestions Log

> State 2026-08-25: all design-level suggestions were folded into [`docs/plan.md`](./plan.md)
> (testing §10, RBAC/admin-bypass §7.5, security §7/§7.6, guardrails §8, specs F2–F5) — the
> plan owns them now. This file tracks **open/parked items only**. The five 🟡 features below
> are wanted **later** (post-v1), not declined.

## 🟢 Improvements
- 2026-09-28 — **`npm` vs `pnpm` drift (doc/spec mismatch).** `plan.md` §2/§5/§10 and §7.6 #10/#26
  assume pnpm workspaces, `pnpm.lock` and `pnpm test`, but the repo is npm (`package-lock.json`,
  `npm test`). Pick one and align the spec — npm needs no change; pnpm means converting the
  lockfile and scripts.
- 2026-09-28 — **Spec layout says `src/`, the scaffold uses root-level `app/`.** `plan.md` §5
  (`src/app/...`, `src/lib/...`) doesn't match `app/` + `lib/`. Code was added at `lib/csp.ts`
  to follow the *scaffold's* convention; update the plan (or move to `src/`) before P1 spreads
  the tree.
- 2026-09-28 — Unused placeholder SVGs (`public/next.svg`, `vercel.svg`, `file.svg`, `globe.svg`,
  `window.svg`) are dead weight now that the boilerplate landing page is gone — delete during P1 polish.
- 2026-09-28 — Consider `next/image` `remotePatterns` + relaxing `img-src` in `lib/csp.ts` when
  GitHub enrichment avatars land (P1); today `img-src 'self' blob: data:` is deliberate.
- 2026-09-28 — Add a GitHub Actions workflow running `npm run verify` + `npm audit --audit-level=high`
  so the audit findings fixed here can't silently return.

## 🟡 New Features
- 2026-08-25 — Reports shared manually for now (JSON/CSV download + printable report page → browser PDF); "Send to…" email-report button (Resend) parked for later, possibly separate script/app. *(wanted later — parked post-v1 in plan)*
- 2026-08-25 — Error-spike alerts to Discord/Telegram webhook (post-v1).
- 2026-08-25 — Uptime monitoring via external free pinger hitting `/api/ping/[id]` (Vercel Hobby cron is daily-only).
- 2026-08-25 — Weekly digest email (Resend free tier) summarizing all projects.
- 2026-08-25 — Deployment tracker receiving Vercel/GitHub deploy webhooks.

## 🔴 Vulnerabilities

_2026-08-25 security review of plan.md found 15 gaps in the §7.6 threat model — **all fixed same
day** in [`docs/plan.md`](./plan.md) (specs F2/F3/F5, hardening #1/#2/#6/#12–14, threat-table
rows #19–26, §4 schema/indexes, §7.5, §10 tests). Details live in the plan; nothing open here._

### Closed — full-codebase audit 2026-09-28

- **High — vulnerable transitive dependencies.** `npm audit` reported 2 high advisories
  (`js-yaml` <4.3.2 merge-key CPU DoS via eslint, `sharp` <0.35.4 libheif CVEs via Next).
  Fixed with `npm audit fix`; `npm audit` now reports **0 vulnerabilities**. Lockfile updated.
- **High — no CSP anywhere** (plan §7 line 301 required it; §7.6 #6 depends on it). A stored-XSS
  path in the log viewer/notes/vault would have had no second line of defence. Fixed with a
  per-request nonce CSP (`proxy.ts` + `lib/csp.ts`): no `'unsafe-inline'` in `script-src`,
  `object-src`/`frame-src 'none'`, `frame-ancestors 'none'`.
- **High — CSP would have broken the app's own hydration** (found while verifying the fix above).
  `/` was statically prerendered, so its inline hydration scripts had no nonce and would be
  blocked by the strict policy. Fixed with `force-dynamic` + a regression test.
- **Medium — no clickjacking/transport hardening.** `X-Powered-By: Next.js` was being advertised
  and none of `X-Frame-Options`, `nosniff`, HSTS, COOP/CORP, `Permissions-Policy` were set —
  directly relevant to the future secrets-vault reveal button. All added in `next.config.ts`.
- **Medium — indexable private app.** No `robots` meta meant search engines could index an admin
  control center. Now `noindex, nofollow, nocache`.
- **Low — fonts silently unused.** `app/globals.css` set `font-family: Arial` over the Geist vars,
  so two downloaded font families were dead weight (perf + a false sense of theming).

_(none open)_

