import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDatabase, stopTestDatabase, clearDatabase, TEST_ENV } from "../helpers/mongo";
import { authCookie, requestWithCookie } from "../helpers/request";
import { seedUser } from "../helpers/users";
import { resetEnvCache } from "@/lib/env";
import { GET as listProjects, POST as createProject } from "@/app/api/projects/route";
import {
  GET as getProject,
  PATCH as patchProject,
  DELETE as deleteProject,
} from "@/app/api/projects/[slug]/route";
import { POST as refreshGithub } from "@/app/api/projects/[slug]/github/route";
import { GET as getSettingsRoute, PATCH as patchSettings } from "@/app/api/settings/route";
import { POST as rotateKey } from "@/app/api/settings/rotate-key/route";
import { GET as listUsers, POST as createUserRoute } from "@/app/api/users/route";
import { PATCH as patchUser, DELETE as deleteUser } from "@/app/api/users/[id]/route";
import { ProjectModel } from "@/lib/db/projects";
import { ApiKeyModel } from "@/lib/db/apikeys";
import { SecretModel } from "@/lib/db/secrets";
import { AuditEventModel } from "@/lib/db/ops";

const ORIGIN = "http://localhost:3000";
const NO_STORE = "no-store";

let ownerCookie: { name: string; value: string };
let ownerId: string;

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

beforeAll(async () => {
  await startTestDatabase();
});

afterAll(async () => {
  await stopTestDatabase();
});

beforeEach(async () => {
  await clearDatabase();
  resetEnvCache();
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] = value;
  }
  ownerId = await seedUser({ email: "owner@example.com", role: "ADMIN" });
  ownerCookie = await authCookie({ id: ownerId, email: "owner@example.com", role: "ADMIN" });
});

