# AI Behavior & Architecture Guidelines

- **Greeting:** ALWAYS start every session, answer, or work block by addressing the user by name: **Sukhjot**.

- **Architecture Documentation (`docs/architecture.md`):** Project doc files (architecture, suggestions, to-do) live in the project's `docs/` folder, NOT at the project root — see "Project doc files location" below.
  - Every file in the codebase must be listed in `docs/architecture.md`.
  - For each file, document:
    1. Its **main function/purpose**.
    2. A comprehensive list of **all functions** it contains and their roles.

- **Continuous Updates:** Whenever any change is made to any part of the codebase, immediately update `docs/architecture.md` with those changes. This ensures we never have to search the whole codebase in the future.

- **Double-Check Verification:** After working on any file or part of the project, double-check its functionality against `docs/architecture.md`. If the file or function is missing from the architecture file, add it; if it has changed, update it immediately.

- **Auto-Verify After Each Change:** After completing any modification to the codebase, immediately verify the work by doing a fresh scan to catch anything missed — check for remaining instances of the old pattern, look at the diff from all angles, grep for anti-patterns, and confirm no files were left partially updated. Do not proceed to the next task or declare done until this scan confirms completeness.

## Suggestions File (`docs/suggestions.md`)

- Whenever you have an idea for an improvement, new feature, vulnerability finding, or any suggestion about the project, write it into `docs/suggestions.md` in the project's `docs/` folder.
- Organize under section headings: `## 🟢 Improvements`, `## 🟡 New Features`, `## 🔴 Vulnerabilities`, or add a new section if none of those fit.
- Date-stamp each entry and keep existing entries — don't delete old ones unless they've been implemented.

## Architecture File (`docs/architecture.md`) Rules

- When creating or editing `docs/architecture.md`, always include a **separate Environment Variables section** listing every env var used by the site, what it's for, and where it's referenced.
- Keep other structural changes to `docs/architecture.md` in line with the existing pattern (file path → purpose → list of functions).

## Project doc files location

- **`docs/architecture.md`** — always-current file/function inventory + env vars (update on every change).
- **`docs/suggestions.md`** — improvement / feature / vulnerability log.
- **`docs/to-do.md`** — task list / session handoff (when one exists).
- These live in the project's `docs/` folder — never at the project root (user's preference, 2026-08-13).

## Auto-Orient at Session Start

- **At the very start of every session** (before any response or task), silently:
  1. Check if `docs/architecture.md` exists in the project's `docs/` folder.
  2. If yes, read it to understand the project structure.
  3. If no, scan the project structure and create `docs/architecture.md` first.
- No need to tell the user this is happening — just orient yourself silently and be ready to work.
- When the user eventually asks a question or gives a task, you're already oriented.

## Testing Guidelines

- **Test Every Functionality:** Whenever possible, every feature/functionality must have corresponding tests. Don't leave new logic untested.
- **Proper Structure:** Organize tests in a dedicated folder structure (e.g., `tests/` mirroring `src/`, or colocated per project convention) whenever necessary — keep test files clearly named after what they test (e.g., `auth.test.js` for `auth.js`).
- **Single Test Runner:** Maintain **one single entry-point** to run ALL tests (e.g., `tests/run-all.test.js`, an aggregate suite script, or a standard `npm test` / `pytest` command) so the entire test suite can be executed in one go — this makes it easy for AI and humans to verify everything at once.
- **Keep Tests in Sync:** Whenever any file, function, or behavior is changed, update its corresponding tests too. Never leave outdated/failing tests behind — stale tests are treated as broken code.
- **Run After Changes:** After completing any modification, run the full test suite via the single runner to confirm nothing is broken before declaring the task done.

# Permission & Access Control / PermissionGate Standard

Use these rules whenever the application has authentication, paid tiers, roles, administrative functionality, feature restrictions, user-specific exceptions, organization/team access, or any UI element/API action that should not be available to everyone.

The goal is a **single, centralized authorization system** that can manage permissions for:

- an individual user;
- a role or category such as `ADMIN`, `DEVELOPER`, `USER`, or `SUBSCRIBER`;
- a subscription/product plan such as `FREE`, `PRO`, or `ENTERPRISE`;
- a team/organization membership when applicable;
- a specific resource owned by or shared with a user;
- temporary or account-specific permission overrides.

Do not build isolated one-off role checks throughout the app when the same decision belongs in the permission system.

## 1. Core Authorization Principles

