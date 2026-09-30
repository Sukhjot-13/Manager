# Suggestions Log

> Design-level items folded into [`docs/plan.md`](./plan.md) stay there. This file tracks
> **open/parked items only**, plus the closed security/audit log.

## 🟢 Improvements
- 2026-09-30 — **Implemented: vault import failure diagnostics.** Encryption is validated before saving; configuration failures return 503, all-failed writes return 500, database failures report safe per-key reasons and sanitized runtime classifications. Dialog preserves input and shows persistent errors; partial saves refresh the list. Vault dates now use an explicit project timezone and stable format to prevent server/browser hydration mismatches.
- 2026-09-30 — **Implemented: Integrate tab synchronized with README.** Added JS/TS downloads, separate channel keys/env, cached optional server setup with Next.js `after`, browser provider and independent analytics, a usable tracker tag from a pasted existing key, verification and troubleshooting. Generated examples have execution regressions; invalid/wrong-kind key text stays out of commands.
- 2026-09-29 — **Implemented: reusable integration guide.** README now covers key placement,
  JS/TS vendoring, static public env reads, isolated request traces, serverless completion,
  independent analytics, verification and troubleshooting. Integrate-page examples also
  stop using expired timestamps and correct server-only initialization and field/rate caps.
- 2026-09-28 — **Add CI**: a GitHub Actions workflow running `npm run verify` (lint + tsc +
  tests + build) and `npm audit --audit-level=high`, plus `npm run test:e2e` on a schedule, so
  the classes of bug fixed on 2026-09-28 (see `to-do.md`) can't silently return.
- 2026-09-28 — **`npm` vs `pnpm` drift**: `plan.md` §2/§5/§10 and §7.6 #10/#26 assume pnpm
  workspaces and `pnpm.lock`; the repo uses npm. The spec should be corrected (or convert the
  lockfile) so the docs stop lying.
- 2026-09-28 — **Spec layout says `src/`**, the app uses root-level `app/` + `lib/`. Update
  `plan.md` §5 to match reality.
- 2026-09-28 — **Saved log filters per browser** were dropped from the log viewer because reading
  `localStorage` during render trips `react-hooks/purity`. Implement with an effect + state
  hydration (or `useSyncExternalStore`) to restore it.
- 2026-09-28 — **Per-dimension cardinality on `daily_stats`**: now capped at 200 keys per
  dimension per day (overflow → `__other__`). A long-term option is dropping dimensions older
  than N days or moving them to their own collection if a spammer keeps inflating them.
- 2026-09-28 — Delete the unused placeholder SVGs (`public/next.svg`, `vercel.svg`, `file.svg`,
  `globe.svg`, `window.svg`) now that the boilerplate landing page is gone.
- 2026-09-28 — Consider an `app/error.tsx` + `app/not-found.tsx` with branded styling; both are
  currently framework defaults.
- 2026-09-28 — Server-side rendering of the log viewer's first page (currently client-fetched
  after mount) would make deep links shareable and improve perceived speed.

## 🟡 New Features
- 2026-08-25 — Reports shared manually for now (JSON/CSV download + printable report page → browser PDF); "Send to…" email-report button (Resend) parked for later, possibly separate script/app.
- 2026-08-25 — Error-spike alerts to Discord/Telegram webhook (post-v1).
- 2026-08-25 — Uptime monitoring via external free pinger hitting `/api/ping` (Vercel Hobby cron is daily-only).
- 2026-08-25 — Weekly digest email (Resend free tier) summarizing all projects.
- 2026-08-25 — Deployment tracker receiving Vercel/GitHub deploy webhooks.
- 2026-09-28 — Alerting on secret reveals: a daily/weekly digest of vault `secret_audit` rows so
  an unexpected reveal pattern is noticed even if nobody is looking at the UI.
- 2026-09-28 — SDK version pinning per project (store the served SDK version on the key so an app
  can tell whether it is running an old vendored copy) — the tracker already versions via `?v=`.

## 🔴 Vulnerabilities

