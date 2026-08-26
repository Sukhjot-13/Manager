# Suggestions Log

> State 2026-08-25: all design-level suggestions were folded into [`docs/plan.md`](./plan.md)
> (testing §10, RBAC/admin-bypass §7.5, security §7/§7.6, guardrails §8, specs F2–F5) — the
> plan owns them now. This file tracks **open/parked items only**. The five 🟡 features below
> are wanted **later** (post-v1), not declined.

## 🟢 Improvements

_(none open — everything folded into plan.md)_

## 🟡 New Features
- 2026-08-25 — Reports shared manually for now (JSON/CSV download + printable report page → browser PDF); "Send to…" email-report button (Resend) parked for later, possibly separate script/app. *(wanted later — parked post-v1 in plan)*
- 2026-08-25 — Error-spike alerts to Discord/Telegram webhook (post-v1).
- 2026-08-25 — Uptime monitoring via external free pinger hitting `/api/ping/[id]` (Vercel Hobby cron is daily-only).
- 2026-08-25 — Weekly digest email (Resend free tier) summarizing all projects.
- 2026-08-25 — Deployment tracker receiving Vercel/GitHub deploy webhooks.

## 🔴 Vulnerabilities

_2026-08-25 security review of plan.md found 15 gaps in the §7.6 threat model — **ALL FIXED same
day** by folding mitigations into [`docs/plan.md`](./plan.md) (specs F2/F3/F5, hardening
#1/#2/#6/#12–14, threat-table rows #19–26, §2 stack, §4 schema/indexes, §5 scripts, §7.5, §10 tests).
Resolution map:_

- ✅ Analytics ingest now carries a kind-scoped `analytics` key (POST body — sendBeacon can't set headers) — F5 + hardening #12 + row 19
- ✅ SDK download moved to header auth (`x-manager-key`), `no-store`, no `ACAO *`, never `?token=` — F2 + row 20
- ✅ CSV formula-injection sanitizer specced (`= + - @` tab CR → `'` prefix) — F2 + hardening #13 + row 21
- ✅ Server-set fields (`source/ip/country/hostname/pid/…`) rejected from payloads; key-`kind` gating; ip derived server-side — §4 `api_keys.kind` + hardening #1/#2 + row 22
- ✅ Visitor ID switched to HMAC-SHA256 keyed with secret `VISITOR_PEPPER` env var — F5 + row 23 (+ architecture.md env table)
- ✅ Stateless-session revocation wording corrected (rotation = only true kill-switch; logout = browser-only) — §7.5 + row 5
- ✅ Global login lockout removed (per-IP + per-account only, no owner-lockout DoS) — row 4
- ✅ Unique `(key, windowStart)` index on `rate_limits` (upsert-race under-count fix) — §4 + hardening #11
- ✅ Secrets: per-row `keyVer` + mandatory fresh random 12-byte GCM IVs (crash-safe rotation) — §4/F3 + row 25
- ✅ `create-user.js` now env/prompt-driven (no hardcoded creds); `.gitignore` before first commit mandated — §5/§7.5/Security Notes
- ✅ Explicit `Cache-Control: no-store` on all authed GETs (reveal/export/dashboard/sdk) — Security Notes + row 24
- ✅ ua-parser-js exact-version pinning (2021 hijack precedent) — §2 stack + row 26
- ✅ User search input escaped before `$regex` (ReDoS/full-scan guard) — F2 filters
- ✅ PII minimization: click-text truncation ~100 chars; ip/country retention caveats noted — F5
- ✅ CSPRNG-only key material requirement (`crypto.randomBytes` ≥ 256-bit) — hardening #14

_(none open — re-review whenever plan.md gains new features)_
