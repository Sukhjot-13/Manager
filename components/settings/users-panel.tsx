"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ShieldCheck, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { PermissionGate } from "@/components/permission-gate";
import {
  PERMISSION_META,
  ROLES,
  isSystemProtected,
  type PermissionKey,
  type RoleKey,
} from "@/lib/permissions";
import type { UserSummary } from "@/lib/users";

const PERMISSION_KEYS = Object.keys(PERMISSION_META) as PermissionKey[];

export function UsersPanel({
  users,
  isRootAdmin,
}: {
  users: UserSummary[];
  isRootAdmin: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RoleKey>("USER");
  const [delegated, setDelegated] = useState(false);
  const [minTargetRank, setMinTargetRank] = useState(100);
  const [allowed, setAllowed] = useState<PermissionKey[]>([]);
  const [overrides, setOverrides] = useState<Record<string, "allow" | "deny">>({});
  const [error, setError] = useState("");

  function reset() {
    setEmail("");
    setName("");
    setPassword("");
    setRole("USER");
    setDelegated(false);
    setMinTargetRank(100);
    setAllowed([]);
    setOverrides({});
    setError("");
  }

  function startEdit(user: UserSummary) {
    setEditing(user);
    setEmail(user.email);
    setName(user.name);
    setPassword("");
    setRole(user.role);
    setDelegated(user.permissionManagement?.enabled === true);
    setMinTargetRank(user.permissionManagement?.minTargetRank ?? 100);
    setAllowed(user.permissionManagement?.allowedPermissions ?? []);
    setOverrides(
      Object.fromEntries(
        user.overrides.map((override) => [override.permission, override.effect]),
      ),
    );
    setError("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const body =
      editing === null
        ? {
            email: email.trim(),
            name: name.trim(),
            password,
            role,
            overrides,
            ...(delegated
              ? {
                  permissionManagement: {
                    enabled: true,
                    minTargetRank,
                    allowedPermissions: allowed,
                  },
                }
              : {}),
          }
        : {
            name: name.trim(),
            ...(password === "" ? {} : { password }),
            disabled: editing.disabled ? false : undefined,
            overrides,
            ...(delegated
              ? {
                  permissionManagement: {
                    enabled: true,
                    minTargetRank,
                    allowedPermissions: allowed,
                  },
                }
              : { permissionManagement: { enabled: false, minTargetRank: 100, allowedPermissions: [] } }),
          };
    const response = await fetch(
      editing === null ? "/api/users" : `/api/users/${editing.id}`,
      {
        method: editing === null ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    setPending(false);
    if (response.ok) {
      setOpen(false);
      setEditing(null);
      reset();
      push(editing === null ? "User created" : "User updated", "success");
      router.refresh();
      return;
    }
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setError(
      payload.error === "delegate_root_only"
        ? "Only the root admin can grant permission-management authority"
        : payload.error === "self_management"
          ? "You cannot change your own management scope"
          : payload.error === "rank_boundary" || payload.error === "protected_target"
            ? "That target is above your management scope"
            : payload.error === "last_admin"
              ? "You cannot disable the last admin"
              : "Could not save the user",
    );
  }

  async function toggleDisabled(user: UserSummary) {
    setPending(true);
    const response = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ disabled: !user.disabled }),
    });
    setPending(false);
    if (response.ok) {
      push(user.disabled ? "User re-enabled" : "User disabled", "success");
      router.refresh();
      return;
    }
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    push(
      payload.error === "last_admin"
        ? "You cannot disable the last admin"
        : payload.error === "self_lockout"
          ? "You cannot disable yourself"
          : "Could not update the user",
      "error",
    );
  }

  const delegable = PERMISSION_KEYS.filter(
    (permission) => !isSystemProtected(permission),
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          Root admin (rank 0) always has every permission. Delegated managers can only grant
          the permissions in their own ceiling, and only to roles at or below their rank.
        </p>
        <PermissionGate permission="users.manage">
          <Button
            onClick={() => {
              reset();
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus size={14} />
            New user
          </Button>
        </PermissionGate>
      </div>

      <Card>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>Email</TH>
                <TH>Role</TH>
                <TH>Overrides</TH>
                <TH>Delegation</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {users.map((user) => (
                <TR key={user.id}>
                  <TD>
                    <span className="font-medium">{user.email}</span>
                    {user.name !== "" ? (
                      <p className="text-xs text-zinc-500">{user.name}</p>
                    ) : null}
                  </TD>
                  <TD>
                    <Badge tone={user.role === "ADMIN" ? "violet" : "neutral"}>
                      {user.role} · {user.accessLevel}
                    </Badge>
                  </TD>
                  <TD className="text-xs">
                    {user.overrides.length === 0
                      ? "—"
                      : user.overrides
                          .map((override) => `${override.permission}:${override.effect}`)
                          .join(", ")}
                  </TD>
                  <TD className="text-xs">
                    {user.permissionManagement?.enabled === true ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <ShieldCheck size={12} />
                        rank ≥ {user.permissionManagement.minTargetRank},{" "}
                        {user.permissionManagement.allowedPermissions.length} perms
                      </span>
                    ) : (
                      "—"
                    )}
                  </TD>
                  <TD>
                    <Badge tone={user.disabled ? "red" : "green"}>
                      {user.disabled ? "disabled" : "active"}
                    </Badge>
                  </TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => { startEdit(user); setOpen(true); }}>
                        Edit
                      </Button>
                      {user.role !== "ADMIN" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => toggleDisabled(user)}
                        >
                          <UserX size={12} />
                        </Button>
                      ) : null}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        wide
        title={editing === null ? "New user" : `Edit ${editing.email}`}
        description={
          editing === null
            ? "The password is hashed with bcrypt and never returned again."
            : "Leave the password blank to keep the current one."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="user-form" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <form id="user-form" onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" htmlFor="user-email">
              <Input
                id="user-email"
                type="email"
                required
                disabled={editing !== null}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field label="Name" htmlFor="user-name">
              <Input
                id="user-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field
              label={editing === null ? "Password" : "New password"}
              htmlFor="user-password"
              hint="Minimum 10 characters"
            >
              <Input
                id="user-password"
                type="password"
                required={editing === null}
                minLength={10}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field label="Role" htmlFor="user-role">
              <Select
                id="user-role"
                value={role}
                disabled={editing !== null}
                onChange={(event) => setRole(event.target.value as RoleKey)}
              >
                {(Object.keys(ROLES) as RoleKey[]).map((value) => (
                  <option key={value} value={value}>
                    {value} (rank {ROLES[value]})
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {isRootAdmin ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={delegated}
                onChange={(event) => setDelegated(event.target.checked)}
              />
              Make this user a delegated permission manager
            </label>
          ) : null}

          {delegated ? (
            <div className="space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <Field
                label="Minimum target rank they may manage"
                htmlFor="min-rank"
                hint="Lower numbers are stronger. They can never manage ADMIN (0)."
              >
                <Input
                  id="min-rank"
                  type="number"
                  min={1}
                  max={1000}
                  value={minTargetRank}
                  onChange={(event) => setMinTargetRank(Number(event.target.value))}
                />
              </Field>
              <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Permission ceiling
              </p>
              <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto text-xs">
                {delegable.map((permission) => (
                  <label key={permission} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={allowed.includes(permission)}
                      onChange={(event) =>
                        setAllowed((current) =>
                          event.target.checked
                            ? [...current, permission]
                            : current.filter((entry) => entry !== permission),
                        )
                      }
                    />
                    <span title={PERMISSION_META[permission].description}>{permission}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <p className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Per-user overrides
            </p>
            <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto text-xs">
              {PERMISSION_KEYS.map((permission) => (
                <div key={permission} className="flex items-center gap-1.5">
                  <Select
                    value={overrides[permission] ?? ""}
                    className="h-7 w-24 text-xs"
                    onChange={(event) => {
                      const value = event.target.value;
                      setOverrides((current) => {
                        const next = { ...current };
                        if (value === "") {
                          delete next[permission];
                        } else {
                          next[permission] = value as "allow" | "deny";
                        }
                        return next;
                      });
                    }}
                  >
                    <option value="">inherit</option>
                    <option value="allow">allow</option>
                    <option value="deny">deny</option>
                  </Select>
                  <span className="truncate" title={PERMISSION_META[permission].description}>
                    {permission}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Protected permissions (bold) can only be granted by the root admin and are never
              granted by an override.
            </p>
          </div>

          {error !== "" ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
        </form>
      </Dialog>
    </div>
  );
}
