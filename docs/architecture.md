# Architecture

> Greenfield — no code yet. The build plan lives in [`docs/plan.md`](./plan.md).
> This file becomes the live inventory (file → purpose → functions) as soon as Phase 0 scaffolding lands, per convention: update on every change.

## Environment Variables

| Var | Purpose | Referenced in |
|---|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string | `src/lib/db/*` (planned) |
| `AUTH_SECRET` | Signs the admin session cookie (jose) | `src/middleware.ts`, `/api/auth/login` (planned) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Single-admin login credentials (simple auth, no DB user) | `/api/auth/login` (planned) |
| `ENV_MASTER_KEY` | AES-256-GCM master key for secrets vault | `src/lib/crypto.ts` (planned) |
| `VISITOR_PEPPER` | Secret HMAC key for hashing anonymous analytics visitor IDs (makes offline reversal of hashed IPs infeasible) | analytics ingest (planned) |
| `CREATE_USER_EMAIL` / `CREATE_USER_PASSWORD` / `CREATE_USER_ROLE` | Inputs for `scripts/create-user.js` — never hardcoded in the file (commit-leak risk) | `scripts/create-user.js` (planned) |
| `GITHUB_TOKEN` *(optional)* | Higher rate limit for repo enrichment | `src/lib/github.ts` (planned) |
| `APP_TZ` *(optional)* | Display timezone for dashboards (default UTC) | dashboard pages (planned) |

## Files

_(none yet — to be populated starting Phase 0)_
