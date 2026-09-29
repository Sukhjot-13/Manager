import type { KeyKind } from "@/lib/db/apikeys";
export type { KeyKind } from "@/lib/db/apikeys";

export type KeyCreateFailure = "no_projects" | "no_project" | "no_name";

export type KeyCreateResult =
  | { ok: true; body: { name: string; kind: KeyKind; projectId?: string } }
  | { ok: false; reason: KeyCreateFailure };

/**
 * Decides what the create-key form may send, and refuses impossible requests up front.
 *
 * `POST /api/keys` has no slug in its path, so the project must be named in the body. That
 * makes "which project?" the form's first real question, and getting it wrong is not a
 * cosmetic problem: the server rejects a missing projectId with a bare 400 that says
 * nothing about the cause.
 *
 * This lives outside the component so it can be tested without a DOM. An earlier version
 * treated an empty project list as "no project required", which sent exactly that bare 400
 * to anyone opening the keys screen before creating their first project.
 */
export function buildKeyCreateBody(input: {
  name: string;
  kind: KeyKind;
  /** True on the cross-project screen; false when the URL already identifies the project. */
  projectRequired: boolean;
  projectId: string;
  projectCount: number;
}): KeyCreateResult {
  if (input.name.trim() === "") {
    return { ok: false, reason: "no_name" };
  }
  if (!input.projectRequired) {
    return { ok: true, body: { name: input.name.trim(), kind: input.kind } };
  }
  if (input.projectCount === 0) {
    return { ok: false, reason: "no_projects" };
  }
  const projectId = input.projectId.trim();
  if (projectId === "") {
    return { ok: false, reason: "no_project" };
  }
  return { ok: true, body: { name: input.name.trim(), kind: input.kind, projectId } };
}

const FAILURE_MESSAGE: Record<KeyCreateFailure, string> = {
  no_name: "name this key",
  no_projects: "create a project first — a key is always issued for one",
  no_project: "choose a project for this key",
};

export function keyCreateFailureMessage(reason: KeyCreateFailure): string {
  return FAILURE_MESSAGE[reason];
}
