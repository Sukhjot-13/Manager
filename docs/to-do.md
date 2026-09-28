# To-Do

> Session handoff. Newest first. Product phases live in [`plan.md`](./plan.md) §6 (all complete).
> Inventory: [`architecture.md`](./architecture.md) · open ideas: [`suggestions.md`](./suggestions.md)

## 2026-09-28 — Full build P0 → P5 + hardening

**Verification:** `npm run verify` → lint clean, `tsc --noEmit` clean, **337 tests green**,
production build clean. `npm run test:e2e` → **57/57 checks** against a real production server
backed by a real MongoDB (login, projects, keys, log ingest, viewer, trace view, CSV export,
vault reveal + audit, analytics ingest + rollups, tracker, SDK download, kill switches, users,
role isolation, logout).

### Shipped

- **Foundation** — env access (fail closed), cached mongoose connection, models + indexes from
  plan §4, AES-256-GCM crypto, `jose` sessions, centralized permission system, rate limiting
  (memory + durable), settings store, audit log.
- **P0** — login with generic errors + per-IP/per-account lockout, `proxy.ts` session guard with
  CSP, cookie policy, dashboard shell, `/api/ping`, `scripts/create-user.ts`.
- **P1** — projects CRUD, statuses, tags, emoji/colour, links, markdown notes, search/filter,
  grid+table views, GitHub enrichment with refresh.
- **P2** — vault: per project+environment encryption, masked lists, 30 s reveal + copy, audited
  reveal/copy/export/import, `.env` import/export behind confirm + password, resumable master-key
  rotation.
- **P3** — API keys (shown once), hardened log ingest (all 14 hardening rules), full viewer
  (All/Server/Client, filters, trace view, error grouping, live tail, detail drawer, CSV/JSON
  export), Integrate page, zero-dependency isomorphic SDK + key-gated single-file download.
- **P4** — public `t.js` tracker (SPA-aware pageviews, click maps, custom events, UTM, batching,
  `sendBeacon`), kind-scoped event ingest, lazy daily rollups, analytics dashboards + overview.
- **P5** — users & roles UI (roles, per-user overrides, delegated permission managers with rank
  boundary + permission ceiling), global settings, GitHub enrichment.

### Real bugs found and fixed during the build (all now regression-tested)

1. `verifyApiKey` rejected ~4.4% of every key it generated (`prefix.split("_")` broke on
   base64url `_`) — replaced with a `/^(mlk|mck|mak)_/` shape check.
2. `daily_stats` used mongoose `Map` fields, which **reject `.` and `$` keys** — every external
   referrer (`https://google.com`), dotted path or classed click target would 500 the analytics
   dashboard. Dimensions are now plain objects, plus a 200-key-per-dimension cap.
3. The tracker was served at `/api/t.js` while every embed snippet pointed at `/t.js` (404).
   Added the root route (shared handler) + regression test.
4. Delegated permission management was dead code: `permissions.manage` had an ADMIN-only rank so
   `assertCanManageTarget` always threw. Now granted by an active management scope.
5. `can()` ignored rank validity — a `NaN`/mismatched rank still granted access. Now fails closed.
6. Root admin could not manage other admins (the protected-target check blocked everyone).
7. `assertCanManageTarget` reported "rank boundary" when the real problem was self-management.
8. `lib/validation.ts` imported `ENVIRONMENTS` from the wrong module — crashed at import time.
9. `proxy.ts` used `Response.redirect` headers (immutable) → threw on unauthenticated page loads.
10. `/settings/keys` was blocked by the `settings.manage` proxy guard despite needing `keys.view`.
11. `x-vercel-ip-country` was trusted verbatim; now validated to a 2-letter code.
12. Self-disable/self-delete and last-admin protections fired after the scope assertions, so they
    returned the wrong (less accurate) error codes.
13. Duplicate mongoose index declarations on `logs.ts` / `events.ts` / `secret_audit.ts`.
14. `globals.css` forced Arial over the Geist fonts, and a `color-scheme` rule overrode itself.
15. **First run was a bare 500**: with no `.env.local` the login route threw and returned an empty
    500, so a fresh clone looked broken for no stated reason. Added `lib/readiness.ts`, a readiness
    gate on login (503 + the exact missing variable names), a setup notice on `/login`, and
    `/api/ping` now reports `ok/setup/database/missingEnv` (names only, never values).

### You must do these two things (they need your accounts, not the code)

- [ ] Create the free **MongoDB Atlas M0** cluster, allow your Vercel IPs (or `0.0.0.0/0` for
      Atlas) and put the URI in `MONGODB_URI` in `.env.local` **and** in Vercel env vars.
- [ ] Generate `AUTH_SECRET`, `ENV_MASTER_KEY`, `VISITOR_PEPPER` (commands in `README.md`), set
      `ADMIN_EMAIL`/`ADMIN_PASSWORD`, deploy to Vercel, and **back up `ENV_MASTER_KEY` offline**.

## 2026-09-28 — Integration documentation pass

Answering "can another app work out how to use this from outside?":

- The vendored SDK file (`packages/logger/dist/logger.ts`) now carries a full usage header —
  install command, init options, all six levels, child loggers, timers, trace correlation,
  shutdown, behaviour under the hood, and the plain-HTTP contract with limits. A dev who
  lands `src/lib/logger.ts` in their repo can use it without visiting Manager.
- `README.md` gained an **Integration contract** table (key kinds, source scoping, batch/field
  caps, timestamp guard, server-stamped fields, generic 401, 429 + `Retry-After`, kill
  switches, header-only SDK auth, retention) plus copy-paste SDK, HTTP and tracker examples.
- Each project's **Integrate** page is now the single stop: it previously covered only logs, so
  the analytics snippet and the contract list were added there (the snippet arrives with the
  project's real key from the server; without an analytics key it points at *API keys*).
- Readiness/first-run behaviour is documented in `README.md` § Setup.
- Tests: the zero-import guarantee for the bundle is now comment-aware (the new usage header
  contains `import … from` examples), plus a new test asserting the bundle documents itself.

Verification: `npm run verify` → lint clean, tsc clean, **338 tests**, build clean.

Optional follow-ups are in [`suggestions.md`](./suggestions.md) (saved log filters, cap on
`daily_stats` growth, CI workflow, npm-vs-pnpm spec drift, unused placeholder SVGs).
