"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Copy,
  Download,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

const ENVIRONMENTS = ["dev", "staging", "prod"] as const;
type EnvironmentName = (typeof ENVIRONMENTS)[number];
type EnvironmentFilter = "all" | EnvironmentName;

const REVEAL_WINDOW_MS = 30_000;
const TICK_MS = 1_000;

type MaskedSecret = {
  id: string;
  environment: EnvironmentName;
  key: string;
  note: string;
  maskedValue: string;
  updatedAt: string | null;
};

type AuditRow = {
  id: string;
  action: string;
  actor: string;
  keyName: string;
  environment: string;
  ip: string;
  ts: string | null;
};

type RevealEntry = { value: string; expiresAt: number };

const ACTION_TONE: Record<string, "neutral" | "green" | "amber" | "red" | "blue" | "violet"> = {
  reveal: "amber",
  copy: "blue",
  export: "red",
  import: "green",
  update: "neutral",
  delete: "red",
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

export function SecretsPanel({
  projectSlug,
  initialSecrets,
  initialAudit,
}: {
  projectSlug: string;
  initialSecrets: MaskedSecret[];
  initialAudit: AuditRow[];
}) {
  const { push } = useToast();
  const [secrets, setSecrets] = useState<MaskedSecret[]>(initialSecrets);
  const [audit, setAudit] = useState<AuditRow[]>(initialAudit);
  const [environment, setEnvironment] = useState<EnvironmentFilter>("all");
  const [revealed, setRevealed] = useState<Record<string, RevealEntry>>({});
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addKey, setAddKey] = useState("");
  const [addValue, setAddValue] = useState("");
  const [addNote, setAddNote] = useState("");
  const [addEnvironment, setAddEnvironment] = useState<EnvironmentName>("dev");
  const [editing, setEditing] = useState<MaskedSecret | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editNote, setEditNote] = useState("");
  const [deleting, setDeleting] = useState<MaskedSecret | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importEnvironment, setImportEnvironment] = useState<EnvironmentName>("dev");
  const [importContent, setImportContent] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportEnvironment, setExportEnvironment] = useState<EnvironmentName>("dev");
  const [exportConfirm, setExportConfirm] = useState("");
  const [exportPassword, setExportPassword] = useState("");
  const revealedRef = useRef<Record<string, RevealEntry>>({});

  const base = `/api/projects/${projectSlug}/secrets`;

  const loadSecrets = useCallback(
    async (filter: EnvironmentFilter): Promise<void> => {
      setLoading(true);
      try {
        const query = filter === "all" ? "" : `?environment=${filter}`;
        const response = await fetch(`${base}${query}`, { cache: "no-store" });
        const payload: unknown = await response.json();
        if (!response.ok) {
          push(errorMessage(payload, "could not load secrets"), "error");
          return;
        }
        setSecrets((payload as { secrets: MaskedSecret[] }).secrets);
      } catch {
        push("could not load secrets", "error");
      } finally {
        setLoading(false);
      }
    },
    [base, push],
  );

  const loadAudit = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`${base}/audit?limit=25`, {
        cache: "no-store",
      });
      const payload: unknown = await response.json();
      if (response.ok) {
        setAudit((payload as { audit: AuditRow[] }).audit);
      }
    } catch {
      push("could not load audit trail", "error");
    }
  }, [base, push]);

  const refresh = useCallback(
    async (filter: EnvironmentFilter): Promise<void> => {
      await loadSecrets(filter);
      await loadAudit();
    },
    [loadAudit, loadSecrets],
  );

  useEffect(() => {
    revealedRef.current = revealed;
  }, [revealed]);

  useEffect(() => {
    const timer = setInterval(() => {
      setRevealed((current) => {
        const now = Date.now();
        const next: Record<string, RevealEntry> = {};
        let changed = false;
        for (const [id, entry] of Object.entries(current)) {
          if (entry.expiresAt <= now) {
            changed = true;
          } else {
            next[id] = entry;
          }
        }
        return changed ? next : current;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      revealedRef.current = {};
      setRevealed({});
    },
    [],
  );

  const maskAll = useCallback(() => {
    setRevealed({});
  }, []);

  const reveal = useCallback(
    async (secret: MaskedSecret): Promise<void> => {
      setBusyId(secret.id);
      try {
        const response = await fetch(`/api/secrets/${secret.id}/reveal`, {
          method: "POST",
          cache: "no-store",
        });
        const payload: unknown = await response.json();
        if (!response.ok) {
          push(errorMessage(payload, "reveal failed"), "error");
          return;
        }
        const value = (payload as { value: string }).value;
        setRevealed((current) => ({
          ...current,
          [secret.id]: { value, expiresAt: Date.now() + REVEAL_WINDOW_MS },
        }));
      } catch {
        push("reveal failed", "error");
      } finally {
        setBusyId(null);
      }
    },
    [push],
  );

  const copyValue = useCallback(
    async (secret: MaskedSecret): Promise<void> => {
      const entry = revealed[secret.id];
      if (entry === undefined) {
        push("reveal the value before copying", "error");
        return;
      }
      try {
        await navigator.clipboard.writeText(entry.value);
        push(`${secret.key} copied to clipboard`, "success");
      } catch {
        push("clipboard write failed", "error");
      }
    },
    [push, revealed],
  );

  const createSecret = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          environment: addEnvironment,
          key: addKey,
          value: addValue,
          note: addNote,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        push(errorMessage(payload, "could not save secret"), "error");
        return;
      }
      push(`${addKey} saved`, "success");
      setAddOpen(false);
      setAddKey("");
      setAddValue("");
      setAddNote("");
      await refresh(environment);
    } catch {
      push("could not save secret", "error");
    }
  }, [addEnvironment, addKey, addNote, addValue, base, environment, push, refresh]);

  const saveEdit = useCallback(async (): Promise<void> => {
    if (editing === null) {
      return;
    }
    try {
      const response = await fetch(`/api/secrets/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: editValue, note: editNote }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        push(errorMessage(payload, "could not update secret"), "error");
        return;
      }
      push(`${editing.key} updated`, "success");
      setEditing(null);
      setEditValue("");
      setEditNote("");
      await refresh(environment);
    } catch {
      push("could not update secret", "error");
    }
  }, [editNote, editValue, editing, environment, push, refresh]);

  const confirmDelete = useCallback(async (): Promise<void> => {
    if (deleting === null) {
      return;
    }
    try {
      const response = await fetch(`/api/secrets/${deleting.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        push("could not delete secret", "error");
        return;
      }
      setRevealed((current) => {
        const next = { ...current };
        delete next[deleting.id];
        return next;
      });
      push(`${deleting.key} deleted`, "success");
      setDeleting(null);
      await refresh(environment);
    } catch {
      push("could not delete secret", "error");
    }
  }, [deleting, environment, push, refresh]);

  const runImport = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "import",
          environment: importEnvironment,
          content: importContent,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        push(errorMessage(payload, "import failed"), "error");
        return;
      }
      const result = payload as {
        imported: number;
        skipped: number;
        errors: string[];
      };
      push(
        `imported ${result.imported}, skipped ${result.skipped}${
          result.errors.length > 0 ? `, ${result.errors.length} problem lines` : ""
        }`,
        result.errors.length > 0 ? "error" : "success",
      );
      setImportOpen(false);
      setImportContent("");
      await refresh(environment);
    } catch {
      push("import failed", "error");
    }
  }, [base, environment, importContent, importEnvironment, push, refresh]);

  const runExport = useCallback(async (): Promise<void> => {
    if (exportConfirm !== "EXPORT") {
      push("type EXPORT to confirm", "error");
      return;
    }
    try {
      const response = await fetch(`${base}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          environment: exportEnvironment,
          confirm: exportConfirm,
          password: exportPassword,
        }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        push(errorMessage(payload, "export failed"), "error");
        return;
      }
      const text = await response.text();
      const blob = new Blob([text], { type: "text/plain" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `${projectSlug}-${exportEnvironment}.env`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
      setExportOpen(false);
      setExportConfirm("");
      setExportPassword("");
      push("export downloaded and audited", "success");
      await loadAudit();
    } catch {
      push("export failed", "error");
    }
  }, [
    base,
    exportConfirm,
    exportEnvironment,
    exportPassword,
    loadAudit,
    projectSlug,
    push,
  ]);

  const groups = ENVIRONMENTS.map((name) => ({
    name,
    rows: secrets.filter(
      (secret) =>
        secret.environment === name &&
        (environment === "all" || environment === name),
    ),
  })).filter((group) => group.rows.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Environment"
          className="w-40"
          value={environment}
          onChange={(event) => {
            const next = event.target.value as EnvironmentFilter;
            setEnvironment(next);
            maskAll();
            void loadSecrets(next);
          }}
        >
          <option value="all">all environments</option>
          {ENVIRONMENTS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refresh(environment)}
          disabled={loading}
        >
          <RefreshCw size={14} />
          Refresh
        </Button>
        <span className="text-xs text-zinc-500">
          Revealed values re-mask after {REVEAL_WINDOW_MS / 1000}s and are
          never stored in the browser.
        </span>
        <div className="ml-auto flex items-center gap-2">
          <PermissionGate permission="secrets.edit">
            <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
              <Plus size={14} />
              Add
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setImportEnvironment(
                  environment === "all" ? "dev" : environment,
                );
                setImportOpen(true);
              }}
            >
              <Upload size={14} />
              Import .env
            </Button>
          </PermissionGate>
          <PermissionGate permission="secrets.export">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setExportEnvironment(
                  environment === "all" ? "dev" : environment,
                );
                setExportOpen(true);
              }}
            >
              <Download size={14} />
              Export .env
            </Button>
          </PermissionGate>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Keys</CardTitle>
          <span className="text-xs text-zinc-500">{secrets.length} total</span>
        </CardHeader>
        <CardContent className="space-y-5">
          {groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">
              No secrets yet. Add one or import a .env file.
            </p>
          ) : null}
          {groups.map((group) => (
            <div key={group.name} className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge tone={group.name === "prod" ? "red" : "blue"}>
                  {group.name}
                </Badge>
                <span className="text-xs text-zinc-500">
                  {group.rows.length} keys
                </span>
              </div>
              <Table>
                <THead>
                  <TR>
                    <TH>Key</TH>
                    <TH>Value</TH>
                    <TH>Note</TH>
                    <TH>Updated</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {group.rows.map((secret) => {
                    const entry = revealed[secret.id];
                    return (
                      <TR key={secret.id}>
                        <TD className="font-mono text-xs">{secret.key}</TD>
                        <TD className="font-mono text-xs">
                          {entry === undefined ? (
                            secret.maskedValue
                          ) : (
                            <span className="break-all text-amber-700 dark:text-amber-300">
                              {entry.value}
                            </span>
                          )}
                        </TD>
                        <TD className="text-xs text-zinc-500">{secret.note}</TD>
                        <TD className="text-xs text-zinc-500">
                          {secret.updatedAt === null
                            ? "—"
                            : new Date(secret.updatedAt).toLocaleString()}
                        </TD>
                        <TD>
                          <div className="flex items-center justify-end gap-1">
                            <PermissionGate permission="secrets.reveal">
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={
                                  entry === undefined
                                    ? `Reveal ${secret.key}`
                                    : `Re-mask ${secret.key}`
                                }
                                disabled={busyId === secret.id}
                                onClick={() => {
                                  if (entry === undefined) {
                                    void reveal(secret);
                                  } else {
                                    setRevealed((current) => {
                                      const next = { ...current };
                                      delete next[secret.id];
                                      return next;
                                    });
                                  }
                                }}
                              >
                                {entry === undefined ? (
                                  <Eye size={14} />
                                ) : (
                                  <EyeOff size={14} />
                                )}
                              </Button>
                            </PermissionGate>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Copy ${secret.key}`}
                              disabled={entry === undefined}
                              onClick={() => void copyValue(secret)}
                            >
                              <Copy size={14} />
                            </Button>
                            <PermissionGate permission="secrets.edit">
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Edit ${secret.key}`}
                                onClick={() => {
                                  setEditing(secret);
                                  setEditValue("");
                                  setEditNote(secret.note);
                                }}
                              >
                                <Pencil size={14} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Delete ${secret.key}`}
                                onClick={() => setDeleting(secret)}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </PermissionGate>
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <span className="text-xs text-zinc-500">reveal · copy · export</span>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="py-4 text-center text-sm text-zinc-500">
              No vault activity yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {audit.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-2 text-xs"
                >
                  <Badge tone={ACTION_TONE[row.action] ?? "neutral"}>
                    {row.action}
                  </Badge>
                  <span className="font-mono text-zinc-700 dark:text-zinc-200">
                    {row.keyName === "" ? "—" : row.keyName}
                  </span>
                  {row.environment === "" ? null : (
                    <span className="text-zinc-500">{row.environment}</span>
                  )}
                  <span className="text-zinc-500">{row.actor}</span>
                  {row.ip === "" ? null : (
                    <span className="text-zinc-400">{row.ip}</span>
                  )}
                  <span className="ml-auto text-zinc-400">
                    {row.ts === null
                      ? "—"
                      : new Date(row.ts).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={addOpen}
        title="Add secret"
        description="The value is encrypted with a fresh IV before it is stored."
        onClose={() => setAddOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void createSecret()}>Save</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Environment" htmlFor="add-environment">
            <Select
              id="add-environment"
              value={addEnvironment}
              onChange={(event) =>
                setAddEnvironment(event.target.value as EnvironmentName)
              }
            >
              {ENVIRONMENTS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Key" htmlFor="add-key">
            <Input
              id="add-key"
              value={addKey}
              onChange={(event) => setAddKey(event.target.value)}
              placeholder="STRIPE_SECRET_KEY"
            />
          </Field>
          <Field label="Value" htmlFor="add-value">
            <Textarea
              id="add-value"
              value={addValue}
              onChange={(event) => setAddValue(event.target.value)}
            />
          </Field>
          <Field label="Note" htmlFor="add-note">
            <Input
              id="add-note"
              value={addNote}
              onChange={(event) => setAddNote(event.target.value)}
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={editing !== null}
        title={`Edit ${editing?.key ?? ""}`}
        description="Leave the value empty to keep the stored one."
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveEdit()}>Save</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Value" htmlFor="edit-value">
            <Textarea
              id="edit-value"
              value={editValue}
              placeholder="unchanged"
              onChange={(event) => setEditValue(event.target.value)}
            />
          </Field>
          <Field label="Note" htmlFor="edit-note">
            <Input
              id="edit-note"
              value={editNote}
              onChange={(event) => setEditNote(event.target.value)}
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={deleting !== null}
        title={`Delete ${deleting?.key ?? ""}?`}
        description="The stored value is removed permanently."
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          This deletes the encrypted row for {deleting?.environment}/
          {deleting?.key}.
        </p>
      </Dialog>

      <Dialog
        open={importOpen}
        title="Import .env"
        description="Paste KEY=value lines. Existing keys are overwritten."
        onClose={() => setImportOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void runImport()}>Import</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Environment" htmlFor="import-environment">
            <Select
              id="import-environment"
              value={importEnvironment}
              onChange={(event) =>
                setImportEnvironment(event.target.value as EnvironmentName)
              }
            >
              {ENVIRONMENTS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Contents" htmlFor="import-content">
            <Textarea
              id="import-content"
              className="min-h-48 font-mono text-xs"
              value={importContent}
              onChange={(event) => setImportContent(event.target.value)}
              placeholder={"DATABASE_URL=postgres://\nexport SECRET=abc\n# comment"}
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={exportOpen}
        title="Export .env"
        description="Mass-exfiltration brake: confirm the phrase and re-enter your password."
        onClose={() => setExportOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void runExport()}>
              Export
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Environment" htmlFor="export-environment">
            <Select
              id="export-environment"
              value={exportEnvironment}
              onChange={(event) =>
                setExportEnvironment(event.target.value as EnvironmentName)
              }
            >
              {ENVIRONMENTS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type EXPORT to confirm" htmlFor="export-confirm">
            <Input
              id="export-confirm"
              value={exportConfirm}
              onChange={(event) => setExportConfirm(event.target.value)}
              placeholder="EXPORT"
            />
          </Field>
          <Field label="Password" htmlFor="export-password">
            <Input
              id="export-password"
              type="password"
              autoComplete="current-password"
              value={exportPassword}
              onChange={(event) => setExportPassword(event.target.value)}
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
