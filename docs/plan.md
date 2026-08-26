# Manager — Personal Project Control Center

> One web app to manage all my projects: registry, centralized logging, secrets vault,
> GitHub links, and analytics.
>
> Status: **PLAN** (nothing built yet)
> Created: 2026-08-25

---

## 1. Goals

| # | Goal |
|---|------|
| G1 | Single hub listing **all my projects** (status, links, notes, tech stack) |
| G2 | **Centralized logger** — my other apps ship client + server logs here via an SDK |
| G3 | **Secrets vault** — env variables stored encrypted, hidden until eye-button reveal |
| G4 | **GitHub links** per project (+ optional repo metadata) |
| G5 | **Analytics** — pageviews, clicks, events, referrers, devices, countries for any site that embeds my tracker |

Non-goals (for now): team collaboration, billing, public APIs for third parties. Reports/sharing + alerting features are deferred post-v1 (parked §9).

---

## 2. Locked-in Decisions

### Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript** | One app for UI + API routes; deploys natively to Vercel free tier |
| Database | **MongoDB Atlas M0 (free)** | Never sleeps (critical: a paused Supabase free DB would silently drop logs); documents fit varied log/event payloads; Mongoose for schemas |
| Styling | **Tailwind CSS + shadcn/ui** | Best-in-class open-source component system; fast to build clean dashboards |
| Charts | **Recharts** | React-native API, powers shadcn charts, SVG output (print/PDF friendly) |
| Auth | **Simple custom auth** — one admin, `jose`-signed HttpOnly cookie | Credentials live in env vars (`ADMIN_EMAIL`/`ADMIN_PASSWORD`); ~50 lines total, no auth library. **Numeric access-level system (§7.5) wired into every feature from day one** so multi-user roles work by just adding users later |
| Validation | **Zod** | Validate ingest payloads + forms |
| Icons/toasts | lucide-react, sonner | Standard shadcn companions |
| Dates | date-fns | Light, tree-shakeable |
| Device parsing | ua-parser-js (**exact version pinned** — supply-chain-hijacked once in 2021) | Browser/OS/device from user agents |

### Why Mongo Atlas over Supabase (decided)

- Supabase free projects **pause after ~1 week of inactivity** — unacceptable for a log-ingest endpoint that must always accept writes.
- Atlas M0: 512 MB free, never sleeps, no credit card. Enough for years at personal traffic if we use **TTL retention + daily rollups** (see §8).
- Escape hatch: all DB access goes through `src/lib/db/*` modules — swap to Postgres later without touching features.

### Hosting

- **Vercel Hobby (free)** + MongoDB Atlas M0.
- Secrets on Vercel: `MONGODB_URI`, `AUTH_SECRET`, `ENV_MASTER_KEY`, `VISITOR_PEPPER`, optional `GITHUB_TOKEN`.

---

## 3. Feature Specs

### F1 — Projects Hub

- CRUD for projects: name, slug, description, emoji/color, **status** (`idea | building | live | paused | archived`), tags (tech stack).
- Links block per project: GitHub repo(s), live URL, docs, any custom link.
- Optional GitHub enrichment: fetch stars / open issues / default branch / last push via GitHub REST API (cached, uses `GITHUB_TOKEN` if present).
- Markdown notes per project (changelog / reminders).
- Views: grid of cards + table view; global search.

### F2 — Logger (the big one)

Every other app gets an API key (per project). Two integration paths:

**A. JS/TS SDK (`@manager/logger`, lives in this repo — PRIVATE, never published to npm)**

Distribution (no public registry — pick per app):

1. **Vendored single file (recommended default)** — the SDK is written as one self-contained
   `logger.ts` (~zero runtime deps). Manager UI has an "Integrate" page per project with a
   one-liner to pull it into any app:
   ```bash
   curl -fsSL -H "x-manager-key: <project-key>" \
     "https://manager.example.com/api/sdk/logger" -o src/lib/logger.ts
   ```
   Key-gated download (revocable), then init in code. Updates = re-run the command.
   Zero registry, zero auth setup, fully offline-friendly, easy per-app diffs.
   The key travels ONLY in a header — never a URL query string (URLs leak into shell
   history, browser history and proxy/Vercel request logs). Route replies `Cache-Control: no-store`.
