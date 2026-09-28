"use client";

import { useCallback, useState } from "react";
import { Copy, KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

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

export function KeysPanel({
  initialKeys,
  showProjectColumn = false,
  basePath,
}: {
  initialKeys: KeyRow[];
  showProjectColumn?: boolean;
  basePath: string;
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

  const create = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind }),
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
  }, [basePath, kind, load, name, push]);

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
  const projects = [...new Set(keys.map((row) => row.projectSlug))].filter(
    (slug) => slug !== "",
  );
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
              {projects.map((slug) => (
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
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={14} />
            New key
          </Button>
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
