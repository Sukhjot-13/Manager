"use client";

import { useCallback, useState } from "react";
import { NavigationLink as Link } from "@/components/ui/navigation-link";
import { Copy, KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { buildKeyCreateBody, keyCreateFailureMessage } from "@/lib/keyForm";

const KEY_KINDS = ["server", "client", "analytics"] as const;
type KeyKind = (typeof KEY_KINDS)[number];

const KIND_TONE: Record<KeyKind, "blue" | "violet" | "amber"> = {
  server: "blue",
  client: "violet",
  analytics: "amber",
};

const KIND_HINT: Record<KeyKind, string> = {
  server: "server-side code — writes source=server rows only",
  client: "browser code — writes source=client rows only",
  analytics: "page tracker — events only, never logs",
};

export type KeyRow = {
  id: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  name: string;
  kind: KeyKind;
  prefix: string;
  masked: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

function errorMessage(payload: unknown, fallback: string): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as { error: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return fallback;
}

function stamp(value: string | null): string {
  return value === null ? "—" : new Date(value).toLocaleString();
}

export type ProjectOption = { id: string; name: string; slug: string };

export function KeysPanel({
  initialKeys,
  showProjectColumn = false,
  basePath,
  projects = [],
}: {
  initialKeys: KeyRow[];
  showProjectColumn?: boolean;
  basePath: string;
  /**
   * The real project list, passed by the caller. It cannot be derived from the loaded
   * keys: a project with no keys yet would be unselectable, which is exactly the project
   * you most need to create the first key for.
   */
  projects?: ProjectOption[];
}) {
  const { push } = useToast();
  const [keys, setKeys] = useState<KeyRow[]>(initialKeys);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<KeyKind>("server");
  const [issued, setIssued] = useState<(KeyRow & { fullKey: string }) | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState<KeyRow | null>(null);
  const [deleting, setDeleting] = useState<KeyRow | null>(null);
  const [projectFilter, setProjectFilter] = useState("all");
  const [newProjectId, setNewProjectId] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | KeyKind>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "revoked">("all");

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await fetch(`${basePath}?all=1`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok) {
        push(errorMessage(payload, "could not load keys"), "error");
        return;
      }
      setKeys((payload as { keys: KeyRow[] }).keys);
    } catch {
      push("could not load keys", "error");
    } finally {
      setLoading(false);
    }
  }, [basePath, push]);

  // On the cross-project screen the route has no slug, so the project has to be named in
  // the body. On a project's own screen the slug already identifies it.
  //
  // This is deliberately true even when `projects` is empty. Treating "no projects" as
  // "project not required" silently sent a request with no projectId and surfaced a bare
  // 400 from the server; the honest state is "there is nothing to issue a key for yet".
  const projectRequired = showProjectColumn;
  // A key always belongs to a project, so with none there is nothing to issue. Say so with
  // a link rather than a disabled control: a disabled button only explains itself through a
  // title tooltip, which no touch device ever shows, so on a phone it is just dead.
  const noProjectsYet = showProjectColumn && projects.length === 0;

  const create = useCallback(async (): Promise<void> => {
    const built = buildKeyCreateBody({
      name,
      kind,
      projectRequired,
      projectId: newProjectId,
      projectCount: projects.length,
    });
    if (!built.ok) {
      push(keyCreateFailureMessage(built.reason), "error");
      return;
    }
    try {
      const response = await fetch(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(built.body),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        push(errorMessage(payload, "could not create key"), "error");
        return;
      }
      const created = (payload as { key: KeyRow & { key: string } }).key;
      setIssued({ ...created, fullKey: created.key });
      setCreateOpen(false);
      setName("");
      await load();
    } catch {
      push("could not create key", "error");
    }
  }, [basePath, kind, load, name, newProjectId, projectRequired, projects.length, push]);

  const revoke = useCallback(async (): Promise<void> => {
    if (revoking === null) {
      return;
    }
    setBusyId(revoking.id);
    try {
      const response = await fetch(`/api/keys/${revoking.id}`, { method: "PATCH" });
      const payload: unknown = await response.json();
      if (!response.ok) {
        push(errorMessage(payload, "could not revoke key"), "error");
        return;
      }
      setKeys((current) =>
        current.map((row) =>
          row.id === revoking.id
            ? { ...row, revokedAt: (payload as { key: KeyRow }).key.revokedAt }
            : row,
        ),
      );
      push(`${revoking.name} revoked`, "success");
      setRevoking(null);
    } catch {
      push("could not revoke key", "error");
    } finally {
      setBusyId(null);
    }
  }, [push, revoking]);

  const remove = useCallback(async (): Promise<void> => {
    if (deleting === null) {
      return;
    }
    setBusyId(deleting.id);
    try {
      const response = await fetch(`/api/keys/${deleting.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        push(errorMessage(payload, "could not delete key"), "error");
        return;
      }
      setKeys((current) => current.filter((row) => row.id !== deleting.id));
      push(`${deleting.name} deleted`, "success");
      setDeleting(null);
    } catch {
      push("could not delete key", "error");
    } finally {
      setBusyId(null);
    }
  }, [deleting, push]);

  const copy = useCallback(
    async (value: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(value);
        push("key copied to clipboard", "success");
      } catch {
        push("clipboard write failed", "error");
      }
    },
    [push],
  );

  const active = keys.filter((row) => row.revokedAt === null);
  const revoked = keys.filter((row) => row.revokedAt !== null);
  const filterSlugs = [
    ...new Set([...keys.map((row) => row.projectSlug), ...projects.map((p) => p.slug)]),
  ].filter((slug) => slug !== "");
  const visible = keys.filter((row) => {
    if (projectFilter !== "all" && row.projectSlug !== projectFilter) {
      return false;
    }
    if (kindFilter !== "all" && row.kind !== kindFilter) {
      return false;
    }
    if (statusFilter === "active" && row.revokedAt !== null) {
      return false;
    }
    if (statusFilter === "revoked" && row.revokedAt === null) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {showProjectColumn ? (
          <>
            <Select
              aria-label="Project"
              className="h-8 w-44 text-xs"
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
            >
              <option value="all">all projects</option>
              {filterSlugs.map((slug) => (
                <option key={slug} value={slug}>
                  {slug}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Kind"
              className="h-8 w-32 text-xs"
              value={kindFilter}
              onChange={(event) =>
                setKindFilter(event.target.value as "all" | KeyKind)
              }
            >
              <option value="all">all kinds</option>
              {KEY_KINDS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Status"
              className="h-8 w-32 text-xs"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value as "all" | "active" | "revoked",
                )
              }
            >
              <option value="all">all statuses</option>
              <option value="active">active</option>
              <option value="revoked">revoked</option>
            </Select>
          </>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} />
          Refresh
        </Button>
        <span className="text-xs text-zinc-500">
          {active.length} active · {revoked.length} revoked · keys are stored hashed and
          shown in full exactly once.
        </span>
        <PermissionGate permission="keys.manage">
          {noProjectsYet ? (
            <Link
              href="/projects"
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-300 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <Plus size={14} />
              Create a project to issue keys
            </Link>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={14} />
              New key
            </Button>
          )}
        </PermissionGate>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <span className="text-xs text-zinc-500">key · kind · last used</span>
        </CardHeader>
        <CardContent>
          {visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">
              {keys.length === 0
                ? "No keys yet. Create one to start shipping logs."
                : "No keys match these filters."}
            </p>
          ) : (
            <Table>
              <THead>
                <TR>
                  {showProjectColumn ? <TH>Project</TH> : null}
                  <TH>Name</TH>
                  <TH>Prefix</TH>
                  <TH>Kind</TH>
                  <TH>Created</TH>
                  <TH>Last used</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((row) => (
                  <TR key={row.id} className={row.revokedAt === null ? undefined : "opacity-60"}>
                    {showProjectColumn ? (
                      <TD className="text-xs">{row.projectName || row.projectSlug}</TD>
                    ) : null}
                    <TD className="text-sm">{row.name}</TD>
                    <TD className="font-mono text-xs">{row.masked}</TD>
                    <TD>
                      <Badge tone={KIND_TONE[row.kind]}>{row.kind}</Badge>
                    </TD>
                    <TD className="text-xs text-zinc-500">{stamp(row.createdAt)}</TD>
                    <TD className="text-xs text-zinc-500">{stamp(row.lastUsedAt)}</TD>
                    <TD>
                      <Badge tone={row.revokedAt === null ? "green" : "neutral"}>
                        {row.revokedAt === null ? "active" : "revoked"}
                      </Badge>
                    </TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Copy ${row.name} prefix`}
                          onClick={() => void copy(row.masked)}
                        >
                          <Copy size={14} />
                        </Button>
                        <PermissionGate permission="keys.manage">
                          {row.revokedAt === null ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Revoke ${row.name}`}
                              disabled={busyId === row.id}
                              onClick={() => setRevoking(row)}
                            >
                              <KeyRound size={14} />
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${row.name}`}
                            disabled={busyId === row.id}
                            onClick={() => setDeleting(row)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </PermissionGate>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={createOpen}
        title="Create API key"
        description="The full key is returned once and never again."
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void create()}>Create</Button>
          </>
        }
      >
        <div className="space-y-3">
          {projectRequired ? (
            <Field
              label="Project"
              htmlFor="key-project"
              hint="This key can only write logs for the project it is issued for."
            >
              {projects.length === 0 ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  There are no projects yet. Create one first — every key is issued for a
                  specific project, so a key cannot exist on its own.
                </p>
              ) : (
                <Select
                  id="key-project"
                  value={newProjectId}
                  onChange={(event) => setNewProjectId(event.target.value)}
                >
                  <option value="">choose a project</option>
                  {projects.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name || option.slug}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label="Name" htmlFor="key-name" hint="Where this key is used, e.g. api-worker">
            <Input
              id="key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="api-worker"
            />
          </Field>
          <Field label="Kind" htmlFor="key-kind" hint={KIND_HINT[kind]}>
            <Select
              id="key-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as KeyKind)}
            >
              {KEY_KINDS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={issued !== null}
        title="Copy your key now"
        description="It is hashed on the server — this is the only time the full value is shown."
        onClose={() => setIssued(null)}
        footer={
          <Button onClick={() => setIssued(null)}>Done</Button>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">
            {issued?.name} · {issued?.kind}
          </p>
          <code className="block break-all rounded-md border border-amber-300 bg-amber-50 p-3 font-mono text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {issued?.fullKey ?? ""}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void copy(issued?.fullKey ?? "");
            }}
          >
            <Copy size={14} />
            Copy key
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={revoking !== null}
        title={`Revoke ${revoking?.name ?? ""}?`}
        description="Future writes with this key are rejected immediately."
        onClose={() => setRevoking(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void revoke()}>
              Revoke
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          The stored rows stay in the viewer. Only new ingest is blocked.
        </p>
      </Dialog>

      <Dialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? ""}?`}
        description="The key row is removed permanently."
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Rows already ingested under this key are kept and stay attributed to{" "}
          {deleting?.prefix}.
        </p>
      </Dialog>
    </div>
  );
}
