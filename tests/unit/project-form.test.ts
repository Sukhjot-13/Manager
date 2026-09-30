import { describe, expect, it } from "vitest";
import { projectFailureMessages, projectValidationFailure } from "@/lib/projectForm";

describe("project failure feedback", () => {
  it("serializes only validation paths and messages", () => {
    const issue = { path: ["links", 0, "url"], message: "Enter a complete URL.", input: "private-value", code: "invalid_format" };
    expect(projectValidationFailure([issue])).toEqual({
      error: "invalid_request", issues: 1,
      fieldErrors: [{ field: "links.0.url", message: "Enter a complete URL." }],
    });
    expect(projectValidationFailure([{ path: [], message: "Expected an object." }]).fieldErrors[0].field).toBe("request");
  });

  it("labels all invalid fields and preserves visible link rows after blank drafts are omitted", () => {
    expect(projectFailureMessages(400, { fieldErrors: [
      { field: "name", message: "Enter a project name." },
      { field: "links.0.url", message: "Enter a complete URL." },
      { field: "tags.2", message: "Use 30 characters or fewer." },
    ] }, [1])).toEqual([
      "Name: Enter a project name.", "Link 2 URL: Enter a complete URL.",
      "Tag 3: Use 30 characters or fewer.",
    ]);
  });

  it.each([null, "bad response", {}, { fieldErrors: [null, {}, { field: "name", message: 3 }] }])(
    "handles malformed validation responses safely: %j", (body) => {
      expect(projectFailureMessages(400, body)).toEqual(["The form could not be validated. Review the fields and try again."]);
    },
  );

  it("distinguishes malformed JSON, authentication, permissions, missing projects and slug conflicts", () => {
    expect(projectFailureMessages(400, { error: "invalid_json" })[0]).toContain("JSON");
    expect(projectFailureMessages(401, {})[0]).toContain("Sign in again");
    expect(projectFailureMessages(403, {})[0]).toContain("permission");
    expect(projectFailureMessages(404, {})[0]).toContain("no longer exists");
    expect(projectFailureMessages(409, { error: "slug_in_use" })).toEqual(["Slug: already in use. Choose a different slug."]);
  });

  it("does not mislabel or disclose unexpected server errors", () => {
    expect(projectFailureMessages(500, { error: "internal_error", message: "mongodb://private", fieldErrors: [{ field: "slug", message: "private" }] }))
      .toEqual(["The server could not save this project. Try again shortly."]);
  });
});