describe("projects API authorization", () => {
  it("refuses unauthenticated reads and writes", async () => {
    const anon = requestWithCookie(`${ORIGIN}/api/projects`);
    expect((await listProjects(anon)).status).toBe(401);
    expect((await createProject(requestWithCookie(`${ORIGIN}/api/projects`, undefined, json({ name: "X" })))).status).toBe(401);
  });

  it("refuses a role without projects.view", async () => {
    const userId = await seedUser({
      email: "reader@example.com",
      role: "USER",
      overrides: { "projects.view": "deny" },
    });
    const cookie = await authCookie({ id: userId, email: "reader@example.com", role: "USER" });
    const response = await listProjects(requestWithCookie(`${ORIGIN}/api/projects`, cookie));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it("refuses creation for a role without projects.create but allows viewing", async () => {
    const userId = await seedUser({ email: "reader@example.com", role: "USER" });
    const cookie = await authCookie({ id: userId, email: "reader@example.com", role: "USER" });
    expect((await listProjects(requestWithCookie(`${ORIGIN}/api/projects`, cookie))).status).toBe(200);
    expect(
      (
        await createProject(
          requestWithCookie(`${ORIGIN}/api/projects`, cookie, json({ name: "Nope" })),
        )
      ).status,
    ).toBe(403);
  });
});

describe("projects CRUD", () => {
  it("creates, reads, updates and deletes a project", async () => {
    const created = await createProject(
      requestWithCookie(
        `${ORIGIN}/api/projects`,
        ownerCookie,
        json({ name: "My Store", status: "building", tags: ["next", "mongo"] }),
      ),
    );
    expect(created.status).toBe(201);
    const project = (await created.json()) as { project: { slug: string; status: string } };
    expect(project.project.slug).toBe("my-store");
    expect(project.project.status).toBe("building");

    const fetched = await getProject(
      requestWithCookie(`${ORIGIN}/api/projects/my-store`, ownerCookie),
      { params: Promise.resolve({ slug: "my-store" }) },
    );
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("cache-control")).toBe(NO_STORE);

    const updated = await patchProject(
      requestWithCookie(
        `${ORIGIN}/api/projects/my-store`,
        ownerCookie,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "live" }) },
      ),
      { params: Promise.resolve({ slug: "my-store" }) },
    );
    expect((await updated.json()).project.status).toBe("live");

    const removed = await deleteProject(
      requestWithCookie(`${ORIGIN}/api/projects/my-store`, ownerCookie, { method: "DELETE" }),
      { params: Promise.resolve({ slug: "my-store" }) },
    );
    expect(removed.status).toBe(200);
    expect(await ProjectModel.countDocuments({})).toBe(0);
  });

  it("generates a unique slug and rejects duplicates", async () => {
    await createProject(requestWithCookie(`${ORIGIN}/api/projects`, ownerCookie, json({ name: "Dup" })));
    const second = await createProject(
      requestWithCookie(`${ORIGIN}/api/projects`, ownerCookie, json({ name: "Dup" })),
    );
    expect(second.status).toBe(201);
    expect((await second.json()).project.slug).toBe("dup-2");
  });

  it.each(["", "   "])("auto-generates unique slugs for blank form input %j", async (slug) => {
    for (const expected of ["resume-builder", "resume-builder-2"]) {
      const response = await createProject(
        requestWithCookie(`${ORIGIN}/api/projects`, ownerCookie, json({ name: "Resume Builder", slug })),
      );
      expect(response.status).toBe(201);
      expect((await response.json()).project.slug).toBe(expected);
    }
    expect(await ProjectModel.countDocuments({})).toBe(2);
  });

  it.each(["ResumeBuilder", "resume builder", "resume_builder"])("rejects invalid explicit slug %j", async (slug) => {
    const response = await createProject(
      requestWithCookie(`${ORIGIN}/api/projects`, ownerCookie, json({ name: "Resume Builder", slug })),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).fieldErrors).toEqual([{ field: "slug", message: "Use lowercase letters and numbers separated by hyphens, e.g. resume-builder." }]);
    expect(await ProjectModel.countDocuments({})).toBe(0);
  });

  it("keeps the existing slug when an edit submits a blank slug", async () => {
    await createProject(requestWithCookie(`${ORIGIN}/api/projects`, ownerCookie, json({ name: "Keep Slug", slug: "keep-slug" })));
    const response = await patchProject(
      requestWithCookie(`${ORIGIN}/api/projects/keep-slug`, ownerCookie, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "", status: "live" }),
      }),
      { params: Promise.resolve({ slug: "keep-slug" }) },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).project).toMatchObject({ slug: "keep-slug", status: "live" });
  });

  it("validates input with zod", async () => {
    const response = await createProject(
      requestWithCookie(`${ORIGIN}/api/projects`, ownerCookie, json({ name: "" })),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ fieldErrors: [{ field: "name", message: "Enter a project name." }] });
    const badLink = await createProject(
      requestWithCookie(
        `${ORIGIN}/api/projects`,
        ownerCookie,
        json({ name: "Links", links: [{ type: "github", url: "not-a-url" }] }),
      ),
    );
    expect(badLink.status).toBe(400);
    expect(await badLink.json()).toMatchObject({ fieldErrors: [{ field: "links.0.url", message: "Enter a complete URL, e.g. https://example.com." }] });
  });

  it.each([{}, { name: "   " }])("explains missing names: %j", async (payload) => {
    const response = await createProject(requestWithCookie(`${ORIGIN}/api/projects`, ownerCookie, json(payload)));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ fieldErrors: [{ field: "name", message: "Enter a project name." }] });
    expect(await ProjectModel.countDocuments({})).toBe(0);
  });

  it("reports all edit validation failures and leaves the project unchanged", async () => {
    await createProject(requestWithCookie(`${ORIGIN}/api/projects`, ownerCookie, json({ name: "Edit" })));
    const response = await patchProject(requestWithCookie(`${ORIGIN}/api/projects/edit`, ownerCookie, {
      ...json({ name: " ", slug: "BAD", links: [{ type: "live", url: "invalid" }] }), method: "PATCH",
    }), { params: Promise.resolve({ slug: "edit" }) });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.issues).toBe(3);
    expect(body.fieldErrors.map((issue: { field: string }) => issue.field)).toEqual(["name", "slug", "links.0.url"]);
    expect((await ProjectModel.findOne({ slug: "edit" }))?.name).toBe("Edit");
  });

  it.each(["POST", "PATCH"])("explains malformed JSON in %s", async (method) => {
    const request = requestWithCookie(`${ORIGIN}/api/projects/edit`, ownerCookie, { method, headers: { "content-type": "application/json" }, body: "{" });
    const response = method === "POST" ? await createProject(request) : await patchProject(request, { params: Promise.resolve({ slug: "edit" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_json" });
    expect(response.headers.get("cache-control")).toBe(NO_STORE);
  });

  it("checks authorization before exposing create/edit validation details", async () => {
    const id = await seedUser({ email: "unprivileged@example.com", role: "USER" });
    const cookie = await authCookie({ id, email: "unprivileged@example.com", role: "USER" });
    for (const session of [undefined, cookie]) {
      const created = await createProject(requestWithCookie(`${ORIGIN}/api/projects`, session, json({ name: "" })));
      const edited = await patchProject(requestWithCookie(`${ORIGIN}/api/projects/edit`, session, { ...json({ slug: "BAD" }), method: "PATCH" }), { params: Promise.resolve({ slug: "edit" }) });
      for (const response of [created, edited]) {
        expect(response.status).toBe(session === undefined ? 401 : 403);
        expect(await response.json()).toEqual({ error: session === undefined ? "unauthorized" : "forbidden" });
      }
    }
  });

  it("saves unchanged and renamed slugs, returning 409 for actual conflicts", async () => {
    for (const name of ["First", "Second"]) {
      await createProject(requestWithCookie(`${ORIGIN}/api/projects`, ownerCookie, json({ name })));
    }
    const duplicate = await createProject(requestWithCookie(`${ORIGIN}/api/projects`, ownerCookie, json({ name: "Third", slug: "first" })));
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "slug_in_use" });
    for (const [slug, expected] of [["first", 200], ["second", 409], ["renamed", 200]] as const) {
      const response = await patchProject(requestWithCookie(`${ORIGIN}/api/projects/first`, ownerCookie, { ...json({ slug, description: "Updated" }), method: "PATCH" }), { params: Promise.resolve({ slug: "first" }) });
      expect(response.status).toBe(expected);
      if (expected === 409) expect(await response.json()).toEqual({ error: "slug_in_use" });
    }
    expect(await ProjectModel.countDocuments({})).toBe(2);
    expect((await ProjectModel.findOne({ slug: "renamed" }))?.description).toBe("Updated");
  });

  it("404s an unknown project and refuses deletion for non-admins", async () => {
    const missing = await getProject(
      requestWithCookie(`${ORIGIN}/api/projects/ghost`, ownerCookie),
      { params: Promise.resolve({ slug: "ghost" }) },
    );
    expect(missing.status).toBe(404);

    await createProject(requestWithCookie(`${ORIGIN}/api/projects`, ownerCookie, json({ name: "Keep" })));
    const devId = await seedUser({ email: "dev@example.com", role: "DEVELOPER" });
    const devCookie = await authCookie({ id: devId, email: "dev@example.com", role: "DEVELOPER" });
    const denied = await deleteProject(
      requestWithCookie(`${ORIGIN}/api/projects/keep`, devCookie, { method: "DELETE" }),
      { params: Promise.resolve({ slug: "keep" }) },
    );
    expect(denied.status).toBe(403);
    expect(await ProjectModel.countDocuments({})).toBe(1);
  });

  it("filters and searches without regex injection", async () => {
    await createProject(requestWithCookie(`${ORIGIN}/api/projects`, ownerCookie, json({ name: "Alpha", tags: ["web"] })));
    await createProject(requestWithCookie(`${ORIGIN}/api/projects`, ownerCookie, json({ name: "Beta", tags: ["api"] })));

    const searched = await listProjects(
      requestWithCookie(`${ORIGIN}/api/projects?q=${encodeURIComponent("alp")}`, ownerCookie),
    );
    expect(((await searched.json()) as { projects: { name: string }[] }).projects).toHaveLength(1);

    const injection = await listProjects(
      requestWithCookie(`${ORIGIN}/api/projects?q=${encodeURIComponent(".*")}`, ownerCookie),
    );
    expect(((await injection.json()) as { projects: unknown[] }).projects).toHaveLength(0);

    const anchored = await listProjects(
      requestWithCookie(`${ORIGIN}/api/projects?q=${encodeURIComponent("^Alpha$")}`, ownerCookie),
    );
    expect(
      ((await anchored.json()) as { projects: { name: string }[] }).projects.map((p) => p.name),
    ).toEqual([]);

    const literal = await listProjects(
      requestWithCookie(`${ORIGIN}/api/projects?q=${encodeURIComponent("Alpha")}`, ownerCookie),
    );
    expect(
      ((await literal.json()) as { projects: { name: string }[] }).projects.map((p) => p.name),
    ).toEqual(["Alpha"]);

    const byStatus = await listProjects(
      requestWithCookie(`${ORIGIN}/api/projects?status=live`, ownerCookie),
    );
    expect(((await byStatus.json()) as { projects: unknown[] }).projects).toHaveLength(0);
  });

  it("cascades deletion to keys and secrets", async () => {
    await createProject(requestWithCookie(`${ORIGIN}/api/projects`, ownerCookie, json({ name: "Cascade" })));
    const project = await ProjectModel.findOne({ slug: "cascade" });
    await ApiKeyModel.create({
      projectId: project!._id,
      name: "k",
      kind: "server",
      keyHash: "hash-1",
      prefix: "mlk_abc",
    });
    await SecretModel.create({
      projectId: project!._id,
      environment: "prod",
      key: "API_URL",
      valueEnc: "x",
      iv: "y",
      tag: "z",
    });
    await deleteProject(
      requestWithCookie(`${ORIGIN}/api/projects/cascade`, ownerCookie, { method: "DELETE" }),
      { params: Promise.resolve({ slug: "cascade" }) },
    );
    expect(await ApiKeyModel.countDocuments({})).toBe(0);
    expect(await SecretModel.countDocuments({})).toBe(0);
  });
});

