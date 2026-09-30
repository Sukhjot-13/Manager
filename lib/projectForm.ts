export type ProjectFieldError = { field: string; message: string };

/** Only send validation paths and reasons; never serialize submitted values. */
export function projectValidationFailure(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): { error: string; issues: number; fieldErrors: ProjectFieldError[] } {
  return {
    error: "invalid_request",
    issues: issues.length,
    fieldErrors: issues.map((issue) => ({
      field: issue.path.map(String).join(".") || "request",
      message: issue.message,
    })),
  };
}

function projectFieldLabel(field: string, linkRows: readonly number[]): string {
  const labels: Record<string, string> = {
    name: "Name", slug: "Slug", description: "Description", status: "Status",
    tags: "Tags", color: "Color", emoji: "Emoji", links: "Links", notesMd: "Notes",
    githubRepo: "GitHub repository", request: "Form",
    ingestEnabled: "Log ingestion", analyticsEnabled: "Analytics",
  };
  const link = /^links\.(\d+)\.(url|label|type)$/.exec(field);
  if (link) {
    const index = Number(link[1]);
    const label = { url: "URL", label: "label", type: "type" }[link[2]];
    return `Link ${(linkRows[index] ?? index) + 1} ${label}`;
  }
  const tag = /^tags\.(\d+)$/.exec(field);
  if (tag) return `Tag ${Number(tag[1]) + 1}`;
  return labels[field] ?? "Form";
}

/** Translate known API failures while keeping unexpected server details private. */
export function projectFailureMessages(
  status: number, body: unknown, linkRows: readonly number[] = [],
): string[] {
  const data = typeof body === "object" && body !== null
    ? body as Record<string, unknown> : {};
  if (status === 400 && Array.isArray(data.fieldErrors)) {
    const messages = data.fieldErrors.flatMap((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return [];
      const issue = entry as Record<string, unknown>;
      return typeof issue.field === "string" && typeof issue.message === "string"
        ? [`${projectFieldLabel(issue.field, linkRows)}: ${issue.message}`] : [];
    });
    if (messages.length) return [...new Set(messages)];
  }
  if (status === 401) return ["Your session has expired. Sign in again before saving."];
  if (status === 403) return ["You do not have permission to save this project."];
  if (status === 404) return ["This project no longer exists. Refresh the projects page."];
  if (status === 409 && data.error === "slug_in_use") {
    return ["Slug: already in use. Choose a different slug."];
  }
  if (status === 400 && data.error === "invalid_json") {
    return ["The request could not be read as JSON. Try saving again."];
  }
  if (status === 400) return ["The form could not be validated. Review the fields and try again."];
  return ["The server could not save this project. Try again shortly."];
}