2. **Local path dep** (apps checked out next to manager): `"@manager/logger": "file:../manager/packages/logger"`
3. **Git dep from private repo** (optional): `pnpm add github:sukhjot/manager#main&path:packages/logger`
   (works with pnpm's git `path` syntax; needs repo access on the machine)

Source lives modular in `packages/logger/src/`; the monorepo bundles it (tsup) into ONE
zero-dependency artifact — what gets vendored/downloaded is a single `.ts/.js` file.
TypeScript included, no transitive deps.

```ts
import { initLogger } from "@manager/logger";

const log = initLogger({
  endpoint: "https://manager.example.com",
  appId: "my-store",
  apiKey: "mlk_...",
  environment: "production",          // dev|staging|prod|custom
  release: "git-sha-or-version",      // optional
  captureConsole: ["warn", "error"],  // intercept console
  captureGlobalErrors: true,          // window.onerror + unhandledrejection / process handlers
  captureFetch: true,                 // fetch/XHR status+duration (client)
  redactKeys: ["password", "token", "authorization"],
  sampleRate: { debug: 0.1 },         // per-level sampling
});

log.trace?.("render", { component: "Cart" });      // levels: trace|debug|info|warn|error|fatal
await log.error("payment_failed", { code: "card_declined" });
const req = log.child({ requestId });              // child logger w/ bound context
req.info("order_created", { orderId });
log.time("db_query"); /* ... */; log.timeEnd("db_query");   // durationMs auto-recorded
await log.flush();                                  // graceful-shutdown flush (Node hooks auto)
```

SDK features (all v1 — no retrofitting later):
- **Isomorphic**: browser + Node; transport = `navigator.sendBeacon` on unload / fetch elsewhere.
- **Levels**: `trace | debug | info | warn | error | fatal`.
- **Child loggers** with inherited context (requestId, userId…).
- **Timers**: `time/timeEnd` records `durationMs` — perf tracing without extra libs.
- **Batching**: flush @ 5 s or 20 entries; exponential backoff + jitter retry; offline queue (client localStorage, Node memory) replayed on reconnect.
- **Auto-capture**: console (opt-in levels), uncaught exceptions + unhandled rejections (both platforms), fetch/XHR outcomes (client).
- **Rich auto-context, every log saved with**: client → URL, route, referrer, UA (+parsed browser/OS/device), viewport/screen, language, timezone, connection type, persistent `sessionId`, `pageId`, appVersion/release/environment; server → hostname, pid, node/runtime version, RSS memory, uptime.
- **Trace correlation (killer feature)**: SDK generates a `traceId` per user action/journey and sends it as `x-trace-id` on calls to YOUR apis; server SDK middleware picks it up → one query shows the full client→server story of a request.
- **Redaction**: configured key names masked (`***`) before anything leaves the app.
- **Error fingerprinting**: hash(message + top stack frame) → duplicates collapse into one grouped entry with a counter (see 10k× once, not 10k times).
- **Self-protection**: internal rate limiter (max ~50 logs/s), never logs its own transport failures recursively, hard payload caps.

**B. Plain HTTP ingest API** (for non-JS apps later)

```
POST /api/ingest/logs
Header: x-api-key: mlk_...
Body:   { logs: [{ level, message, meta?, ts }] }
```

**Log Viewer (per project):**

- **Source views — separate & together**: segmented tabs `All | Server | Client`; default `All`
  (merged chronological stream, each row badged 💻/🖥). Plus a **"Together" trace view**: click a
  `traceId` (or paste one in search) → merged timeline of that request's client AND server logs,
  so you see exactly what the browser did and what the server did next.
- Filters: level multi-select, source, environment, release/version, full-text search, date range, sessionId, traceId; saved filters kept per browser. User search input is escaped before any `$regex` use (ReDoS + full-collection-scan guard).
- Pagination: **cursor-based keyset seek** (`ts` + `_id`) — never `skip()/limit()`; stays fast at millions of docs.
- **Error grouping panel**: entries collapsed by fingerprint → count, first/last seen, mini trend sparkline; expand to sample instances.
- Detail drawer: pretty JSON, parsed stack trace, full context metadata table, copy-JSON, deep-link permalink.
- Live tail toggle (polling every 3–5 s — WebSockets awkward on Vercel serverless), auto-pauses on scroll-back.
- Export current filtered view as CSV/JSON. The CSV writer neutralizes formula injection:
  cells starting with `=`, `+`, `-`, `@`, tab or CR get a leading `'` (log text is attacker-writable).
- Rate limit per API key protects free tier; invalid/unknown key ⇒ generic 401 (logged).

### F3 — Secrets Vault (env variables)

- Per project + **environment** (`dev | staging | prod`).
- Values **encrypted at rest**: AES-256-GCM with `ENV_MASTER_KEY` (stored only in Vercel env vars, never in DB). Fresh random 12-byte IV every write — IV reuse breaks GCM catastrophically; each row stores `keyVer`.
- List view shows **masked** values (`sk-live-••••••••7f2a`).
- 👁 Eye button → on-demand decrypt (single-value API call) → visible 30 s → auto re-mask. Every reveal is written to an audit log (who/when/key).
- Copy-to-clipboard button (copies decrypted value, never renders it in DOM longer than needed).
- Bulk ops: paste `.env` file to import many at once; export decrypted `.env` download — guarded by type-to-confirm + password re-entry + audit entry (mass-exfiltration brake); response sent `Cache-Control: no-store`.
- Keys are searchable; values are NOT searchable (never leave encryption unless explicitly revealed).
- **Master-key safety**: `ENV_MASTER_KEY` is backed up offline (password manager) — losing it loses every secret forever. Rotation happens ONLY via a built-in re-encrypt-all routine (decrypt with old → encrypt with new → atomic swap), written and tested before any rotation. The per-row `keyVer` makes rotation **crash-safe and resumable**: a mid-migration crash leaves old-version rows readable and the routine resumes where it stopped — nothing is double-encrypted or orphaned.

### F4 — GitHub Links

- Covered in F1 (link fields + enrichment).
- Later: commit/deploy feed per project (Phase 6+, needs webhook or token polling).

### F5 — Analytics

Sites embed a tiny tracker (no SDK needed):

```html
<script async src="https://manager.example.com/t.js?v=1"
        data-app="my-site" data-key="mak_live_••••"></script>
```

Tracker (`t.js`, served by an API route, ~2 KB gzipped; served with
`Cache-Control: public, max-age=31536000, immutable` + versioned query param `/t.js?v=N`
so updates propagate instantly on a version bump):
- **Auto-tracks**: pageviews (SPA history-hook included), referrer, UTM params.
- **Auto-click maps**: records clicks as `[path] element-text (#id .class)` — answers "which page/button got clicked how many times". Element text truncated (~100 chars) — PII minimization.
- **Custom events**: `window.__mgr('event', 'signup_clicked', {plan:'pro'})`.
- Identity: **anonymous visitor id** = daily-rotating **HMAC-SHA256(IP + UA, `VISITOR_PEPPER`)** —
  keyed with a server-side secret env var. A plain SHA-256 over low-entropy IP space is
  brute-forceable offline; the secret pepper makes reversal infeasible. No cookies, still gives
  uniques; rotating the pepper simply starts a fresh uniques count.
- **Bot filtering**: UA heuristics (bot/crawler/spider/headless) dropped at ingest — analytics stay human-only.
- Geo/country: from Vercel's free `x-vercel-ip-country` request header — zero extra cost.

Ingest: `POST /api/ingest/events` (sendBeacon, batched). `navigator.sendBeacon` cannot set
custom headers, so the tracker carries its **analytics key** (`mak_…`, key-kind `analytics`)
inside the POST body. That key is public-by-design (readable in any page's source) but
kind-scoped: it can ONLY write `events` — never `/api/ingest/logs` — and gets tighter rate
limits, a referer soft-check and the per-project kill switch.

Dashboard per site (shadcn/Recharts):
- Visitors & pageviews over time (today / 7d / 30d / custom range)
- Top pages, top clicked elements/events, entry pages
- Referrers/sources, UTM breakdown
- Devices / browsers / OS, countries map/list
- Live "active now" (last 5 min)

Timezone contract (locked now so rollup shape never changes): store UTC everywhere;
`daily_stats.date` buckets computed in UTC; dashboards render in one configured display
timezone (`APP_TZ`, default UTC).

### F6 — Sharing & Reports

> **Deferred** — wanted later (tracked in `docs/suggestions.md` + parked list §9), not in the
> v1 build phases. The log-viewer's CSV/JSON export (F2) stays; that belongs to the logger.

---

## 4. Data Model (MongoDB collections)

```
users          (future) { email, passwordHash, accessLevel, createdAt }  // schema fixed now; v1 admin = env creds at level 0; extra users added manually via scripts/create-user.js until automated
projects       { name, slug, description, status, tags[], color, emoji,
                 links: [{ type: "github"|"live"|"docs"|"other", url, label }],
                 notesMd, createdAt, updatedAt }
api_keys       { projectId, name, kind: "server"|"client"|"analytics", keyHash, prefix,
                 lastUsedAt, revokedAt?, createdAt }   // kind scopes endpoint + writable source
logs           { projectId, level, message, meta(raw payload), stack?, fingerprint?, count?,
                 source: "client"|"server", sessionId, pageId?, traceId?, requestId?,
                 url?, route?, referrer?, ua?, browser?, os?, device?,
                 viewport?, lang?, tz?, connection?,
                 ip?, country?, appVersion?, environment?, release?,
                 hostname?, pid?, runtimeVersion?, rssMb?, uptimeSec?,
                 durationMs?(timers), ts(client clock), receivedAt(server clock) } // TTL ~30 days
events         { projectId, type: "pageview"|"click"|"custom", name, path,
                 props, visitorId, referrer, utm, device, browser, os,
                 country, ts, receivedAt }                  // TTL ~90 days
daily_stats    { projectId, date, pageviews, visitors, byPath{}, byCountry{},
                 byReferrer{}, byDevice{}, clicksByTarget{}, ... } // rollup, kept forever
secrets        { projectId, environment, key, valueEnc, iv, tag, keyVer, updatedAt }
                 // iv = fresh random 12 bytes EVERY write (GCM); keyVer = master-key version
                 // that encrypted this row (crash-safe rotation)
secret_audit   { secretId, action:"reveal"|"copy"|"export", actor:"admin", ip, ts }  // TTL ~180 days
rate_limits    { key, windowStart, count }
```

Indexes: `logs (projectId, ts desc)` (+ `_id` for keyset pagination), `events (projectId, ts desc)`, TTL on `logs.ts` / `events.ts` / `rate_limits.windowStart` / `secret_audit.ts`, unique `(projectId, environment, key)` on secrets, **unique `(key, windowStart)` on `rate_limits`** — without it, concurrent serverless instances' upsert-`$inc` races fork duplicate window docs and silently under-count the authoritative limiter.

---

## 5. App Structure

```
src/
  app/
    (auth)/login/
    (dash)/
      dashboard/page.tsx          # overview: project cards + quick stats
      projects/[slug]/page.tsx    # project detail (tabs: overview|logs|analytics|env|links)
      settings/page.tsx           # api keys, master key status, retention
    api/
      auth/login/route.ts         # verifies env credentials, sets signed cookie
      ping/route.ts               # health check { ok: true } — public, no auth (generic)
      ingest/logs/route.ts
      ingest/events/route.ts
      t.js/route.ts               # serves tracker script
      sdk/logger/route.ts         # serves vendored logger.ts (token-gated download)
      secrets/[id]/reveal/route.ts
      exports/[...]route.ts       # json/csv download of current filtered log view
  lib/
    db/            # mongoose models + connection cached on globalThis across serverless invocations (DB swap point)
    crypto.ts      # AES-256-GCM encrypt/decrypt
    ratelimit.ts
    github.ts
  packages/logger/  # @manager/logger SDK (workspace package)

scripts/
  create-user.js    # manual user creator — reads CREATE_USER_EMAIL / CREATE_USER_PASSWORD /
                    # CREATE_USER_ROLE from env or interactive prompt (NEVER hardcoded in the
                    # file — commit-leak risk); run `npm run create-user` (temporary until automated)
```

Monorepo via **pnpm workspaces** so the SDK version-controls alongside the app.

---

## 6. Build Phases

- [ ] **P0 — Skeleton**: scaffold Next.js + Tailwind + shadcn, Mongo connection, simple admin login (env creds + signed cookie + middleware guard), `/api/ping` health route, dashboard shell/nav
- [ ] **P1 — Projects Hub**: project CRUD, links, statuses, tags, search, notes
- [ ] **P2 — Secrets Vault**: encrypt/decrypt, masked list, eye reveal + audit, .env import/export, environments
- [ ] **P3 — Logger**: API keys mgmt, hardened ingest API, full SDK (levels, child loggers, timers, batching/retry/offline queue, auto-capture, trace correlation, redaction, fingerprinting), log viewer with All/Server/Client tabs + trace view + error grouping + live tail + exports, per-project "Integrate" page with copy-paste install command (tokenized `logger.ts` download)
- [ ] **P4 — Analytics**: tracker script, event ingest, daily rollup job (on-read lazy aggregation), dashboard charts
- [ ] **P5 — Polish/later**: multi-user roles UI, GitHub activity feed

Each phase ships usable software; order chosen so P3/P4 (data producers) come after P1 (they attach to projects).

---

## 7. Security Notes

- API keys stored **hashed** (like passwords); UI shows prefix + full key only once at creation.
- All dashboards, settings and exports require the session cookie; only `/api/ingest/*`, `/t.js`, `/api/sdk/logger` are public-by-design.
- Secrets: envelope encryption, master key never leaves env, reveal actions audited, no value ever in list/search responses.
- **`Cache-Control: no-store` on every authenticated GET** (secret reveal/copy, exports, dashboards, SDK download) — a CDN- or browser-cached reveal response IS a leaked secret.
- Repo hygiene: `.gitignore` ships in Phase 0 **before** the first commit — `.env*` already exists locally and must never enter git history.
- CSP headers via `next.config` middleware basics.

### Ingest endpoint hardening (`/api/ingest/logs`, `/api/ingest/events`)

These are the only intentionally-public write endpoints — defense in depth:

1. **Auth**: `x-api-key` required; stored hashed → lookup by prefix, then **constant-time compare** (`crypto.timingSafeEqual`). Unknown/mismatched ⇒ generic 401 (no detail leakage). Each key carries a **`kind`** (`server | client | analytics`) that scopes which endpoint it may hit and which `source` it may write — an `analytics` key can never post logs; a leaked browser-exposed key can't forge `source: "server"` rows.
2. **Strict schema validation (Zod)**: whitelist every field; `level` must be enum; unknown keys stripped/dropped; `message` ≤ 1 KB, `meta` JSON-stringified ≤ 8 KB; batch array max **100** items (reject or truncate-with-flag). **Server-set fields are rejected from payloads entirely** — `source`, `ip`, `country`, `hostname`, `pid`, `runtimeVersion`, `rssMb`, `uptimeSec`, `receivedAt` are derived/stamped server-side and never trusted from the request body (otherwise clients forge IPs and fake "server" logs).
3. **Size caps**: route-level body limit (~128 KB); reject early with 413 before parsing.
4. **Per-key rate limiting**: two layers —
   - fast in-memory token bucket per serverless instance (stops bursts), plus
   - durable counter doc in Mongo (`rate_limits`) for cross-instance accuracy;
   e.g. 60 req/min & ~5k events/hour/key, configurable per project; 429 + `Retry-After`.
5. **Kill switches**: global "ingest on/off" toggle + per-project toggle (settings page) so a runaway app can't flood the free tier.
6. **Content-type check**: accept only `application/json`; CORS on ingest routes restricted to `POST/OPTIONS` + `content-type`/`x-api-key` headers (`Access-Control-Allow-Origin: *` is acceptable there because payloads are validated + rate-limited and carry no credentials). `*` is **never** granted on `/api/sdk/logger` (key-gated route).
7. **Sanitization at rest**: strip control chars, cap string lengths, store UA truncated; never `eval`/render raw log text in viewer (React escapes by default — keep it that way, no `dangerouslySetInnerHTML`).
8. **Monitoring**: track rejected-request counts per key, surfaced in the dashboard (ingest kill switches handle abuse).
9. **Optional later**: IP allowlist per project, mTLS not needed at personal scale.
10. **Replay/stale-write guard**: reject log/event entries whose client `ts` is older than 24 h or more than 10 min in the future (skew-tolerant); every row stores both client `ts` AND server `receivedAt`, so forged clocks can't rewrite history.
11. **Rate-limit durability caveat**: in-memory buckets are per-serverless-instance (approximate); the Mongo `rate_limits` counter is the authoritative cross-instance limit — checked cheaply (one atomic `$inc` on a TTL window doc) protected by a **unique `(key, windowStart)` index** so upsert races can't fork duplicate counters.
12. **Analytics keys are public-by-design**: `navigator.sendBeacon` can't set headers ⇒ the tracker puts its `mak_` key in the POST body; kind-scoped (events only), tight limits, referer soft-check, kill switch (see F5).
13. **CSV export formula-injection guard**: exported cells beginning with `=` `+` `-` `@`, tab or CR are prefixed with `'` before writing (log/event text is attacker-writable).
14. **Key material from a CSPRNG only**: API keys, `AUTH_SECRET`, `ENV_MASTER_KEY`, `VISITOR_PEPPER` generated via `crypto.randomBytes` ≥ 256 bits — never `Math.random`, never human-typed.

### Multi-user upgrade path (kept simple now)

v1 auth = env creds + `jose`-signed HttpOnly cookie (`auth=...`, 7d expiry) checked in middleware
for all `(dash)` routes and non-ingest APIs. The cookie is **stateless**: logout clears only the
browser copy, credential/level changes take effect on next login, and rotating `AUTH_SECRET`
is the instant global kill-switch (the ONLY true server-side revocation). To add users later:
create `users` collection, swap credential check for DB lookup + bcrypt, assign each user their
access level — no feature code changes (every feature already gates through the permissions map).

### 7.5 Access Levels (RBAC) — designed now, activated later

Numeric model: **lower number = more power**. Admin `0`, Developer `90`, User `100`.

**Admin is special-cased: unlimited access to everything, period.** `can()` short-circuits
to `true` for admin BEFORE consulting the map — so adding/removing/retuning permissions can
never lock the owner out. The Developer/User numbers are **placeholders** ("dev gets X, free
user gets Y") — exact tiers are decided when multi-user actually ships; until then only
level 0 exists.

```ts
// src/lib/permissions.ts  (single source of truth)
export const LEVELS = {
  ADMIN: 0,       // Sukhjot — unlimited access, bypasses the map entirely
  DEVELOPER: 90,  // placeholder — tune when multi-user ships
  USER: 100,      // placeholder — free-tier number decided later
} as const;

export const PERMS = {
  // these numbers gate NON-admin roles only — safe to retune anytime
  "projects.view":   100,
  "projects.edit":    90,
  "logs.view":       100,
  "analytics.view":  100,
  "exports.download": 90,
  "secrets.view":     90,
  "secrets.reveal":   50,  // eye button — tighter than view
  "secrets.edit":     30,
  "keys.manage":      20,
  "users.manage":      0,
  "settings.manage":   0,
} as const;

export const can = (level: number, perm: keyof typeof PERMS): boolean =>
  level === LEVELS.ADMIN || level <= PERMS[perm];
```

Enforcement points (all present in v1 even though only level 0 exists):
- **Server**: `requirePerm("secrets.reveal")` helper called in every server action / API route — never trust the client.
- **Routes**: middleware blocks pages by top-level perm before render.
- **UI**: nav items / buttons read the same map and hide themselves (cosmetic only).
- Session cookie carries `{ email, level }`; because it is stateless, a level change applies on
next login (or instantly for ALL sessions via `AUTH_SECRET` rotation) — a signed JWT can't be invalidated mid-flight.

v1: the single env-admin is simply assigned level 0 (= everything unlocked, zero permission
friction — it's your app). Adding a teammate later =
insert `{ email, passwordHash, accessLevel: 90 }` into `users` — done. Per-feature tuning =
edit one number in `PERMS`. Future niceties (per-user overrides, audit per level) bolt onto the same map.

**Manual user creation (until automated management ships):** a tiny one-off script,
`scripts/create-user.js`, planned for when extra users are first needed. Workflow: provide
`CREATE_USER_EMAIL` / `CREATE_USER_PASSWORD` / `CREATE_USER_ROLE` (`admin | developer | user`)
as env vars or via the interactive prompt — credentials are **never written into the file**
(that risks committing them) — then run `npm run create-user` → it bcrypt-hashes the password
and upserts `{ email, passwordHash, accessLevel, createdAt }` into `users`. Admin = unlimited
(§7.5); developer/user numbers are placeholders to tune later. Replaced by proper UI management
whenever that phase lands.

### 7.6 Threat model — every vulnerability & its solution

| # | Threat | Solution |
|---|--------|----------|
| 1 | Public ingest endpoints abused/flooded | Key auth + Zod whitelist + size caps + per-key rate limits + global/per-project kill switches (full spec §7 above) |
| 2 | DB leak exposes vault secrets | AES-256-GCM encryption at rest; `ENV_MASTER_KEY` lives ONLY in Vercel env vars (never in DB/code); reveal actions audited |
| 3 | DB leak exposes ingest API keys | Keys stored SHA-256 hashed; prefix lookup + `timingSafeEqual`; full key shown once, revocable anytime |
| 4 | Admin login brute force | Strong generated password; **per-IP + per-account** attempt counters in Mongo w/ exponential lockout (5 fails → 15 min) — deliberately NO global counter (attackers would weaponize it to lock the owner out); generic error messages; no username enumeration |
| 5 | Session cookie theft | Cookie: HttpOnly + Secure + SameSite=Lax + signed (jose); 7-day expiry; rotating `AUTH_SECRET` invalidates ALL sessions instantly (the only true server-side revocation — stateless JWTs can't be individually revoked); logout clears the browser cookie |
| 6 | XSS via stored content (log text, markdown notes, event props) | React auto-escaping everywhere; **no `dangerouslySetInnerHTML`**; markdown notes rendered through sanitizer (`sanitize-html` server-side); CSP headers restrict script sources |
| 7 | CSRF on state-changing requests | SameSite=Lax cookie; Next.js Server Actions' built-in origin check; explicit Origin/Host verification on any manual POST routes |
| 8 | MongoDB operator injection (`$gt:` tricks) | Mongoose schemas type-cast everything; Zod validates raw bodies first; query params never passed raw into filters |
| 9 | Free-tier quota drain (cost attack / runaway app) | Payload + batch caps, TTL pruning, per-key hourly quotas, kill switches, rejected-request counters surfaced in dashboard |
| 10 | Malicious/vulnerable dependency | Minimal dep set; `pnpm.lock` committed; `pnpm audit` + Dependabot; SDK stays zero-dependency by design |
| 11 | Client-side env var exposure | Only intentional `NEXT_PUBLIC_*` is public; DB URI/master key used exclusively in server-only modules (`server-only` package guard); bundle checked in review |
| 12 | GitHub token misuse | Fine-grained read-only PAT, lowest scope; referenced only in server-side `lib/github.ts`; cache responses (1 h) to avoid rate-limit burn |
| 13 | Unauthorized export access | Log-view exports sit behind `requirePerm("exports.download")`; no public URLs exist in v1 |
| 14 | Timing attacks on credential compares | `crypto.timingSafeEqual` for password/key comparisons; constant-time hash-then-compare pattern |
| 15 | Log/event data poisoning (fake data from a stolen key) | Per-key attribution retained (every row tagged with key prefix); revocation kills future writes; volume anomalies visible via per-key counters |
| 16 | Replay attacks / forged timestamps on ingest | Reject `ts` older than 24 h or >10 min future; store client `ts` + server `receivedAt` side-by-side (see hardening #10) |
| 17 | Clipboard / eye-button leakage of secrets | 30 s auto re-mask; value only decrypted per single click, never pre-rendered; every reveal/copy/export audited with IP; all such responses `Cache-Control: no-store` |
| 18 | Vercel/Atlas account takeover = game over | 2FA on Vercel + Atlas + GitHub; dedicated least-privilege Atlas DB user (readWrite only, not admin); strong unique passwords; session revocation via `AUTH_SECRET` rotation |
| 19 | Analytics poisoning/spam (tracker key is publicly readable in page source) | Kind-scoped `analytics` keys delivered in the POST body (sendBeacon can't set headers); events-only scope, tighter rate limits, referer soft-check, per-project kill switch (hardening #12) |
| 20 | Credentials leaked via URL query strings | SDK download authenticates via `x-manager-key` HEADER — never `?token=`; route sends `no-store`; `Access-Control-Allow-Origin: *` withheld from it |
| 21 | CSV formula injection via exported logs/events | Export writer prefixes `'` on cells starting with `=` `+` `-` `@`, tab, CR (hardening #13) |
| 22 | Forged attribution — stolen/leaked key writes fake `source:"server"` logs or fake IPs | Server-set fields stripped from payloads (hardening #2); key-`kind` gating (hardening #1); ip/country derived from the connection server-side |
| 23 | Anonymous visitor IDs reversed offline (plain hash over small IP space) | HMAC-SHA256 keyed with secret `VISITOR_PEPPER`, daily-rotating (F5) |
| 24 | CDN/browser caching of authenticated responses leaks secrets/logs | Explicit `Cache-Control: no-store` on every authed GET (Security Notes) |
| 25 | Crash during master-key rotation corrupts the vault | Per-row `keyVer` keeps old-key rows decryptable → migration resumable; fresh random 12-byte GCM IV per write |
| 26 | Dependency supply-chain compromise | Minimal dep set; exact versions pinned in `pnpm.lock` (ua-parser-js was hijacked in 2021); `pnpm audit` + Dependabot; SDK zero-dependency by design |

Review ritual: re-read this table before each phase ships; tick off that the mitigation actually landed in code.
Ops ritual: rotate `ADMIN_PASSWORD` + `AUTH_SECRET` periodically (e.g., quarterly) — AUTH_SECRET rotation doubles as an instant session kill-switch.

## 8. Free-Tier Guardrails

- Log TTL 30d, event TTL 90d; `daily_stats` rollups kept forever (tiny docs) so history survives pruning.
- Cap log payload at 8 KB; batch max 100/request; body size limit on route.
- Atlas M0 512 MB ≈ millions of small log docs with TTL — comfortably outlives hobby stage.
- Lazy rollups (recompute today's bucket on read, cache past days) — no paid cron needed.
- Rollups are **atomic** (`findOneAndUpdate` upsert / `$inc`) — concurrent requests can never double-count today's bucket.
- **Exports capped** (≤10k rows/request, paginated) — a CSV dump of a huge filtered view can't hammer the tier.
- **Backups**: Atlas M0 has no snapshots → weekly manual `mongodump` of projects/logs; acceptable-loss profile accepted. (Secrets collection backup is intentionally useless without `ENV_MASTER_KEY` — defense in depth.)
- **Timezone**: everything stored UTC; rollup dates UTC; display TZ via `APP_TZ` (default UTC).

---

## 9. Suggestions / Modifications (my recommendations on your ask)

1. ✅ **Single Next.js app is right** — splitting into separate services buys nothing at this scale; one deploy, one DB, one auth.
2. **Daily-rollup layer added** (§8) — keeps analytics fast and cheap forever instead of scanning raw events.
3. **Eye button upgraded** → reveal is a server round-trip (value never sits in initial HTML), 30-second auto re-mask, and every reveal is audit-logged. Cheap to add, big safety win.
4. **Reports/sharing deferred** — parked post-v1 (wanted later); log-viewer export stays (F2).
5. **Anonymous daily-rotating visitor IDs** — analytics-grade uniques without cookies/GDPR headaches.
6. **Live tail via polling**, not WebSockets — serverless-friendly, indistinguishable at 3–5 s refresh for personal use.
7. Consider naming it something short (`missionctrl`, `homestead`, …) — it'll appear in every tracker snippet.

### Parked ideas (post-v1 — wanted later, tracked in docs/suggestions.md)

- Public status page generator per project
- Reports/sharing: JSON/CSV data files, printable PDF report page, "Send to…" email-report (Resend)
- Error-spike alerts to Discord/Telegram webhook
- Uptime monitoring via external pinger hitting `/api/ping/[id]`
- Weekly digest email (Resend)
- Deployment tracker receiving Vercel/GitHub deploy webhooks

---

## 10. Testing Strategy

Convention (from CLAUDE.md): test every functionality, proper folder structure, one runner.

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | `crypto.ts` encrypt/decrypt round-trip + tamper detection + **fresh-random-IV assertion**, `permissions.ts` `can()` map incl. **admin-bypass** (admin always true, any map values), in-memory rate-limit buckets, Zod ingest schemas (accept/reject matrices incl. **rejected server-set fields**), error-fingerprint hashing, redaction key masking, CSV formula-injection sanitizer, visitor-id HMAC derivation |
| Integration | Vitest + `mongodb-memory-server` | Route handlers against a real-ish Mongo: ingest auth/validation/caps/replay-guard, **key-kind scoping** (client key can't write server-source logs; analytics key can't hit `/logs`), login + middleware session gating, secrets reveal → audit row written + `Cache-Control: no-store` asserted, API-key hashing/prefix lookup, `rate_limits` unique-index upsert under concurrent `$inc` |
| E2E | Playwright | Login → dashboard; create project; eye-button reveal flow (mask → reveal → auto re-mask); SDK end-to-end: init → log → appears in viewer |

- **Single entry point:** `pnpm test` runs the entire suite (unit + integration); `pnpm test:e2e` for Playwright.
- Test folders: `tests/unit/`, `tests/integration/`, `tests/e2e/` mirroring feature areas (`logger/`, `secrets/`, `auth/`, `analytics/`).
- A phase ships only with its tests green; every mitigation in §7.6 gets an explicit regression test when its phase lands.
- Ingest hardening (#1–11) is the highest-value test target — public endpoints get adversarial tests (oversized payloads, bad keys, forged `ts`, injection keys).