describe("settings API", () => {
  it("requires settings.manage and persists the kill switches", async () => {
    const userId = await seedUser({ email: "reader@example.com", role: "USER" });
    const cookie = await authCookie({ id: userId, email: "reader@example.com", role: "USER" });
    expect((await getSettingsRoute(requestWithCookie(`${ORIGIN}/api/settings`, cookie))).status).toBe(403);

    const patched = await patchSettings(
      requestWithCookie(
        `${ORIGIN}/api/settings`,
        ownerCookie,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ingestEnabled: false }) },
      ),
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).settings.ingestEnabled).toBe(false);
    expect(await AuditEventModel.countDocuments({ action: "settings.updated" })).toBe(1);
  });

  it("validates the settings body", async () => {
    const response = await patchSettings(
      requestWithCookie(
        `${ORIGIN}/api/settings`,
        ownerCookie,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxLogBatch: 5000 }) },
      ),
    );
    expect(response.status).toBe(400);
  });

  it("validates the master-key rotation input", async () => {
    const short = await rotateKey(
      requestWithCookie(`${ORIGIN}/api/settings/rotate-key`, ownerCookie, json({ newKey: "abc", confirm: "ROTATE" })),
    );
    expect(short.status).toBe(400);
    const unconfirmed = await rotateKey(
      requestWithCookie(
        `${ORIGIN}/api/settings/rotate-key`,
        ownerCookie,
        json({ newKey: "b".repeat(64), confirm: "nope" }),
      ),
    );
    expect(unconfirmed.status).toBe(400);
  });
});