- **Backend authorization is authoritative.** A client-side `PermissionGate` is only a UX/presentation layer. Hiding a button, route, menu item, or component is never sufficient security.
- **Default deny.** Unknown role, unknown permission, missing permission data, malformed authorization state, failed policy lookup, or ambiguous ownership must result in denial unless an explicitly designed safe policy says otherwise.
- **Never trust client-provided identity or privilege data.** Do not authorize from request-body `userId`, client-side role values, local storage, query parameters, or arbitrary headers.
- **Authenticate first, authorize second.** The authorization layer must derive the current identity from a verified server-side session/JWT/auth context.
- **Use named permissions instead of numeric role comparisons for ordinary feature authorization.** Never rely on checks such as `role <= 70`, `role > USER`, or similar hierarchy math to decide whether a feature/action is allowed. Numeric rank may be used only for documented administrative hierarchy boundaries such as determining which lower roles a delegated permission manager may manage.
- **Keep permission identifiers stable and centralized.** Examples: `resume:create`, `resume:edit`, `admin:users:manage`, `ai:generate`, `billing:manage`.
- **Separate authentication, authorization, subscription entitlement, and ownership.** They are related but different concerns.
- **Prefer least privilege.** Grant only the capabilities required for the role, plan, user, or action.
- **Fail securely.** Infrastructure failures must not silently make authorization more permissive.

## 2. Required Permission Model

Unless the project has a documented reason to use a different model, permissions should support these independent inputs:

1. **Role permissions** — broad job/access categories, e.g. `ADMIN`, `DEVELOPER`, `USER`.
2. **Plan/category entitlements** — product/subscription access, e.g. `FREE`, `SUBSCRIBER`, `PRO`, `ENTERPRISE`.
3. **User-specific overrides** — grant or deny a permission for one particular user without creating a new role.
4. **Organization/team permissions** — when multi-tenant/team access exists.
5. **Resource policies** — ownership, membership, sharing, tenant boundaries, object state, or other contextual rules.
6. **System safety rules** — immutable rules that ordinary user/role overrides cannot bypass.

Do not model subscription tier and administrative authority as the same thing unless the application truly guarantees they are identical concepts. In most projects, keep `role` and `plan` separate.

## 3. Numeric Role Rank / Hierarchy Convention

When the project uses numeric role values, design them so **lower numbers represent a higher role rank / stronger administrative position**, with `0` reserved for the built-in root `ADMIN`.

A reusable example is:

```text
ADMIN       = 0
OWNER       = 1
...other privileged/internal roles...
DEVELOPER   = 50
...other application roles...
PRO         = 97
SUBSCRIBER  = 98
USER        = 100
```

The exact names and numbers after `0` are project-specific. The example illustrates the ranking idea, not a required list. **If the project separates administrative roles from subscription plans (preferred for most applications), keep those namespaces separate** — for example `roleRank: ADMIN=0, OWNER=1, DEVELOPER=50, USER=100` and a separate plan/category ordering such as `planRank: PRO=97, SUBSCRIBER=98, FREE=100`. A paid-plan rank must never imply administrative authority. Both can use lower-number-is-higher ordering if useful, but named permissions/entitlements remain authoritative.

The important conventions are:

- `ADMIN = 0` is the permanent highest/root administrative rank. No ordinary role may equal or outrank it.
- Smaller numbers represent stronger/higher-ranked roles; larger numbers represent lower-ranked/general-access roles.
- Leave numeric gaps between common roles when useful so future roles can be inserted without renumbering existing stored values.
- Keep role values centralized in one registry/schema; never duplicate magic numbers across the codebase.
- Persist a stable role key/name as well as the numeric rank when practical, so renaming/display changes do not silently change authorization meaning.
- Treat unknown, missing, non-numeric, negative, duplicated-invalid, or otherwise malformed role ranks as an authorization error and fail closed for protected operations.

**The numeric rank is NOT the ordinary feature permission engine.** It may be used for ordering, display, role-assignment boundaries, migration compatibility, and delegated permission-management boundaries, but ordinary feature authorization must resolve named permissions.

Do **not** write ordinary feature checks such as:

```js
if (user.role <= 98) allow();
if (user.role === 0) showFeature();
```

Instead use the centralized resolver/gate. The root Admin's full-access behavior is implemented once inside the authorization system, not repeated throughout feature code:

```js
if (can(user, P.AI_GENERATE)) allow();
```

This prevents a newly inserted role from accidentally inheriting every capability simply because its number falls inside a numeric range.

