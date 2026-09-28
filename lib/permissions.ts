export const ROLES = {
  ADMIN: 0,
  DEVELOPER: 50,
  USER: 100,
} as const;

export type RoleKey = keyof typeof ROLES;

export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];

export const SYSTEM_PROTECTED_PERMISSIONS = [
  "permissions.delegate",
  "users.manage",
  "settings.manage",
  "roles.rank-change",
] as const;

export type PermissionKey =
  | "dashboard.view"
  | "projects.view"
  | "projects.create"
  | "projects.edit"
  | "projects.delete"
  | "secrets.view"
  | "secrets.reveal"
  | "secrets.edit"
  | "secrets.export"
  | "keys.view"
  | "keys.manage"
  | "logs.view"
  | "logs.export"
  | "analytics.view"
  | "analytics.edit"
  | "analytics.export"
  | "users.manage"
  | "settings.manage"
  | "permissions.manage"
  | "permissions.delegate"
  | "roles.rank-change";

type PermissionMeta = {
  description: string;
  category: "dashboard" | "projects" | "secrets" | "keys" | "logs" | "analytics" | "admin";
  delegable: boolean;
  systemProtected: boolean;
  minimumRoleRank: number;
};

export const PERMISSION_META: Record<PermissionKey, PermissionMeta> = {
  "dashboard.view": {
    description: "View the dashboard overview",
    category: "dashboard",
    delegable: true,
    systemProtected: false,
    minimumRoleRank: ROLES.USER,
  },
  "projects.view": {
    description: "View projects and their details",
    category: "projects",
    delegable: true,
    systemProtected: false,
    minimumRoleRank: ROLES.USER,
  },
  "projects.create": {
    description: "Create new projects",
    category: "projects",
    delegable: true,
    systemProtected: false,
    minimumRoleRank: ROLES.DEVELOPER,
  },
  "projects.edit": {
    description: "Edit existing projects",
    category: "projects",
    delegable: true,
    systemProtected: false,
    minimumRoleRank: ROLES.DEVELOPER,
  },
  "projects.delete": {
    description: "Delete projects and their data",
    category: "projects",
    delegable: true,
    systemProtected: false,
    minimumRoleRank: ROLES.ADMIN,
  },
  "secrets.view": {
    description: "List secret keys and masked values",
    category: "secrets",
    delegable: true,
    systemProtected: false,
    minimumRoleRank: ROLES.DEVELOPER,
  },
  "secrets.reveal": {
    description: "Decrypt and reveal a single secret value",
    category: "secrets",
    delegable: true,
    systemProtected: false,
    minimumRoleRank: ROLES.DEVELOPER,
  },
  "secrets.edit": {
    description: "Create, update and delete secrets",
    category: "secrets",
    delegable: true,
    systemProtected: false,
    minimumRoleRank: ROLES.ADMIN,
  },
  "secrets.export": {
    description: "Export decrypted secrets as a .env download",
    category: "secrets",
    delegable: false,
    systemProtected: true,
    minimumRoleRank: ROLES.ADMIN,
  },
  "keys.view": {
    description: "View API key prefixes and metadata",
    category: "keys",
    delegable: true,
    systemProtected: false,
    minimumRoleRank: ROLES.DEVELOPER,
  },
  "keys.manage": {
    description: "Create and revoke API keys",
    category: "keys",
    delegable: true,
    systemProtected: false,
    minimumRoleRank: ROLES.ADMIN,
  },
  "logs.view": {
    description: "View the log viewer",
    category: "logs",
    delegable: true,
    systemProtected: false,
    minimumRoleRank: ROLES.USER,
  },
  "logs.export": {
    description: "Export filtered logs as CSV or JSON",
    category: "logs",
    delegable: false,
    systemProtected: true,
    minimumRoleRank: ROLES.ADMIN,
  },
  "analytics.view": {
    description: "View analytics dashboards",
    category: "analytics",
    delegable: true,
    systemProtected: false,
    minimumRoleRank: ROLES.USER,
  },
  "analytics.edit": {
    description: "Enable or disable analytics ingest per project",
    category: "analytics",
    delegable: true,
    systemProtected: false,
    minimumRoleRank: ROLES.DEVELOPER,
  },
  "analytics.export": {
    description: "Export analytics events as CSV or JSON",
    category: "analytics",
    delegable: false,
    systemProtected: true,
    minimumRoleRank: ROLES.ADMIN,
  },
  "users.manage": {
    description: "Create, edit and disable users",
    category: "admin",
    delegable: false,
    systemProtected: true,
    minimumRoleRank: ROLES.ADMIN,
  },
  "settings.manage": {
    description: "Change global settings and ingest kill switches",
    category: "admin",
    delegable: false,
    systemProtected: true,
    minimumRoleRank: ROLES.ADMIN,
  },
  "permissions.manage": {
    description: "Grant or revoke ordinary permissions within an assigned scope",
    category: "admin",
    delegable: true,
    systemProtected: false,
    minimumRoleRank: ROLES.ADMIN,
  },
  "permissions.delegate": {
    description: "Grant or revoke permission-management authority (root admin only)",
    category: "admin",
    delegable: false,
    systemProtected: true,
    minimumRoleRank: ROLES.ADMIN,
  },
  "roles.rank-change": {
    description: "Change role ranks or system-role metadata",
    category: "admin",
    delegable: false,
    systemProtected: true,
    minimumRoleRank: ROLES.ADMIN,
  },
};