describe("users API", () => {
  it("requires users.manage", async () => {
    const userId = await seedUser({ email: "reader@example.com", role: "USER" });
    const cookie = await authCookie({ id: userId, email: "reader@example.com", role: "USER" });
    expect((await listUsers(requestWithCookie(`${ORIGIN}/api/users`, cookie))).status).toBe(403);
    expect((await listUsers(requestWithCookie(`${ORIGIN}/api/users`))).status).toBe(401);
  });

  it("creates a user and records an audit event", async () => {
    const response = await createUserRoute(
      requestWithCookie(
        `${ORIGIN}/api/users`,
        ownerCookie,
        json({ email: "dev@example.com", name: "Dev", password: "long-enough-pass", role: "DEVELOPER" }),
      ),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { user: { accessLevel: number; passwordHash?: string } };
    expect(body.user.accessLevel).toBe(50);
    expect(body.user.passwordHash).toBeUndefined();
    expect(await AuditEventModel.countDocuments({ action: "user.created" })).toBe(1);
  });

  it("rejects a weak password, bad role and duplicate email", async () => {
    expect(
      (
        await createUserRoute(
          requestWithCookie(`${ORIGIN}/api/users`, ownerCookie, json({ email: "a@b.com", password: "short", role: "USER" })),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await createUserRoute(
          requestWithCookie(`${ORIGIN}/api/users`, ownerCookie, json({ email: "a@b.com", password: "long-enough-pass", role: "WIZARD" })),
        )
      ).status,
    ).toBe(400);
    await createUserRoute(
      requestWithCookie(`${ORIGIN}/api/users`, ownerCookie, json({ email: "dup@b.com", password: "long-enough-pass", role: "USER" })),
    );
    const duplicate = await createUserRoute(
      requestWithCookie(`${ORIGIN}/api/users`, ownerCookie, json({ email: "dup@b.com", password: "long-enough-pass", role: "USER" })),
    );
    expect(duplicate.status).toBe(500);
  });

  it("stops a delegated manager from creating admins or granting delegation", async () => {
    const managerId = await seedUser({
      email: "manager@example.com",
      role: "DEVELOPER",
      permissionManagement: {
        enabled: true,
        minTargetRank: 100,
        allowedPermissions: ["projects.edit"],
      },
    });
    const managerCookie = await authCookie({ id: managerId, email: "manager@example.com", role: "DEVELOPER" });

    const makeAdmin = await createUserRoute(
      requestWithCookie(
        `${ORIGIN}/api/users`,
        managerCookie,
        json({ email: "sneaky@example.com", password: "long-enough-pass", role: "ADMIN" }),
      ),
    );
    expect(makeAdmin.status).toBe(403);
    expect(await makeAdmin.json()).toEqual({ error: "delegate_root_only" });

    const delegate = await createUserRoute(
      requestWithCookie(
        `${ORIGIN}/api/users`,
        managerCookie,
        json({
          email: "sneaky2@example.com",
          password: "long-enough-pass",
          role: "USER",
          permissionManagement: { enabled: true, minTargetRank: 100, allowedPermissions: ["projects.edit"] },
        }),
      ),
    );
    expect(delegate.status).toBe(403);
    expect(await delegate.json()).toEqual({ error: "delegate_root_only" });
  });

  it("enforces the rank boundary when a manager edits a user", async () => {
    const managerId = await seedUser({
      email: "manager@example.com",
      role: "DEVELOPER",
      permissionManagement: { enabled: true, minTargetRank: 100, allowedPermissions: ["projects.edit"] },
    });
    const managerCookie = await authCookie({ id: managerId, email: "manager@example.com", role: "DEVELOPER" });
    const developerId = await seedUser({ email: "peer@example.com", role: "DEVELOPER" });
    const peer = await patchUser(
      requestWithCookie(
        `${ORIGIN}/api/users/${developerId}`,
        managerCookie,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Renamed" }) },
      ),
      { params: Promise.resolve({ id: developerId }) },
    );
    expect(peer.status).toBe(403);
    expect(await peer.json()).toEqual({ error: "rank_boundary" });

    const userId = await seedUser({ email: "target@example.com", role: "USER" });
    const allowed = await patchUser(
      requestWithCookie(
        `${ORIGIN}/api/users/${userId}`,
        managerCookie,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Renamed" }) },
      ),
      { params: Promise.resolve({ id: userId }) },
    );
    expect(allowed.status).toBe(200);
  });

  it("protects root admin, the last admin and self-management", async () => {
    const selfPatch = await patchUser(
      requestWithCookie(
        `${ORIGIN}/api/users/${ownerId}`,
        ownerCookie,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ disabled: true }) },
      ),
      { params: Promise.resolve({ id: ownerId }) },
    );
    expect(selfPatch.status).toBe(400);
    expect(await selfPatch.json()).toEqual({ error: "self_lockout" });

    const selfScope = await patchUser(
      requestWithCookie(
        `${ORIGIN}/api/users/${ownerId}`,
        ownerCookie,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ permissionManagement: { enabled: true, minTargetRank: 100, allowedPermissions: [] } }),
        },
      ),
      { params: Promise.resolve({ id: ownerId }) },
    );
    expect(selfScope.status).toBe(403);

    const otherAdminId = await seedUser({ email: "admin2@example.com", role: "ADMIN" });
    const removeAdmin = await patchUser(
      requestWithCookie(
        `${ORIGIN}/api/users/${otherAdminId}`,
        ownerCookie,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ disabled: true }) },
      ),
      { params: Promise.resolve({ id: otherAdminId }) },
    );
    expect(removeAdmin.status).toBe(200);
  });

  it("refuses to disable the last remaining admin", async () => {
    const response = await deleteUser(
      requestWithCookie(`${ORIGIN}/api/users/${ownerId}`, ownerCookie, { method: "DELETE" }),
      { params: Promise.resolve({ id: ownerId }) },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "self_delete" });
  });

  it("disables (never hard-deletes) another user and audits it", async () => {
    const userId = await seedUser({ email: "leaver@example.com", role: "USER" });
    const response = await deleteUser(
      requestWithCookie(`${ORIGIN}/api/users/${userId}`, ownerCookie, { method: "DELETE" }),
      { params: Promise.resolve({ id: userId }) },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).user.disabled).toBe(true);
    expect(await AuditEventModel.countDocuments({ action: "user.disabled" })).toBe(1);
  });

  it("404s an unknown or malformed id", async () => {
    const response = await patchUser(
      requestWithCookie(
        `${ORIGIN}/api/users/not-an-id`,
        ownerCookie,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) },
      ),
      { params: Promise.resolve({ id: "not-an-id" }) },
    );
    expect(response.status).toBe(404);
  });
});

describe("github enrichment", () => {
  it("400s when the project has no repository and 404s when unknown", async () => {
    await createProject(requestWithCookie(`${ORIGIN}/api/projects`, ownerCookie, json({ name: "NoRepo" })));
    const noRepo = await refreshGithub(
      requestWithCookie(`${ORIGIN}/api/projects/norepo/github`, ownerCookie, { method: "POST" }),
      { params: Promise.resolve({ slug: "norepo" }) },
    );
    expect(noRepo.status).toBe(400);
    const missing = await refreshGithub(
      requestWithCookie(`${ORIGIN}/api/projects/ghost/github`, ownerCookie, { method: "POST" }),
      { params: Promise.resolve({ slug: "ghost" }) },
    );
    expect(missing.status).toBe(404);
  });
});