For role-management boundaries, numeric rank is an additional security rule. Except for root Admin, a caller may never create, assign, edit, delete, or manage a role/user that is **higher than the caller's own rank** (numerically lower), and delegated permission managers may only manage the ranks explicitly allowed by Section 15.

## 3A. Root Admin Is the Permanent System Authority

`ADMIN` at rank `0` is the **root system authority**. This is a mandatory invariant of the default permission architecture. Implement this invariant centrally in trusted server-side authorization code/policy so it cannot be removed by ordinary database permission edits, UI changes, user overrides, subscription state, or delegated permission managers. Do not scatter special `role === 0` checks across the application.

Root Admin must have:

- access to **every application feature, API operation, page, service action, administrative tool, tenant/organization, and resource**;
- all current and future ordinary permissions without requiring every permission to be manually attached to the Admin role;
- authority to create/edit/delete/assign ordinary roles and their permissions;
- authority to grant/revoke individual-user overrides and plan/category permissions;
- authority to grant or revoke **Permission Management** authority to eligible lower-ranked roles/users;
- authority to define or reduce the scope of delegated permission managers;
- authority to view and manage the permission system itself, audit information, and protected permission-management configuration.

Root Admin's effective full access must not be revocable through normal permission CRUD. An explicit user-level deny, plan downgrade, role-permission removal, or ordinary database edit must not accidentally block root Admin. If a product needs a break-glass/security-lock mechanism capable of constraining Admin, that must be a separately designed system-level control documented outside ordinary permission management.

The **assignment of the Admin role is itself security-critical**. Never allow a lower role or delegated permission manager to create, assign, clone, modify, delete, demote, rename into, or otherwise manufacture `ADMIN`, rank `0`, or an equivalent unrestricted system role. Only the existing root Admin authority (or an explicitly documented out-of-band bootstrap/recovery process) may control who is a root Admin.

There must be exactly one canonical root-access rule. Do not create independent unrestricted paths such as `isAdmin`, `ALL`, `rank === 0`, and separate wildcard booleans that can drift apart. The authorization service may recognize the protected `ADMIN`/rank-`0` system role internally, but all callers should still use the common `can()/authorize()` interface.

## 4. Canonical Authorization Data Model

When creating a permission system from scratch, use equivalent structures to the following. Adapt storage details to the framework/database, but preserve the responsibilities:

- **Permission registry** — stable permission key, description, category, and optional risk/sensitivity metadata.
- **Role** — stable role key/name, numeric `rank`, display metadata, and whether it is system-protected.
- **RolePermission** — grants named permissions to a role/category.
- **Plan/Entitlement** — subscription/product plan independent from administrative role.
- **PlanPermission** — grants named product capabilities to a plan.
- **UserPermissionOverride** — sparse per-user overrides containing `permission`, `effect: allow|deny`, optional expiry, reason, actor, and timestamps. Do not copy the full inherited permission set onto every user.
- **Organization/Team Membership** — tenant/team role and scope when the product supports organizations.
- **Resource policy/relationship data** — ownership, sharing, delegation, or scope required for object-level decisions.
- **Authorization/Audit event** — security-sensitive changes to roles, plans, overrides, and privileged actions when auditing is required.

The system must be able to answer both:

```text
What permissions does this role/plan/category grant?
What are this specific user's effective permissions right now?
```

The effective result must be calculated from authoritative current data plus safe caching/versioning, never from a client-supplied permission array.

Example conceptual user authorization state:

```js
{
  userId: "...",
  role: "USER",
  plan: "PRO",
  organizationId: "...",
  permissionOverrides: {
    "ai:generate": "allow",
    "resume:export": "deny"
  }
}
```

## 5. Effective Permission Resolution

Create one centralized server-side authorization resolver, such as:

```js
can(user, permission, context?)
authorize(request, permission, context?)
getEffectivePermissions(user)
```

Avoid duplicating permission-resolution rules in routes, services, React components, middleware, and background jobs.

A robust default precedence is:

1. Validate the permission identifier and authorization input.
2. Apply immutable/system safety restrictions.
3. Apply an explicit user-level **deny** override, if one exists.
4. Apply an explicit user-level **allow** override, if one exists and no non-overridable safety rule blocks it.
5. Evaluate grants inherited from roles/categories/plans/organizations.
6. Evaluate resource/context rules such as ownership or tenant membership.
7. If no rule grants access, **deny**.

If the project uses a different precedence, document it explicitly and test it exhaustively. Do not let precedence emerge accidentally from implementation order.