export const PERMISSIONS = Object.keys(
  PERMISSION_META,
) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.hasOwn(PERMISSION_META, value);
}

export type PermissionOverrides = Partial<
  Record<PermissionKey, "allow" | "deny">
>;

export type PermissionManagementScope = {
  enabled: boolean;
  minTargetRank: number;
  allowedPermissions: PermissionKey[];
};

export type Principal = {
  id: string;
  email: string;
  role: RoleKey;
  accessLevel: number;
  overrides?: PermissionOverrides | null;
  permissionManagement?: PermissionManagementScope | null;
  disabled?: boolean;
};

export class AuthorizationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 403) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === "string" && Object.hasOwn(ROLES, value);
}

export function rankForRole(role: RoleKey): number {
  return ROLES[role];
}

export function isRootAdmin(principal: Partial<Principal> | null | undefined): boolean {
  return (
    principal !== null &&
    principal !== undefined &&
    principal.disabled !== true &&
    principal.role === "ADMIN" &&
    principal.accessLevel === ROLES.ADMIN
  );
}

function isValidRank(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function hasManagementAuthority(principal: Principal): boolean {
  if (isRootAdmin(principal)) {
    return true;
  }
  const scope = principal.permissionManagement;
  return scope !== null && scope !== undefined && scope.enabled === true;
}

function roleGrants(
  principal: Principal,
  permission: PermissionKey,
): boolean {
  const meta = PERMISSION_META[permission];
  if (meta.systemProtected) {
    return false;
  }
  if (permission === "permissions.manage") {
    return hasManagementAuthority(principal);
  }
  return principal.accessLevel <= meta.minimumRoleRank;
}

export function can(
  principal: Principal | null | undefined,
  permission: string,
): boolean {
  if (principal === null || principal === undefined) {
    return false;
  }
  if (principal.disabled === true) {
    return false;
  }
  if (!isPermissionKey(permission)) {
    return false;
  }
  if (!isRoleKey(principal.role)) {
    return false;
  }
  if (!isValidRank(principal.accessLevel)) {
    return false;
  }
  if (principal.accessLevel !== ROLES[principal.role]) {
    return false;
  }
  if (isRootAdmin(principal)) {
    return true;
  }
  const override = principal.overrides?.[permission];
  if (override === "deny") {
    return false;
  }
  if (override === "allow") {
    return !PERMISSION_META[permission].systemProtected;
  }
  return roleGrants(principal, permission);
}

export function explain(
  principal: Principal | null | undefined,
  permission: PermissionKey,
): string {
  if (principal === null || principal === undefined || principal.disabled) {
    return "no principal";
  }
  if (isRootAdmin(principal)) {
    return "root-admin";
  }
  const override = principal.overrides?.[permission];
  if (override !== undefined) {
    return `user-override:${override}`;
  }
  return roleGrants(principal, permission) ? "role" : "denied";
}

export function getEffectivePermissions(
  principal: Principal | null | undefined,
): PermissionKey[] {
  if (principal === null || principal === undefined || principal.disabled) {
    return [];
  }
  if (isRootAdmin(principal)) {
    return [...PERMISSIONS];
  }
  return PERMISSIONS.filter((permission) => can(principal, permission));
}

export function isDelegable(permission: PermissionKey): boolean {
  return PERMISSION_META[permission].delegable;
}

export function isSystemProtected(permission: PermissionKey): boolean {
  return PERMISSION_META[permission].systemProtected;
}

export function canDelegate(principal: Principal | null | undefined): boolean {
  return can(principal, "permissions.delegate");
}

export function canManagePermissions(principal: Principal | null | undefined): boolean {
  return can(principal, "permissions.manage");
}

export function managementScope(
  principal: Principal | null | undefined,
): PermissionManagementScope | null {
  if (isRootAdmin(principal)) {
    return {
      enabled: true,
      minTargetRank: ROLES.DEVELOPER,
      allowedPermissions: [...PERMISSIONS],
    };
  }
  if (principal === null || principal === undefined) {
    return null;
  }
  const scope = principal.permissionManagement;
  if (scope === null || scope === undefined || !scope.enabled) {
    return null;
  }
  return {
    enabled: true,
    minTargetRank: scope.minTargetRank,
    allowedPermissions: scope.allowedPermissions.filter(isDelegable),
  };
}

export function assertCanManageTarget(
  principal: Principal | null | undefined,
  target: { id: string; role: RoleKey; accessLevel: number; email?: string },
): void {
  if (!canManagePermissions(principal) || principal === null || principal === undefined) {
    throw new AuthorizationError(
      "forbidden",
      "permission management required",
    );
  }
  if (target.id === principal.id) {
    throw new AuthorizationError(
      "self_management",
      "managers cannot modify their own permission-management scope",
    );
  }
  if (isRootAdmin(principal)) {
    return;
  }
  if (isRootAdmin(target)) {
    throw new AuthorizationError(
      "protected_target",
      "root admin cannot be managed by a delegated manager",
    );
  }
  const scope = managementScope(principal);
  if (scope === null) {
    throw new AuthorizationError(
      "no_scope",
      "no permission-management scope assigned",
    );
  }
  if (target.role === "ADMIN" || target.accessLevel < scope.minTargetRank) {
    throw new AuthorizationError(
      "rank_boundary",
      "target is above the manager's rank boundary",
    );
  }
}

export function assertCanGrant(
  principal: Principal | null | undefined,
  permission: PermissionKey,
): void {
  if (!isPermissionKey(permission)) {
    throw new AuthorizationError("unknown_permission", "unknown permission", 400);
  }
  if (isSystemProtected(permission)) {
    if (!canDelegate(principal)) {
      throw new AuthorizationError(
        "protected_permission",
        "only root admin may grant protected permissions",
      );
    }
    return;
  }
  const scope = managementScope(principal);
  if (scope === null) {
    throw new AuthorizationError(
      "no_scope",
      "no permission-management scope assigned",
    );
  }
  if (!scope.allowedPermissions.includes(permission)) {
    throw new AuthorizationError(
      "outside_ceiling",
      "permission is outside the manager's assigned ceiling",
    );
  }
  if (principal !== null && principal !== undefined && !isRootAdmin(principal)) {
    if (!can(principal, permission)) {
      throw new AuthorizationError(
        "not_self_held",
        "a manager cannot grant a permission they do not hold",
      );
    }
  }
}

export function assertCanDelegate(
  principal: Principal | null | undefined,
  target: { id: string },
): void {
  if (!canDelegate(principal)) {
    throw new AuthorizationError(
      "delegate_root_only",
      "only root admin may grant permission-management authority",
    );
  }
  if (principal !== null && principal !== undefined && target.id === principal.id) {
    throw new AuthorizationError(
      "self_delegation",
      "root admin already holds full authority",
    );
  }
}
