# Architecture

> Status: **P0–P5 complete** (2026-09-28). Spec: [`docs/plan.md`](./plan.md). Open items: [`docs/to-do.md`](./to-do.md).
> This is the live inventory (file → purpose → functions) — update it on every change.
> Inventory audit 2026-09-28: full scan of all 134 source files (`.ts`/`.tsx`/`.mjs`) plus config,
> assets and docs. Verification: `npm run verify` (lint + tsc + 337 tests + build) and
> `npm run test:e2e` (57 checks against a real production server + real MongoDB).

## Environment Variables

| Var | Purpose | Referenced in |
|---|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string | `lib/db/connect.ts` (`connectToDatabase` — everything fails closed without it) |
| `AUTH_SECRET` | Signs the session cookie (jose HS256, 7d). Rotating it invalidates every session instantly | `lib/env.ts` (`authSecret`) → `lib/session.ts` (`signSessionToken`, `verifySessionToken`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Owner credentials for v1 auth; the account is promoted to root admin on first sign-in | `lib/env.ts` (`adminCredentials`) → `lib/authService.ts` (`attemptLogin`, `verifyPassword`) |
| `ENV_MASTER_KEY` | AES-256-GCM vault key, 64 hex chars. Never stored in the DB; rotation via Settings | `lib/crypto.ts` (`masterKeyBytes`, `encrypt`, `decrypt`, re-encrypt helpers) |
| `VISITOR_PEPPER` | HMAC key for daily-rotating anonymous visitor ids | `lib/env.ts` (`visitorPepper`) → `lib/visitor.ts` (`visitorId`), `lib/analytics.ts` |
| `GITHUB_TOKEN` *(optional)* | Higher rate limit for repo enrichment | `lib/github.ts` (`fetchRepoInfo`) |
| `APP_TZ` *(optional)* | Display timezone for dashboards (default UTC) | `lib/env.ts` (`appTimezone`) → `app/(dash)/settings/page.tsx` |
| `NODE_ENV` | Framework-managed; selects the dev-vs-production CSP in `lib/csp.ts` | `proxy.ts` |
| `CREATE_USER_EMAIL` / `CREATE_USER_NAME` / `CREATE_USER_PASSWORD` / `CREATE_USER_ROLE` | Inputs for `scripts/create-user.ts` — never hardcoded in the file | `scripts/create-user.ts` |

`.env*` is git-ignored (`.env.example` is the only tracked env file; no `.env` exists in git history).

## Application Files

| File | Purpose | Exports |
|---|---|---|
| `proxy.ts` | Next 16 proxy (middleware). Mints a per-request CSP nonce; lets `/`, `/login`, `/api/ping`, `/api/auth/*`, `/t.js`, `/api/ingest/*`, `/api/sdk/*` through unauthenticated; answers `/api/auth/session` with the principal + server-derived capabilities; redirects unauthenticated pages to `/login` (307) and returns 401 JSON for APIs; applies a coarse permission guard per path | `proxy(request)`, `config.matcher` |
| `lib/csp.ts` | Single source of truth for the CSP string | `generateNonce()`, `buildCsp(nonce, isDev)` |
| `lib/permissions.ts` | Authorization core: role registry (ADMIN 0 / DEVELOPER 50 / USER 100), permission registry with `delegable`/`systemProtected`/`minimumRoleRank` metadata, resolution order, delegation rules | `ROLES`, `PERMISSION_META`, `PERMISSIONS`, `can`, `explain`, `getEffectivePermissions`, `isRootAdmin`, `rankForRole`, `isPermissionKey`, `isSystemProtected`, `isDelegable`, `canDelegate`, `canManagePermissions`, `managementScope`, `assertCanManageTarget`, `assertCanGrant`, `assertCanDelegate`, `AuthorizationError`, types `RoleKey`/`PermissionKey`/`Principal`/`PermissionManagementScope` |
| `lib/env.ts` | Fail-closed env access with caching | `serverEnv()`, `resetEnvCache()`, `authSecret()`, `visitorPepper()`, `adminCredentials()`, `appTimezone()`, type `ServerEnv` |
| `lib/crypto.ts` | AES-256-GCM vault primitives + hashing helpers | `encrypt`, `decrypt`, `maskValue`, `reencryptWithNewKey`, `decryptWithKey`, `sha256Hex`, `timingSafeEqualString`, `randomToken`, `randomHex`, type `EncryptedValue` |
| `lib/session.ts` | jose token issuing/verification + cookie policy | `SESSION_COOKIE`, `SESSION_TTL_SECONDS`, `signSessionToken`, `verifySessionToken`, `sessionCookieOptions`, `clearedSessionCookieOptions`, `defaultLevelForRole`, type `SessionClaims` |
| `lib/auth.ts` | Request→principal resolution and route guards | `getPrincipal`, `getPrincipalFromCookieStore`, `requirePrincipal`, `requirePrincipalFromCookieStore`, `authorize`, `authorizeUserManagement`, `assertPermission`, `capabilitiesFor`, `errorResponse`, `HttpError`, `unauthorized`, `forbidden`, `notFound` |
| `lib/authService.ts` | Login policy: env owner + bcrypt users, lockout counters | `attemptLogin`, `verifyPassword`, `lockoutRemainingMs`, `clearFailures`, `MAX_LOGIN_ATTEMPTS`, `LOCKOUT_MS`, type `LoginOutcome` |
| `lib/users.ts` | User administration + audit log | `listUsers`, `getUserById`, `createUser`, `updateUser`, `serializeUser`, `countAdmins`, `recordAudit`, `listAuditEvents`, `principalFromUser`, `isProtectedPermission`, types `UserSummary`/`CreateUserInput`/`UpdateUserInput` |
| `lib/validation.ts` | Shared Zod schemas + ingest limits | `slugSchema`, `linkSchema`, `projectCreateSchema`, `projectUpdateSchema`, `logEntrySchema`, `logIngestSchema`, `eventEntrySchema`, `eventIngestSchema`, `secretUpsertSchema`, `secretImportSchema`, `secretUpdateSchema`, `apiKeyCreateSchema`, `logQuerySchema`, `analyticsQuerySchema`, `userCreateSchema`, `userUpdateSchema`, `settingsUpdateSchema`, `loginSchema`, `MAX_META_BYTES`, `MAX_BODY_BYTES`, `MAX_LOG_BATCH`, `MAX_EVENT_BATCH`, `MAX_TS_AGE_MS`, `MAX_TS_FUTURE_MS` |
| `lib/db/connect.ts` | Cached mongoose connection (serverless-safe) | `connectToDatabase`, `mongooseInstance`, `isDatabaseConnected`, `disconnectFromDatabase` |
| `lib/db/users.ts` | `users` model (role, rank, overrides, permissionManagement scope) | `UserModel`, type `UserDoc` |
| `lib/db/projects.ts` | `projects` model (status/tags/links/notes/github cache/kill switches) | `ProjectModel`, `PROJECT_STATUSES`, `LINK_TYPES`, types `ProjectStatus`/`LinkType`/`ProjectDoc` |
| `lib/db/apikeys.ts` | `api_keys` model (hashed, prefix-indexed, kind-scoped) | `ApiKeyModel`, `KEY_KINDS`, `KEY_PREFIXES`, types `KeyKind`/`ApiKeyDoc` |
| `lib/db/logs.ts` | `logs` model + indexes (keyset `(projectId, ts, _id)`, fingerprint, 30d TTL) | `LogModel`, `LOG_LEVELS`, `LOG_SOURCES`, types `LogLevel`/`LogSource`/`LogDoc` |
| `lib/db/events.ts` | `events` model (pageview/click/custom, 90d TTL) | `EventModel`, `EVENT_TYPES`, types `EventType`/`EventDoc` |
| `lib/db/secrets.ts` | `secrets` (unique per project+env+key) and `secret_audit` (180d TTL) | `SecretModel`, `SecretAuditModel`, `ENVIRONMENTS`, types `Environment`/`SecretDoc`/`SecretAuditDoc` |
| `lib/db/ops.ts` | `daily_stats` rollups, `rate_limits` (unique `(key, windowStart)`), `app_settings`, `login_attempts`, `audit_events` | `DailyStatModel`, `RateLimitModel`, `AppSettingModel`, `LoginAttemptModel`, `AuditEventModel`, `APP_SETTING_KEYS`, `LOG_TTL_DAYS`, `EVENT_TTL_DAYS`, `SECRET_AUDIT_TTL_DAYS`, `RATE_LIMIT_WINDOW_SECONDS` |
| `lib/projects.ts` | Project service (slugify, unique slugs, regex-escaped search, cascade delete) | `slugify`, `listProjects`, `getProjectBySlug`, `getProjectById`, `createProject`, `updateProject`, `deleteProject`, `serializeProject`, types `ProjectInput`/`ProjectListFilters`/`ProjectSummary` |
| `lib/keyManagement.ts` | API key lifecycle | `createApiKey`, `listApiKeys`, `listAllApiKeys`, `revokeApiKey`, `deleteApiKey`, `generateVerifiableApiKey`, `isVerifiablePrefix`, `maskKeyPrefix`, `KeyError`, types `MaskedApiKey`/`CreatedApiKey`/`KeyInput` |
| `lib/apiKeys.ts` | Key generation, constant-time verification, kind→scope rules | `generateApiKey`, `verifyApiKey`, `hashKey`, `keyPrefixOf`, `kindCanWriteLogs`, `kindCanWriteEvents`, `sourceForKind`, `redactKey`, type `VerifiedKey`/`GeneratedKey` |
| `lib/ingest.ts` | Log ingest + viewer query engine | `ingestLogs`, `queryLogs`, `groupLogs`, `countLogs`, `logFacets`, `prepareEntry`, `buildLogFilter`, `parseIngestTs`, `hasForbiddenFields`, `cleanText`, `metaSize`, `escapeRegex`, `encodeCursor`, `decodeCursor`, `serializeLog`, `resolveLimit`, `objectIdOrNull`, `IngestError`, consts `INGEST_LIMITS`/`SERVER_DERIVED_FIELDS`/`NODE_RUNTIME_FIELDS`/`MAX_EXPORT_ROWS`/`MAX_QUERY_LIMIT` |
| `lib/analytics.ts` | Event ingest, rollup reads and analytics summaries | `ingestEvents`, `analyticsSummary`, `projectTotals`, `exportEvents`, `prepareEvent`, `hasForbiddenEventFields`, `originCheck`, `hostsFromLinks`, `resolveRange`, `mergeCountMaps`, `rankCounts`, `pickByPrefix`, `alignSeries`, `sumSeries`, `combineSeries`, `rollupKeySafe`, `cleanCountry`, `cleanUtm`, `serializeEvent`, consts `ANALYTICS_LIMITS`/`ACTIVE_WINDOW_MS`/`UTM_FIELDS`/`EVENT_SERVER_DERIVED_FIELDS`/`EVENT_EXPORT_COLUMNS` |
| `lib/rollup.ts` | Daily rollup writer/reader (UTC buckets, cardinality cap) | `rollupDay`, `readRollups`, `rangeDates`, `ensureCurrentDayRollup`, type `DailyRollup` |
| `lib/secrets.ts` | Vault service: masking, CRUD, `.env` import/export, audit, key rotation | `parseEnvFile`, `listSecrets`, `upsertSecret`, `updateSecret`, `deleteSecret`, `importEnvFile`, `logSecretAction`, `revealSecret`, `exportEnv`, `auditTrail`, `rotateMasterKey`, `CURRENT_KEY_VER`, types `MaskedSecret`/`RevealedSecret`/`ImportResult`/`RotationResult`/`SecretAuditRow` |
| `lib/settings.ts` | Global ingest kill switches and batch caps | `getSettings`, `updateSettings`, `DEFAULT_SETTINGS`, type `AppSettings` |
| `lib/ratelimit.ts` | In-memory token bucket + durable Mongo counters | `consumeMemory`, `consumeDurable`, `enforceRateLimit`, `resetMemoryBuckets`, `bucketSnapshot`, type `RateVerdict` |
| `lib/visitor.ts` | Visitor ids, bot filtering, IP/country derivation, UTC day maths | `visitorId`, `isBot`, `clientIp`, `countryFromHeaders`, `utcDateKey`, `dailyWindowStart`, `addDays` |
| `lib/fingerprint.ts` | Error fingerprints, redaction, sanitising, capping | `fingerprint`, `normalizeMessage`, `redactValue`, `redactMeta`, `stripControlChars`, `capString` |
| `lib/csv.ts` | Formula-injection-safe CSV writer | `toCsv`, `escapeCsvCell` |
| `lib/ua.ts` | ua-parser-js wrapper | `parseUserAgent`, type `ParsedUserAgent` |
| `lib/github.ts` | Repo enrichment with 1h cache | `parseRepoSlug`, `fetchRepoInfo`, `refreshProjectGithub`, type `GithubRepoInfo` |
| `lib/tracker.ts` | Analytics tracker source + embed snippet | `TRACKER_SOURCE`, `TRACKER_VERSION`, `TRACKER_PATH`, `getEmbedSnippet`, `MASKED_KEY_TAIL`, types `EmbedSnippet`/`EmbedSnippetProject` |
| `lib/trackerHandler.ts` | Shared `/t.js` response (immutable cache + ETag/304) | `trackerResponse`, `trackerHeaders`, `TRACKER_ETAG` |
| `lib/readiness.ts` | First-run diagnostics: which env vars are missing, is the database reachable, and what to tell the user | `checkReadiness`, `missingEnvVars`, `setupHint`, type `ReadinessReport` |
| `lib/cn.ts` | Class-name helper | `cn` |

## API Routes

All authenticated responses send `Cache-Control: no-store`; public routes are marked in `proxy.ts`.

| Route | Methods | Permission | Notes |
|---|---|---|---|
| `app/api/ping/route.ts` | `GET` | public | readiness probe: `{ ok, setup, database, missingEnv }`, `no-store` — never echoes a value |
| `app/api/auth/login/route.ts` | `POST` | public | readiness-gated (503 + missing names when unconfigured), env/bcrypt login, generic errors, 429 + `Retry-After` on lockout, sets the session cookie |
| `app/api/auth/logout/route.ts` | `POST` | public | clears the cookie (`Max-Age=0`) |
| `app/api/auth/session` | — | session | answered inside `proxy.ts` (principal + capabilities) |
| `app/api/projects/route.ts` | `GET`/`POST` | `projects.view` / `projects.create` | list with escaped search, create with unique slug |
| `app/api/projects/[slug]/route.ts` | `GET`/`PATCH`/`DELETE` | `projects.view` / `.edit` / `.delete` | delete cascades keys, secrets, logs, events, rollups, audits |
| `app/api/projects/[slug]/github/route.ts` | `POST` | `projects.edit` | refreshes repo metadata, audits |
| `app/api/projects/[slug]/secrets/route.ts` | `GET`/`POST` | `secrets.view` / `secrets.edit` | masked list, upsert, `.env` import (`mode:"import"`) |
| `app/api/projects/[slug]/secrets/export/route.ts` | `POST` | `secrets.export` (root admin) | type-to-confirm + password re-entry, audits, `no-store` download |
| `app/api/projects/[slug]/secrets/audit/route.ts` | `GET` | `secrets.view` | recent reveal/copy/export/import rows |
| `app/api/secrets/[id]/route.ts` | `PATCH`/`DELETE` | `secrets.edit` | audits |
| `app/api/secrets/[id]/reveal/route.ts` | `POST` | `secrets.reveal` | single decrypt + audit row, `no-store` |
| `app/api/projects/[slug]/keys/route.ts` | `GET`/`POST` | `keys.view` / `keys.manage` | full key returned exactly once |
| `app/api/keys/route.ts` | `GET` | `keys.view` | all keys across projects |
| `app/api/keys/[id]/route.ts` | `PATCH`/`DELETE` | `keys.manage` | revoke / remove |
| `app/api/ingest/logs/route.ts` | `POST`/`OPTIONS` | `x-api-key` (public by design) | generic 401, 415, 413, 429 + `Retry-After`, kill switches, key-kind scoping, replay guard |
| `app/api/ingest/events/route.ts` | `POST`/`OPTIONS` | analytics key in body (public) | same hardening, bot filtering, origin soft-check |
| `app/api/projects/[slug]/logs/route.ts` | `GET` | `logs.view` | keyset cursor pagination, grouping mode, escaped filters |
| `app/api/projects/[slug]/logs/export/route.ts` | `GET`/`POST` | `logs.export` (root admin) | ≤10k rows, CSV (formula-safe) or JSON |
| `app/api/projects/[slug]/analytics/route.ts` | `GET`/`PATCH` | `analytics.view` / `analytics.edit` | summary + per-project ingest toggle |
| `app/api/projects/[slug]/analytics/export/route.ts` | `GET` | `analytics.export` (root admin) | CSV/JSON events export |
| `app/api/analytics/route.ts` | `GET` | `analytics.view` | cross-project overview |
| `app/t.js/route.ts`, `app/api/t.js/route.ts` | `GET` | public | tracker, `immutable` + ETag/304 |
| `app/api/sdk/logger/route.ts` | `GET` | `x-manager-key` header (public by design, not query) | serves the bundled SDK, `no-store`, **no CORS `*`** |
| `app/api/settings/route.ts` | `GET`/`PATCH` | `settings.manage` | global kill switches, audits |
| `app/api/settings/rotate-key/route.ts` | `POST` | `secrets.edit` | resumable master-key rotation (`confirm:"ROTATE"`), audits |
| `app/api/users/route.ts` | `GET`/`POST` | `users.manage` **or** an active management scope | creating an ADMIN or granting delegation requires `permissions.delegate` |
| `app/api/users/[id]/route.ts` | `PATCH`/`DELETE` | same | rank boundary, self-protection, last-admin protection, audits; DELETE disables |

## Pages & Components

| File | Purpose | Exports |
|---|---|---|
| `app/layout.tsx` | Fonts, global CSS, private-app metadata (`noindex`) | `metadata`, `RootLayout` |
| `app/page.tsx` | Public landing (feature summary, sign-in or dashboard link) | `Home` |
| `app/globals.css` | Tailwind v4 theme, Geist font vars, `color-scheme` | _(styles)_ |
| `app/(auth)/login/page.tsx` + `login-form.tsx` | Sign-in form with lockout messaging; shows an actionable setup notice instead of the form when env/DB are not ready | `LoginPage`, `LoginForm` |
| `app/(dash)/layout.tsx` | Authenticated shell: sidebar nav, `CapabilityProvider`, `ToastProvider` | `DashLayout` |
| `app/(dash)/dashboard/page.tsx` | Overview: project cards, key/user counts, ingest state, live API ping | `DashboardPage` |
| `app/(dash)/projects/page.tsx` + `components/projects/project-list.tsx` | Search, status filter, grid/table, create dialog, delete confirmation | `ProjectsPage`, `ProjectList` |
| `app/(dash)/projects/[slug]/layout.tsx` | Project shell: header + permission-aware tabs | `ProjectLayout` |
| `app/(dash)/projects/[slug]/page.tsx` | Overview: notes (safe markdown), links, ingest switches, quick links | `ProjectOverviewPage` |
| `components/projects/project-form.tsx` | Create/edit dialog (slug, links, notes, repo) | `ProjectForm` |
| `components/projects/project-header.tsx` | Emoji/status/tags/GitHub stats + refresh | `ProjectHeader` |
| `components/projects/project-tabs.tsx` | Permission-filtered tabs | `ProjectTabs` |
| `app/(dash)/projects/[slug]/env/page.tsx` + `components/secrets/secrets-panel.tsx` | Vault: env selector, masked values, 30 s reveal, copy, import/export dialogs, audit list | `SecretsPanel` |
| `app/(dash)/projects/[slug]/keys/page.tsx` + `components/logs/keys-panel.tsx` | Key list, create-once display, revoke | `KeysPanel` |
| `app/(dash)/settings/keys/page.tsx` | All keys across projects | page |
| `app/(dash)/projects/[slug]/logs/page.tsx` + `components/logs/log-viewer.tsx` | All/Server/Client tabs, filters, trace view, error grouping, live tail, detail drawer, exports | `LogViewer` |
| `app/(dash)/projects/[slug]/integrate/page.tsx` + `components/logs/integrate-panel.tsx` | SDK install command + init snippet | `IntegratePanel` |
| `app/(dash)/projects/[slug]/analytics/page.tsx` + `components/analytics/*` | Range switcher, charts, breakdowns, active-now, ingest toggle | `ProjectAnalytics`, `TrafficChart`, `Breakdown`, `TrackerSnippet` |
| `app/(dash)/projects/[slug]/analytics/setup/page.tsx` | Tracker embed snippet with masked key | page |
| `app/(dash)/analytics/page.tsx` + `components/analytics/overview.tsx` | Cross-project analytics | `Overview` |
| `app/(dash)/settings/page.tsx` + `components/settings/settings-panel.tsx` | Kill switches, master-key rotation, security event log | `SettingsPanel` |
| `app/(dash)/settings/users/page.tsx` + `components/settings/users-panel.tsx` | Users, roles, overrides, delegation scope editor | `UsersPanel` |
| `components/capabilities.tsx` | Client capability context + `canClient`/`hasAll`/`hasAny` | `CapabilityProvider`, `useCapabilities`, `canClient`, `hasAll`, `hasAny` |
| `components/permission-gate.tsx` | `<PermissionGate permission/allOf/anyOf/fallback/mode>` — cosmetic only | `PermissionGate` |
| `components/nav.tsx` | Sidebar nav + sign-out | `Nav`, `TopBar` |
| `components/dashboard/app-ping.tsx` | Polls `/api/ping` and shows health | `AppPing` |
| `components/ui/*` | Dependency-free UI kit: `Button`, `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Input`/`Textarea`/`Select`/`Label`/`Field`, `Table`/`THead`/`TBody`/`TR`/`TH`/`TD`, `Badge`(+`STATUS_TONE`/`LEVEL_TONE`), `Dialog`, `ToastProvider`/`useToast`, `Markdown` (no `dangerouslySetInnerHTML`) | see left |

## SDK (`packages/logger`)

| File | Purpose | Exports |
|---|---|---|
| `packages/logger/src/index.ts` | Isomorphic zero-dependency SDK: levels, child loggers, timers, batching + backoff + offline queue, console/global-error/fetch auto-capture, auto-context, trace correlation, redaction, fingerprinting, self rate limiting, `flush()`/shutdown hooks | `initLogger`, `traceIdFromHeaders`, `shutdownLoggers`, `fingerprint`, `LOG_SDK_VERSION`, `LOG_SDK_PATH`, `TRACE_HEADER` |
| `packages/logger/src/types.ts` | SDK public types | (types only) |
| `packages/logger/build.mjs` | Zero-dependency bundler → single self-contained file; fails if any `import` survives | _(build script)_ |
| `packages/logger/dist/logger.ts` | The vendored artifact served to user apps | (generated, committed) |
| `packages/logger/dist/logger.source.ts` | Same bytes as a string constant so the route can serve them | `LOGGER_SDK_SOURCE` |

## Tests & Tooling

| File | Purpose |
|---|---|
| `tests/helpers/mongo.ts` | Boots `mongodb-memory-server`, injects test env, clears collections |
| `tests/helpers/request.ts` | Signed session cookies + `NextRequest` builders |
| `tests/helpers/users.ts` | Seeds users with role/overrides/delegation scope |
| `tests/unit/permissions.test.ts` | 21 tests: resolution order, root-admin invariance, overrides, malformed input, delegation/rank/ceiling rules |
| `tests/unit/csp.test.ts` | Nonce format/uniqueness, every locked-down directive, dev/prod differences |
| `tests/unit/security-headers.test.ts` | `next.config.ts` header regression suite |
| `tests/unit/api-ping.test.ts` | Health route contract + no secret values in the payload |
| `tests/integration/readiness.test.ts` | Unconfigured deployment: missing-var detection, actionable 503 login (never a bare 500), no session cookie, unreachable-DB path, configured path still works |
| `tests/unit/page-rendering.test.ts` | Landing page must stay `force-dynamic` (nonce cannot be injected into static HTML) |
| `tests/unit/secrets.test.ts` | `.env` parsing, crypto round-trip/tamper/fresh-IV, masking, permission map |
| `tests/unit/ingest.test.ts` | Regex escaping, timestamp guards, caps, fingerprinting, redaction, CSV, SDK internals |
| `tests/unit/analytics.test.ts` | Visitor ids, bot table, ranges, rollup maths, origin check, tracker assertions |
| `tests/integration/auth.test.ts` | Login policy, lockout, cookie flags, session bootstrap, proxy guard, fail-closed behaviour |
| `tests/integration/projects.test.ts` | Projects CRUD, authorization, regex-injection, cascade, settings, users + delegation boundaries |
| `tests/integration/secrets.test.ts` | Vault routes: masking, reveal + audit, export guards, rotation + resume |
| `tests/integration/ingest.test.ts` | Log ingest hardening matrix + viewer/export/SDK download |
| `tests/integration/analytics.test.ts` | Event ingest hardening, rollups, summary authz, tracker route |
| `tests/integration/tracker-route.test.ts` | `/t.js` public path, immutable cache, ETag/304, masked embed snippet |
| `tests/e2e/smoke.mjs` | Builds and boots a real production server against a real MongoDB; 57 checks across the whole product (`npm run test:e2e`) |
| `vitest.config.mts` | Vitest config (`@/` alias, node env, `tests/**/*.test.ts`) |
| `scripts/create-user.ts` | CLI user creation (`npm run create-user`) |

## Security Model (as implemented)

- **Authorization order** — identity is derived from the verified session + a live user lookup (disabled/deleted users are rejected immediately); unknown roles, malformed ranks and missing data fail closed; root admin (rank 0, `ADMIN`) short-circuits to full access and cannot be constrained by overrides, role changes or plan-like demotion; user `deny` beats user `allow`; `allow` can never grant a `systemProtected` permission; role grants come last.
- **Delegation** — `permissions.delegate` is root-admin-only and non-delegable. A delegated manager holds `permissions.manage` plus a scope (`minTargetRank`, `allowedPermissions` filtered to delegable permissions), cannot manage themselves, root admin, or anyone above their boundary, cannot grant a permission they do not hold, and cannot widen their own scope. Every change writes an audit row.
- **Route enforcement** — every handler calls `authorize(request, permission)`; the proxy adds a coarse guard so hidden pages are not even rendered for unauthorized roles. The client `PermissionGate` never authorizes anything by itself.
- **CSP** — one canonical builder; per-request nonce; no `'unsafe-inline'` script source; `frame-ancestors 'none'` (clickjacking defence for the vault reveal button); every route dynamic so shared caches cannot hold another session's HTML.
- **Ingest** — hashed keys + constant-time compare, generic 401s, strict Zod whitelists that reject server-set fields, 128 KB body caps, batch caps, replay/stale guards, in-memory + durable rate limits (unique index prevents forked counters), global and per-project kill switches, bot filtering, origin soft-check on events.
- **Vault** — AES-256-GCM with a fresh 12-byte IV per write, `keyVer` per row, masked listings, single-value reveal with 30 s client re-mask, audited reveal/copy/export, password + type-to-confirm on export, resumable key rotation.
- **Caching** — `no-store` on every authenticated response; exports capped at 10k rows; CSV cells that could be interpreted as formulas are prefixed with `'`.
- **Dependency floor** — minimal, deliberately chosen deps; `npm audit` clean; the SDK ships zero dependencies.