Prefer absence of a grant over broad category-level explicit denies. User-specific deny overrides are useful for exceptions and emergency revocation.

## 6. Single-User and Whole-Category Management

The authorization data model/admin tooling must make both of these operations possible without code changes:

### Category-wide change

Example: give every `SUBSCRIBER` the `ai:generate` permission.

- Modify the role/plan/category permission mapping centrally.
- Invalidate affected permission caches immediately.
- Existing users in that category should receive the new effective permission according to the system's refresh/session policy.

### Single-user exception

Example: allow one free user to use `ai:generate`, or temporarily deny export for one subscriber.

- Store a user-specific permission override rather than creating a special one-person role.
- Support both `allow` and `deny` overrides when the product needs exceptions.
- Record who changed the override, when, and optionally why/when it expires for sensitive systems.

Do not copy the entire role permission array onto the user just to change one permission; store only the override/delta so later category updates still propagate correctly.

## 7. PermissionGate Requirements

Create/reuse a shared UI primitive rather than hand-writing role checks throughout components.

Conceptual API:

```jsx
<PermissionGate permission={PERMISSIONS.AI_GENERATE}>
  <GenerateButton />
</PermissionGate>
```

It should also support common compound cases where useful:

```jsx
<PermissionGate allOf={[P.RESUME_EDIT, P.AI_EDIT]}>
  <AiEditPanel />
</PermissionGate>

<PermissionGate anyOf={[P.ADMIN_USERS_VIEW, P.ADMIN_USERS_MANAGE]}>
  <UsersNavItem />
</PermissionGate>
```

Recommended capabilities:

- `permission` for one capability;
- `allOf` when every permission is required;
- `anyOf` when at least one permission is required;
- `fallback` for denied state;
- `loadingFallback` while effective permissions are unresolved;
- optional `mode="hide" | "disable"` when the product intentionally needs disabled controls;
- optional denial reason for upgrade prompts or admin diagnostics without exposing sensitive policy internals.

Rules for the UI gate:

- Default to **not rendering privileged children** while permission state is unknown/loading.
- Do not briefly render protected UI and remove it after hydration.
- Do not execute effects, data fetching, mutations, or privileged child initialization before authorization is known.
- Do not use the gate as the only protection around API calls.
- Do not encode separate permission mappings inside the component.
- Do not hard-code `user.role === ...` inside feature components when a permission exists for that decision.

## 8. Client Permission Source of Truth

The browser should consume **server-derived effective capabilities** rather than independently rebuilding live authorization policy from hard-coded role maps.

For example, session/bootstrap data may contain:

```js
{
  user: { id: "...", role: "USER", plan: "PRO" },
  capabilities: ["resume:create", "resume:edit", "ai:generate"],
  authorizationVersion: 42
}
```

The client copy is for consistent UX only. Every protected server operation must still perform authoritative authorization.

Static constants may define permission **names/metadata**, but they should not become a second independent live policy engine if permissions are dynamically configurable on the server.

## 9. API and Service Authorization

Prefer authorization APIs that derive identity from the authenticated request/context:

```js
await authorize(request, P.RESUME_EDIT, { resource: resume });
```

instead of APIs that encourage callers to pass arbitrary identity values:

```js
await requirePermission(userId, P.RESUME_EDIT);
```

If an internal helper accepts a user ID, it must only receive a server-trusted identity produced by authentication code.

Every protected API route/action must authorize server-side even if:

- the route is hidden from navigation;
- middleware already checked authentication;
- the button is wrapped in `PermissionGate`;
- the user normally cannot discover the endpoint;
- a higher-level page was previously authorized.

Use defense in depth without creating contradictory authorization implementations.

## 10. Resource-Level Authorization / IDOR Protection

Feature permission alone is not enough for object-specific operations.

Example: two users may both have `resume:edit`, but User A must not automatically be able to edit User B's resume.

For resource actions, evaluate both capability and resource context:

```js
can(user, P.RESUME_EDIT, { resource: resume })
```

Typical resource checks include:

- `resource.ownerId === user.id`;
- organization/tenant membership;
- explicit sharing/delegation;
- team role;
- object state (locked, archived, finalized, etc.);
- scoped administrative access.

Never trust an object ID supplied by the client as proof of access. Load/resolve the resource and authorize it against the authenticated user.

## 11. Route/Middleware Rules

Middleware may perform coarse checks such as authentication, tenant routing, or obvious admin-area rejection, but it should not be the sole source of fine-grained authorization.

