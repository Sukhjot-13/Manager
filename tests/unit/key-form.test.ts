import { describe, it, expect } from "vitest";
import { buildKeyCreateBody, keyCreateFailureMessage } from "@/lib/keyForm";

describe("key create form", () => {
  const base = { name: "server logs", kind: "server" as const, projectId: "", projectCount: 3 };

  it("always names a project on the cross-project screen", () => {
    const result = buildKeyCreateBody({ ...base, projectRequired: true, projectId: "abc" });
    expect(result).toEqual({
      ok: true,
      body: { name: "server logs", kind: "server", projectId: "abc" },
    });
  });

  it("refuses rather than sending a request the server can only reject with a bare 400", () => {
    // The regression: an empty project list used to mean "project not required", so the
    // form sent no projectId and the server answered 400 with no explanation.
    expect(buildKeyCreateBody({ ...base, projectRequired: true, projectId: "abc", projectCount: 0 })).toEqual(
      { ok: false, reason: "no_projects" },
    );
    expect(buildKeyCreateBody({ ...base, projectRequired: true, projectId: "   ", projectCount: 3 })).toEqual(
      { ok: false, reason: "no_project" },
    );
    expect(buildKeyCreateBody({ ...base, name: "  ", projectRequired: true, projectId: "abc" })).toEqual(
      { ok: false, reason: "no_name" },
    );
  });

  it("never sends a blank project id", () => {
    const result = buildKeyCreateBody({
      ...base,
      projectRequired: true,
      projectId: "  spaced  ",
      projectCount: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.projectId).toBe("spaced");
    }
  });

  it("omits the project on a project's own screen, where the URL already names it", () => {
    const result = buildKeyCreateBody({ ...base, projectRequired: false, projectCount: 0 });
    expect(result).toEqual({ ok: true, body: { name: "server logs", kind: "server" } });
    if (result.ok) {
      expect("projectId" in result.body).toBe(false);
    }
  });

  it("trims the name", () => {
    const result = buildKeyCreateBody({ ...base, name: "  api-worker  ", projectRequired: false });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.name).toBe("api-worker");
    }
  });

  it("has a distinct message for every failure", () => {
    const messages = (["no_name", "no_project", "no_projects"] as const).map(
      keyCreateFailureMessage,
    );
    expect(new Set(messages).size).toBe(3);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
    }
  });
});
