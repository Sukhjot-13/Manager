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

_2026-08-25 security review of plan.md found 15 gaps in the §7.6 threat model — **all fixed same
day** in [`docs/plan.md`](./plan.md) (specs F2/F3/F5, hardening #1/#2/#6/#12–14, threat-table
rows #19–26, §4 schema/indexes, §7.5, §10 tests). Details live in the plan; nothing open here._

_(none open)_