If middleware forwards identity through internal headers:

- strip any client-supplied copy of those headers first;
- overwrite them with server-verified values;
- ensure protected routes cannot bypass that trusted boundary;
- prefer framework/server auth context where available over custom identity headers.

Never treat a request header as trusted merely because its name looks internal.

## 12. Database Failure, Fallback, and Fail-Closed Behavior

Do **not** fall back from a dynamic permission database to potentially broader hard-coded default permissions when the database is unavailable.

Bad security behavior:

```text
permission store unavailable -> use original static grants -> access may become broader
```

Preferred behavior:

```text
current policy available
  -> evaluate current policy

current policy unavailable
  -> use verified last-known-good policy if explicitly supported
  -> otherwise deny
```

For sensitive actions such as managing users, roles, permissions, billing, impersonation, exports, or destructive actions, favor fail-closed behavior.

Any availability-oriented fallback must be explicitly documented, bounded, observable, and proven not to increase privilege.

## 13. Caching and Immediate Revocation

Permission caching is allowed for performance, but design for revocation.

- Do not rely only on a long TTL for security-sensitive permissions.
- Invalidate affected caches immediately after role/plan/user permission changes.
- In distributed/serverless deployments, use a shared invalidation mechanism or authorization version so every instance converges correctly.
- Consider `authorizationVersion`, `permissionVersion`, or equivalent policy versioning.
- High-risk revocations should take effect as quickly as the project's security requirements demand.
- A stale cache must never outlive an explicitly documented maximum revocation window.

Consider bypassing or shortening caches for especially sensitive permissions such as:

- user management;
- role/permission management;
- billing changes;
- impersonation;
- sensitive data export;
- destructive administrative actions.

## 14. Superuser / Wildcard Rules

The canonical unrestricted authority is the protected root `ADMIN` role at rank `0`, as defined above. Avoid multiple unrelated ways to obtain unrestricted access.

Do not casually combine mechanisms such as:

```js
role.isAdmin === true || permissions.includes("ALL") || roleLevel <= 0
```

Instead, implement one centrally tested root-Admin rule inside the authorization service. If the implementation internally uses a wildcard/superuser marker, it must be an implementation detail of the protected Admin policy rather than an ordinary assignable permission.

The root authority mechanism must:

- be immutable or changeable only by root Admin / documented bootstrap-recovery controls;
- never be assignable by delegated permission managers;
- never be grantable through ordinary role-permission or user-override CRUD;
- never be grantable by a user to themselves;
- reject attempts to create another rank-`0`/Admin-equivalent role through ordinary APIs;
- be covered by tests proving normal permission CRUD cannot accidentally create superusers.

## 15. Permission Administration and Delegation

Permission administration is distinct from the frontend `PermissionGate`. Use separate concepts/permissions so an AI or developer never confuses the ability to *check* a permission with the ability to *edit* the permission system.