_2026-08-25 security review of plan.md found 15 gaps in the §7.6 threat model — all fixed in the
plan (specs F2/F3/F5, hardening #1/#2/#6/#12–14, threat rows #19–26, §4 indexes, §7.5, §10)._

### Closed — scaffold audit 2026-09-28
- **High** — 2 high-severity transitive advisories (`js-yaml`, `sharp`) → fixed, `npm audit` clean.
- **High** — no CSP anywhere → per-request nonce CSP (`proxy.ts` + `lib/csp.ts`).
- **High** — CSP would have blocked its own hydration on statically prerendered pages → all
  routes dynamic + regression test.
- **Medium** — no clickjacking/transport hardening, `X-Powered-By` advertised → full header set.
- **Medium** — indexable private admin app → `noindex, nofollow, nocache`.
- **Low** — Geist fonts loaded but overridden by an `Arial` body rule.

### Closed — found by loading the apps in a real browser (2026-09-28)
- **High — browser-side log delivery was blocked by CORS in every app.** The SDK sends
  `x-trace-id` for trace correlation, but the ingest preflight only allowed
  `content-type, x-api-key`, so every browser log was dropped by the browser while the SDK
  reported success. Now allowed on both ingest routes, with a regression test asserting the
  preflight, and confirmed live: `source=client` rows with a trace id and captured
  `http_request` context arrive from a real headless Chrome.
- **High — ResumeBuilder's browser logger and tracker were dead.** It was built before the
  `NEXT_PUBLIC_*` trap was found, so its `'use client'` module read `process.env` at runtime
  (empty in the browser) and the integration silently no-opped. Split into `managerConfig`
  (server) and `managerClientConfig` (browser, static member access), with a test that fails if
  a plain `process.env[...]` lookup reappears in the client-facing block.

### Closed — found by loading a real app in a real browser (2026-09-29)
- **High — the analytics tracker has never worked for any app, ever.** `next.config.ts` applies
  `Cross-Origin-Resource-Policy: same-origin` to `/:path*`, which includes `/t.js`. The tracker
  is loaded as a `<script>`, i.e. a *no-cors* request, and CORP is the header that governs
  those — so Chrome rejected it with `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` and no app ever
  recorded a pageview. `Access-Control-Allow-Origin: *` was present and correct the entire
  time, which is exactly why this looked healthy: CORS was never the gate. `/t.js` and
  `/api/t.js` now send `cross-origin`; every other path keeps `same-origin`. Two tests pin
  both halves, including that the relaxed rule is never widened beyond those two paths.

### Closed — found in production on the first deploy (2026-09-29)
- **High — the Projects page crashed in the browser before rendering anything.**
  `TypeError: Cannot read properties of undefined (reading 'Project')` at module evaluation.
  `project-list.tsx` and `project-form.tsx` imported `PROJECT_STATUSES` / `LINK_TYPES` from
  `lib/db/projects.ts`, which also builds the mongoose model at module scope. That dragged
  mongoose into the browser bundle, where Next.js substitutes an empty stub, so
  `mongoose.models.Project` threw before React ever rendered. The client only ever wanted a
  list of status strings. The constants now live in `lib/projectTypes.ts`, which imports
  nothing, and `tests/unit/client-bundle-boundary.test.ts` walks the import graph of every
  `"use client"` file and fails if mongoose is reachable — value imports only, since
  `import type` is erased and would otherwise produce half a dozen false alarms. The boundary
  test was confirmed to fail when the old import is restored. The built client bundle now
  contains no mongoose at all.
  **Pattern worth remembering: a shared constants module must not live in a file that also
  builds a server model.** Any value import from such a file is a page-killing bug that no
  server-side test can see, because the failure is in the browser's module graph.
- **High — the keys screen 400'd on a brand-new install.** The first fix made the project
  selector conditional on `projects.length > 0`, so with no projects yet — exactly the state of
  a fresh database — the form sent no `projectId` and the server answered a bare 400 that said
  nothing about the cause. A project is now always required on the cross-project screen, the
  button is disabled with an explanation when there is nothing to choose, and the decision lives
  in `lib/keyForm.ts` so it is unit-testable without a DOM. Lesson worth keeping: "no options"
  is not the same as "no answer required".
- **High — the E2E suite never touched `/api/keys`.** Zero of its checks exercised the route
  the settings screen actually uses, which is why a 405 on that route shipped despite 57
  passing checks. The suite now mints, lists and revokes a key through `POST /api/keys` over real
  HTTP, including the unauthenticated, missing-project and unknown-project paths.
- **High — `POST /api/keys` did not exist, so no key could ever be issued from the app.**
  `/settings/keys` renders the shared `KeysPanel` with `basePath="/api/keys"` and issues keys
  with `POST`, but that route only exported `GET`: every attempt returned **405** with no error
  in the UI's own code path. The per-project route (`/api/projects/[slug]/keys`) had a POST, so
  the bug only appeared on the cross-project screen, and no test or E2E check issued a key
  through the global route. The fix adds the POST with an **explicit** `projectId` in the body:
  the route has no slug in its path, so without a project named in the request there is nothing
  to bind the credential to, and guessing would file a key under the wrong project. The panel
  now takes the real project list from the caller — it cannot be derived from the loaded keys,
  because a project with zero keys is precisely the one you need to issue a first key for.

### Closed — found while auditing the client key handling (2026-09-28)
- **High — `NEXT_PUBLIC_MANAGER_LOG_KEY` could publish the server key.** Six app facades
  fell back to `NEXT_PUBLIC_MANAGER_LOG_KEY` when `NEXT_PUBLIC_MANAGER_CLIENT_KEY` was unset.
  The name invites setting it to the server `MANAGER_LOG_KEY` value, and anything
  `NEXT_PUBLIC_` is inlined into the public bundle — that would have shipped the `mlk_` key to
  every visitor and misattributed browser logs to `source: "server"`. The alias is removed;
  the browser key is `NEXT_PUBLIC_MANAGER_CLIENT_KEY` and nothing else.
- **Medium — an unverifiable test in french_book.** Its integration suite is an assert/tsx
  file, so `npx vitest` reports "no test suite found"; run it with `npm test`. A vitest-style
  import resolution error also suggested adding a `.js` extension to a TypeScript import,
  which is wrong for this repo and breaks the Turbopack build. Extensionless stays.

### Closed — found while integrating the 7 projects (2026-09-28)
- **High** — `captureGlobalErrors: true` attached `process.on('uncaughtException'/'unhandledRejection')`;
  under Next.js this silently stopped all log delivery while the app kept working. Now
  `captureProcessErrors`, default off, with the reason documented in the SDK.
- **High** — `captureConsole: null` threw inside `initLogger` (`Cannot read properties of null
  (reading 'filter')`), which is the idiomatic way to disable console capture. Now valid.
- **High** — Next.js only inlines `process.env.NEXT_PUBLIC_X` when written as a static member
  access; a `process.env[name]` lookup in a `'use client'` module returns undefined, so the
  browser logger and the analytics tracker were silently dead while the tests passed. The
  server/client config split is now enforced and verified against the built bundle.
- **Medium** — a logger created in `instrumentation` is not the instance route handlers see
  (separate module graphs); the SDK also relies on a 5 s timer that serverless can freeze. The
  facade now creates the logger lazily per request, caches it on `globalThis`, and flushes.
- **Medium** — analytics "today" ignored `APP_TZ`: buckets are UTC-keyed (per plan) but the
  window was UTC too, so a UTC-4 owner saw an empty dashboard every evening. Day windows now
  resolve against the display timezone.
- **Low** — an analytics test rewound events by a fixed 30 minutes, so it only passed while
  `now - 30m` shared the UTC day with `now` and failed for 30 minutes after every midnight.
- **Low** — `scripts/provision-projects.ts` defaulted `MANAGER_ENDPOINT` to `localhost:3000`,
  which is the *consuming app's* port, not Manager's; it now takes `MANAGER_PUBLIC_ORIGIN`.

### Closed — full-build audit 2026-09-28
- **High** — `verifyApiKey` rejected ~4.4% of generated keys (prefix shape check broke on
  base64url), silently breaking integration for those projects.
- **High** — `daily_stats` map fields rejected `.`/`$` keys, so any external referrer could throw
  and take the analytics dashboard down; also unbounded cardinality.
- **High** — tracker served at the wrong path (`/api/t.js` vs the advertised `/t.js`): every
  embed snippet would have 404'd.
- **High** — delegated permission management was unreachable dead code (rank gate), and rank
  validity was never checked, so a malformed rank still granted access.
- **Medium** — `x-vercel-ip-country` trusted verbatim (client-settable off-Vercel) → 2-letter
  validation at the source.
- **Medium** — root admin could not manage other admins; self/last-admin protections fired after
  scope assertions and returned misleading codes.
- **Low** — `lib/validation.ts` imported an enum from the wrong module (crash at import),
  `proxy.ts` mutated immutable redirect headers (throw on unauthenticated page loads),
  `/settings/keys` guarded by the wrong permission, duplicate mongoose index declarations.

_(none open)_

### Closed — ResumeBuilder integration verification 2026-09-29

- SDK metadata errors lost top-level stacks and different exceptions collapsed under generic wrapper messages. Native/serialized errors now retain bounded, redacted stacks.
- Browser fetch tracing only worked with mutable `Headers` instances. Same-origin requests now support absent/object/tuple/Headers/Request headers without mutating caller options or adding third-party preflights.
- SDK uploads suppressed unrelated console errors and fetch tracing for the whole network wait. Suppression now covers only the synchronous transport invocation, with a delayed-upload regression test.
- Trace timelines displayed newest-first with negative elapsed gaps. The combined journey now displays chronological rows; feed ordering and pagination remain unchanged.
- Both lint warnings were removed without introducing a runtime mongoose import into client code.
- Repeated SDK errors disappeared after a flush, and ingest merged matching errors across traces/sources. Repetition is now restricted to queued same-trace entries; ingestion preserves separate journey/source rows and counts bounded SDK repetition hints.

## Implemented documentation update — 2026-09-30

Required, feature-specific and optional environment settings are now listed in README against the current code, including standalone helpers and deployment/rebuild behavior. Fresh database setup and public/private Manager key separation are documented; obsolete provider/secret names are identified. No runtime configuration or credentials changed.

## Implemented project-form fix — 2026-09-30

The form offered automatic slugs when left blank, but its empty string failed the shared API schema and returned 400. Blank/whitespace project slugs now normalize to omitted, allowing automatic unique slugs on creation and preserving the existing slug on edit. Explicit malformed slugs remain rejected. Integration regressions exercise the actual route against isolated MongoDB.

## Implemented project validation feedback — 2026-09-30

Project create/edit failures now expose field paths and validation reasons instead of only an issue count. The form renders an accessible list with friendly field/link-row labels, distinguishes session/permission/conflict/server/network failures, and clears the saving state after failed requests. Missing/whitespace names and malformed JSON receive actionable feedback. The previous blanket “Slug already in use” for every server failure was misleading; actual conflicts now return 409. The edit collision query compared an ObjectId against a slug and ignored its result; unchanged slugs now save normally, and another project's slug is rejected. Changes remain local.

Verification: 403/403 tests, lint and type checking passed. A production build with isolated synthetic configuration and 17/17 Chromium checks verified real UI login, simultaneous name/slug/link errors, corrected auto-slug creation, unchanged-slug editing, edit validation, and saving-state recovery for validation, simulated 500 and aborted network requests. The temporary database was destroyed and both server/browser stopped.

## 2026-09-30 — Log retention and action feedback

- Implemented requested 48-hour application log retention and route/link pending feedback. Existing TTL indexes require an in-place migration rather than merely changing the Mongoose schema.
- Shared parent AGENTS.md feedback rules were added after Sukhjot refined the proposal: user-friendly, concise toasts; detailed, redacted logs. Repository-specific AGENTS.md files remain intact.
