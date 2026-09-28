import bcrypt from "bcryptjs";
import { connectToDatabase } from "@/lib/db/connect";
import { UserModel } from "@/lib/db/users";
import { AuditEventModel } from "@/lib/db/ops";
import {
  ROLES,
  isPermissionKey,
  isSystemProtected,
  type PermissionKey,
  type PermissionManagementScope,
  type Principal,
  type RoleKey,
} from "@/lib/permissions";

export type UserSummary = {
  id: string;
  email: string;
  name: string;
  role: RoleKey;
  accessLevel: number;
  overrides: { permission: PermissionKey; effect: "allow" | "deny" }[];
  permissionManagement: PermissionManagementScope | null;
  disabled: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
};

export async function listUsers(): Promise<UserSummary[]> {
  await connectToDatabase();
  const users = await UserModel.find().sort({ createdAt: 1 }).lean();
  return users.map(serializeUser);
}

export async function getUserById(id: string): Promise<UserSummary | null> {
  await connectToDatabase();
  if (!/^[a-f0-9]{24}$/i.test(id)) {
    return null;
  }
  const user = await UserModel.findById(id).lean();
  return user === null || user === undefined ? null : serializeUser(user);
}

export function serializeUser(user: Record<string, unknown> & { _id: unknown }): UserSummary {
  const overridesRaw = (user.overrides ?? {}) as Record<string, unknown>;
  const overrides = Object.entries(overridesRaw)
    .filter(
      (entry): entry is [string, "allow" | "deny"] =>
        isPermissionKey(entry[0]) && (entry[1] === "allow" || entry[1] === "deny"),
    )
    .map(([permission, effect]) => ({
      permission: permission as PermissionKey,
      effect,
    }));
  const scope = (user.permissionManagement ?? null) as PermissionManagementScope | null;
  return {
    id: String(user._id),
    email: String(user.email),
    name: String(user.name ?? ""),
    role: user.role as RoleKey,
    accessLevel: Number(user.accessLevel ?? ROLES.USER),
    overrides,
    permissionManagement:
      scope === null || scope === undefined
        ? null
        : {
            enabled: scope.enabled === true,
            minTargetRank: scope.minTargetRank,
            allowedPermissions: (scope.allowedPermissions ?? []).filter(
              (permission): permission is PermissionKey => isPermissionKey(permission),
            ),
          },
    disabled: user.disabled === true,
    lastLoginAt:
      user.lastLoginAt instanceof Date ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : null,
  };
}

export type CreateUserInput = {
  email: string;
  name?: string;
  password: string;
  role: RoleKey;
  overrides?: Record<string, "allow" | "deny">;
  permissionManagement?: PermissionManagementScope;
};

export async function createUser(input: CreateUserInput): Promise<UserSummary> {
  await connectToDatabase();
  const email = input.email.trim().toLowerCase();
  const existing = await UserModel.exists({ email });
  if (existing !== null) {
    throw new Error("email already exists");
  }
  const created = await UserModel.create({
    email,
    name: input.name ?? "",
    passwordHash: await bcrypt.hash(input.password, 12),
    role: input.role,
    accessLevel: ROLES[input.role],
    ...(input.overrides === undefined || Object.keys(input.overrides).length === 0
      ? {}
      : { overrides: input.overrides }),
    ...(input.permissionManagement === undefined
      ? {}
      : { permissionManagement: input.permissionManagement }),
  });
  return serializeUser(created.toObject() as unknown as Record<string, unknown> & {
    _id: unknown;
  });
}

export type UpdateUserInput = {
  name?: string;
  password?: string;
  disabled?: boolean;
  overrides?: Record<string, "allow" | "deny">;
  permissionManagement?: PermissionManagementScope;
};

export async function updateUser(
  id: string,
  input: UpdateUserInput,
): Promise<UserSummary | null> {
  await connectToDatabase();
  if (!/^[a-f0-9]{24}$/i.test(id)) {
    return null;
  }
  const update: Record<string, unknown> = {};
  if (input.name !== undefined) {
    update.name = input.name;
  }
  if (input.password !== undefined) {
    update.passwordHash = await bcrypt.hash(input.password, 12);
  }
  if (input.disabled !== undefined) {
    update.disabled = input.disabled;
  }
  if (input.overrides !== undefined) {
    update.overrides = input.overrides;
  }
  if (input.permissionManagement !== undefined) {
    update.permissionManagement = input.permissionManagement;
  }
  const updated = await UserModel.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
  return updated === null || updated === undefined ? null : serializeUser(updated);
}

export async function countAdmins(): Promise<number> {
  await connectToDatabase();
  return UserModel.countDocuments({ role: "ADMIN", disabled: { $ne: true } });
}

export async function recordAudit(input: {
  action: string;
  actor: string;
  targetType?: string;
  targetId?: string;
  detail?: unknown;
  ip?: string;
}): Promise<void> {
  await connectToDatabase();
  await AuditEventModel.create({
    action: input.action,
    actor: input.actor,
    targetType: input.targetType ?? "",
    targetId: input.targetId ?? "",
    detail: input.detail,
    ip: input.ip ?? "",
    ts: new Date(),
  });
}

export async function listAuditEvents(limit = 100): Promise<
  {
    id: string;
    action: string;
    actor: string;
    targetType: string;
    targetId: string;
    detail: unknown;
    ip: string;
    ts: string;
  }[]
> {
  await connectToDatabase();
  const rows = await AuditEventModel.find()
    .sort({ ts: -1 })
    .limit(Math.min(Math.max(limit, 1), 200))
    .lean();
  return rows.map((row) => ({
    id: String(row._id),
    action: row.action,
    actor: row.actor,
    targetType: row.targetType ?? "",
    targetId: row.targetId ?? "",
    detail: row.detail ?? null,
    ip: row.ip ?? "",
    ts: row.ts instanceof Date ? row.ts.toISOString() : "",
  }));
}

export function principalFromUser(user: {
  id: string;
  email: string;
  role: RoleKey;
  accessLevel: number;
  overrides: { permission: PermissionKey; effect: "allow" | "deny" }[];
  permissionManagement: PermissionManagementScope | null;
  disabled: boolean;
}): Principal {
  const overrides: Partial<Record<PermissionKey, "allow" | "deny">> = {};
  for (const override of user.overrides) {
    overrides[override.permission] = override.effect;
  }
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    accessLevel: user.accessLevel,
    overrides,
    permissionManagement: user.permissionManagement,
    disabled: user.disabled,
  };
}

export function isProtectedPermission(permission: string): boolean {
  return isPermissionKey(permission) && isSystemProtected(permission);
}