Use at least these conceptual capabilities (names may be adapted to the project's naming convention):

```text
admin:permissions:manage      -> manage ordinary permissions within an assigned scope
admin:permissions:delegate    -> decide who may manage permissions; ROOT ADMIN ONLY
```

### Root Admin delegation rule

- Root `ADMIN` (`rank = 0`) always has both capabilities and full permission-system control.
- **Only root Admin may grant or revoke Permission Management authority** to another user or role.
- `admin:permissions:delegate` is system-protected, non-delegable, and must never be assignable through normal permission CRUD.
- A delegated permission manager receives only `admin:permissions:manage` plus an explicit management scope. They do not receive the right to appoint another permission manager.
- A delegated manager must never be able to modify Admin, rank `0`, the Admin role definition, Admin users, the root-access mechanism, or any configuration that could manufacture equivalent root authority.

### Rank boundary for delegated managers

When Admin gives permission-management authority to a lower role/user, that manager may manage only their **own rank and lower ranks** unless Admin narrows the scope further. With lower numbers representing higher authority:

```text
ADMIN = 0
OWNER = 1
DEVELOPER = 50
USER = 100
```

Examples:

- Admin `0` can manage everyone and everything.
- If Admin delegates permission management to Owner `1`, Owner may manage rank `1` and numerically higher/lower-authority ranks, but can never manage Admin `0`.
- If Admin delegates permission management to Developer `50`, Developer may manage rank `50` and numerically higher/lower-authority ranks such as `60`, `97`, `98`, `100`, but never ranks `0-49`.
- Admin may configure a stricter target boundary if desired (for example, Developer `50` may be allowed to manage only ranks `70-100`).

The server must enforce this boundary. UI hiding alone is insufficient. Conceptually:

```text
caller has admin:permissions:manage
AND target.rank >= caller-managed-min-rank / allowed target range
AND target is not ADMIN/rank 0
AND requested permission is inside caller's Admin-assigned permission scope
AND requested permission is delegable
=> permission change may proceed
```

### Permission ceiling / scope

Delegated permission management must have an Admin-defined permission ceiling. A delegated manager cannot automatically grant every permission merely because the target role is lower.

A safe default is that a delegated manager may grant/revoke only permissions that:

1. are marked **delegable**;
2. are inside the explicit `allowedPermissions` / permission categories Admin assigned to that manager;
3. are for a target role/user within the manager's allowed rank range;
4. do not grant root/system authority;
5. do not modify permission-delegation authority itself;
6. do not expand the manager's own management scope;
7. do not change role ranks or protected system-role metadata.

Where practical, also require the manager to possess the ordinary capability being granted, unless Admin explicitly configured a management-only exception. This prevents a manager from granting powers they were never trusted to administer.

Example conceptual delegated scope:

```js
{
  principal: "OWNER",
  permissionManagement: {
    enabled: true,
    minTargetRank: 1,
    allowedPermissions: [
      "resume:create",
      "resume:edit",
      "ai:generate",
      "ai:edit",
      "resume:export"
    ]
  }
}
```

Changing `enabled`, `minTargetRank`, `allowedPermissions`, protected-permission categories, or any equivalent **management scope configuration** is itself Admin-only. Delegated managers cannot widen their own scope, lower their own rank, or grant themselves a protected permission to escape the ceiling.

### Protected/non-delegable permissions

Maintain metadata for permissions that no delegated manager may grant, even to lower roles. Examples may include:

```text
admin:permissions:delegate
admin:root:access
admin:roles:rank-change
admin:system-role:create
admin:admin-users:manage
admin:ownership:transfer
admin:security-settings:manage
```

Use metadata such as `systemProtected`, `adminOnly`, and/or `delegable: false`, enforced by the backend. Do not rely on hiding these permissions in the admin UI.

### Same-rank and self-management safety

If Admin allows a delegated manager to administer their own rank/category, distinguish **ordinary permissions on that role/category** from the manager's **permission-management authority**. A manager may change allowed ordinary permissions for an eligible same-rank role only within Admin's configured scope, but must never be able to:

- grant/revoke `admin:permissions:delegate`;
- widen their own managed target range or permission ceiling;
- promote their own rank;
- turn their role into Admin/rank `0`;
- grant themselves a protected/system permission;
- disable security/audit controls governing their actions.

For especially sensitive projects, Admin may choose to prohibit delegated managers from changing their own user record even when same-rank category management is allowed.

### Permission administration UI requirements

When the project includes permission-management screens, support clear management of:

- roles/categories and their ordinary grants;
- plans/subscription entitlements;
- individual user overrides;
- organization/team permissions where relevant;
- delegated permission managers and their Admin-defined scopes (**visible/editable by Admin; read-only or hidden for others as appropriate**);
- effective permissions for a selected user;
- the origin of each effective permission (root Admin, role, plan, user override, organization, system);
- explicit denies;
- optional expiration for temporary overrides;
- audit history for sensitive permission changes.

Before saving a high-impact permission change, clearly show what users/categories will be affected when practical.

Every permission-management API must independently validate the caller, target rank, requested permission, delegation status, protected-permission metadata, and the caller's Admin-assigned management scope. Never trust target/scope restrictions supplied only by the client.

## 16. Audit Logging

For security-sensitive systems, record authorization-administration events such as:

- permission granted/revoked;
- permission-management authority granted/revoked by Admin;
- delegated manager scope changed;
- blocked attempts to modify Admin/root or exceed delegated scope;
- role changed;
- plan/admin entitlement changed manually;
- user override created/removed;
- system role changed;
- impersonation begun/ended;
- permission-management failure or suspicious denial patterns when appropriate.

Audit records should include actor, target, change, timestamp, and relevant request/context identifiers. Avoid logging secrets or unnecessary sensitive data.

## 17. Permission Naming and Registry

Use stable semantic permission names based on actions/capabilities, not UI labels.

Good:

```text
resume:create
resume:edit
resume:delete
resume:export
ai:generate
admin:users:view
admin:users:manage
admin:permissions:manage
billing:manage
```

Avoid vague names such as:

```text
PRO_FEATURE
ACCESS_PAGE_2
BUTTON_ENABLED
LEVEL_70
```

Keep a central permission registry with descriptions and optional metadata such as risk level/category. Removing or renaming a permission requires a migration/compatibility check across code, database records, tests, docs, and admin UI.

## 18. Do Not Scatter Authorization Logic

When adding a protected feature, search the codebase before creating new authorization logic.

Reuse the central authorization service and `PermissionGate` instead of introducing patterns such as:

```js
if (user.role === "SUBSCRIBER") ...
if (user.isAdmin) ...
if (plan === "pro") ...
```

unless those facts are themselves the actual business rule and are intentionally outside the permission system.

When legacy one-off checks exist, prefer migrating them toward the centralized permission model rather than adding another parallel pattern.

## 19. Permission Changes and Sessions

Define what happens when access changes while a user is signed in.

The system must account for:

- role promotion/demotion;
- subscription upgrade/downgrade/expiration;
- individual permission revocation;
- organization removal;
- account suspension;
- admin/security revocation.

Do not assume an old JWT/session may retain stale privilege forever. Use suitable session refresh, version checks, token rotation/revocation, or server-side policy lookup based on the project's architecture and security requirements.

For high-risk revocations, prioritize immediate/near-immediate enforcement over convenience.

## 20. Subscription/Plan Changes

Do not rely solely on client state or periodic UI checks for paid access.

When subscription state changes:

- update authoritative server-side entitlement data;
- validate webhook/provider events securely when used;
- make entitlement updates idempotent;
- invalidate authorization caches;
- handle downgrade/expiration consistently;
- avoid granting paid permissions merely because a client claims a paid plan.

Keep plan entitlements separate from administrative powers unless explicitly required by the product model.

## 21. Atomicity and Race Conditions

Authorization is not enough when the protected action also consumes limited resources or changes quotas.

For credits, limits, one-time actions, seat counts, or similar rules:

- perform authorization and state-changing constraints safely;
- use transactions/atomic updates/locking/idempotency as appropriate;
- prevent two concurrent requests from both passing a limit check and overspending the resource;
- revalidate critical state close to the write operation.

## 22. Error Handling

Use consistent status behavior:

- unauthenticated -> `401` where appropriate;
- authenticated but unauthorized -> `403`;
- inaccessible resources may intentionally return `404` when that prevents resource enumeration, according to project policy.

Do not leak sensitive policy internals to clients. Client-facing denial responses may include a safe machine-readable reason/code, while detailed diagnostics remain server-side.

## 23. Minimum Tests for Every Permission System

Maintain automated tests covering at least:

1. unauthenticated access is rejected;
2. permitted role/category can access the action;
3. non-permitted role/category cannot access it;
4. a single-user allow override works;
5. a single-user deny override works and takes precedence as designed;
6. category permission changes affect members correctly;
7. unknown/malformed role or permission fails closed;
8. client-side `PermissionGate` agrees with server-derived capability state;
9. direct API access cannot bypass a hidden UI control;
10. one user cannot access another user's protected resource (IDOR/BOLA test);
11. client-supplied identity/header spoofing cannot change authorization;
12. permission-store/database failure does not broaden access;
13. cache invalidation/revocation works;
14. old session/token behavior after role or permission changes matches documented policy;
15. system/superuser roles cannot be created/escalated through ordinary permission management;
16. plan upgrade/downgrade/expiration updates entitlements correctly;
17. compound `allOf`/`anyOf` gate logic works;
18. loading/unknown permission state does not flash privileged UI;
19. concurrent quota/credit operations cannot bypass limits;
20. audit entries are created for sensitive permission administration where auditing is required;
21. root Admin can access every protected capability/resource through the centralized authorization service;
22. ordinary permission removal/deny/plan changes cannot accidentally remove root Admin authority;
23. only root Admin can grant/revoke permission-management delegation;
24. a delegated Owner/Developer can manage allowed permissions only for its configured rank range (same/lower as permitted);
25. a delegated manager cannot modify Admin/rank `0` or any higher-ranked target;
26. a delegated manager cannot delegate permission-management authority to another user/role;
27. a delegated manager cannot widen its own management scope, lower its rank, or grant protected/non-delegable permissions;
28. direct API requests cannot bypass delegated rank/permission ceilings even if the UI is manipulated.

For any newly protected feature, add positive and negative authorization tests. A test that only verifies the allowed path is incomplete.

## 24. Required Review When Adding a Protected Feature

Whenever a new feature needs gating, the AI/developer must explicitly check:

1. What named permission represents the action?
2. Which roles/categories/plans receive it by default?
3. Can an individual user be granted/denied it without a new role?
4. Is resource ownership/tenant context also required?
5. Is the backend/API protected?
6. Is service/background-job access protected if relevant?
7. Does the client use the shared `PermissionGate`?
8. What happens while capability state is loading?
9. What happens if authorization storage/cache is unavailable?
10. How quickly must revocation take effect?
11. Does the change need an audit log?
12. Are positive, negative, spoofing, and ownership tests present?
13. Were `docs/architecture.md` and relevant tests/docs updated?
14. If permission administration is involved, is root Admin the only authority allowed to delegate permission-management control?
15. Are delegated managers restricted to the Admin-defined target-rank range and permission ceiling, with Admin/rank `0` fully protected?
16. Can any path let a delegated manager widen their own scope, create Admin-equivalent authority, or delegate permission management further? It must not.
17. Was a final search performed for bypassing role/plan checks or duplicate authorization logic?

Do not mark the feature complete until both UI and backend behavior are verified.

## 25. Security Anti-Patterns to Reject

Treat the following as bugs unless specifically documented and justified:

- UI-only authorization;
- trusting `userId`, role, plan, or permission arrays supplied by the client;
- direct numeric role comparisons for access decisions;
- a database outage increasing privilege;
- static client permissions disagreeing with dynamic server policy;
- long-lived stale permission caches without revocation strategy;
- no resource ownership/tenant check on object endpoints;
- arbitrary internal headers accepted from clients;
- unrestricted `ALL`/wildcard permissions editable by ordinary admins;
- creating a new role for every individual exception;
- copying category permissions into every user record instead of storing overrides;
- scattered `isAdmin`, `role ===`, or `plan ===` checks replacing the central policy engine;
- stale JWT/session privileges with no documented invalidation behavior;
- exposing privileged child components before permissions load;
- permission changes with no tests or no cache/session invalidation;
- allowing a user/admin to escalate their own authority without an explicitly authorized policy path;
- allowing anything except root Admin to grant/revoke permission-management delegation;
- allowing delegated managers to modify Admin/rank `0`, higher-ranked users/roles, or protected system permissions;
- allowing delegated managers to widen their own management scope, change their rank to escape boundaries, or create an Admin-equivalent role;
- treating frontend `PermissionGate` access as permission-system administration authority.

## 26. Documentation Requirements for Permission Systems

When a project contains permissions, keep `docs/architecture.md` updated with:

- permission-system files and functions;
- permission registry location;
- role/category mappings;
- plan entitlement mappings;
- user-override storage/model;
- effective permission resolution order;
- `PermissionGate` implementation and usage;
- backend authorization helpers;
- resource/ownership policy helpers;
- cache/version/invalidation strategy;
- session/token revocation behavior;
- permission administration UI/API;
- root Admin invariant and bootstrap/recovery policy;
- delegated permission-management rules, target-rank boundaries, protected permissions, and Admin-assigned scopes;
- audit logging components;
- related environment variables;
- related tests and how to run them.

Record discovered permission vulnerabilities or architectural improvements in `docs/suggestions.md` under the appropriate section until implemented.

## 27. Definition of Done for Permission Work

Permission-related work is not complete until:

- authorization uses the centralized permission system;
- the backend is authoritative;
- the UI uses the shared gate where appropriate;
- user-level and category-level management continue to work correctly;
- root Admin retains centralized full authority and cannot be modified by delegated managers;
- any delegated permission manager is constrained to the exact target-rank range and permission ceiling assigned by Admin and cannot delegate that authority further;
- resource-level authorization is included where necessary;
- failure modes fail closed or follow a documented safe fallback;
- cache/session revocation behavior is verified;
- tests cover allowed and denied paths plus relevant security regressions;
- the full test suite passes;
- a fresh codebase scan finds no accidental bypass/duplicate old pattern;
- `docs/architecture.md` is updated;
- vulnerabilities/improvements are captured in `docs/suggestions.md` when applicable.

## Commit Workflow

- **During active development (in progress):** Commit changes to the **local repository only** — do not push to remote. Use descriptive but incremental commit messages.
- **When work is confirmed working:** Once I confirm (either explicitly or by expressing satisfaction with the result), push the commits to the **remote repository**. Do not wait for an explicit "push" or "commit" instruction — if the work is clearly done and I've acknowledged it's good, go ahead and push.
