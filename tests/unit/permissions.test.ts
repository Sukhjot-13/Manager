import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  PERMISSION_META,
  ROLES,
  assertCanDelegate,
  assertCanGrant,
  assertCanManageTarget,
  can,
  getEffectivePermissions,
  isPermissionKey,
  isRootAdmin,
  isSystemProtected,
  managementScope,
  rankForRole,
  type PermissionKey,
  type Principal,
} from "@/lib/permissions";

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    id: "u1",
    email: "user@example.com",
    role: "USER",
    accessLevel: ROLES.USER,
    ...overrides,
  };
}

const admin = principal({ id: "admin", role: "ADMIN", accessLevel: ROLES.ADMIN });
const developer = principal({ id: "dev", role: "DEVELOPER", accessLevel: ROLES.DEVELOPER });

describe("permission registry", () => {
  it("exposes a non-empty registry of named permissions", () => {
    expect(PERMISSIONS.length).toBeGreaterThan(10);
    for (const permission of PERMISSIONS) {
      expect(PERMISSION_META[permission].description.length).toBeGreaterThan(0);
      expect(PERMISSION_META[permission].minimumRoleRank).toBeGreaterThanOrEqual(0);
    }
  });

  it("rejects unknown permission identifiers", () => {
    expect(isPermissionKey("projects.view")).toBe(true);
    expect(isPermissionKey("nope:nope")).toBe(false);
    expect(isPermissionKey("toString")).toBe(false);
  });

  it("keeps every protected permission admin-only and non-delegable", () => {
    for (const permission of PERMISSIONS.filter(isSystemProtected)) {
      expect(can(developer, permission)).toBe(false);
      expect(can(principal(), permission)).toBe(false);
      expect(PERMISSION_META[permission].delegable).toBe(false);
    }
  });
});

describe("can()", () => {
  it("denies an anonymous principal", () => {
    expect(can(null, "dashboard.view")).toBe(false);
    expect(can(undefined, "dashboard.view")).toBe(false);
  });

  it("denies unknown and malformed input instead of throwing", () => {
    expect(can(admin, "not-a-permission")).toBe(false);
    expect(can(principal({ role: "WIZARD" as never }), "dashboard.view")).toBe(false);
    expect(
      can(principal({ accessLevel: Number.NaN }), "dashboard.view"),
    ).toBe(false);
  });

  it("denies a disabled principal even when root admin", () => {
    expect(can({ ...admin, disabled: true }, "dashboard.view")).toBe(false);
  });

  it("grants root admin every permission, current and future", () => {
    for (const permission of PERMISSIONS) {
      expect(can(admin, permission)).toBe(true);
    }
    expect(getEffectivePermissions(admin)).toEqual([...PERMISSIONS]);
  });

  it("cannot have root admin authority removed by deny overrides or role demotion", () => {
    const locked = principal({
      id: "admin",
      role: "ADMIN",
      accessLevel: ROLES.ADMIN,
      overrides: { "secrets.reveal": "deny" },
    });
    expect(can(locked, "secrets.reveal")).toBe(true);
    expect(getEffectivePermissions(locked)).toContain("secrets.reveal");
  });

  it("applies a user deny override before role grants", () => {
    const denied = principal({ role: "ADMIN", accessLevel: 1, overrides: { "projects.edit": "deny" } });
    expect(can(denied, "projects.edit")).toBe(false);
  });

  it("applies a user allow override when no safety rule blocks it", () => {
    const allowed = principal({ overrides: { "secrets.reveal": "allow" } });
    expect(can(allowed, "secrets.reveal")).toBe(true);
  });

  it("never lets an override grant a system-protected permission", () => {
    const escalate = principal({
      overrides: { "secrets.export": "allow", "users.manage": "allow" },
    });
    expect(can(escalate, "secrets.export")).toBe(false);
    expect(can(escalate, "users.manage")).toBe(false);
    expect(getEffectivePermissions(escalate)).not.toContain("users.manage");
  });

  it("grants role defaults by rank", () => {
    expect(rankForRole("ADMIN")).toBe(0);
    expect(can(principal(), "projects.view")).toBe(true);
    expect(can(principal(), "projects.create")).toBe(false);
    expect(can(developer, "projects.create")).toBe(true);
    expect(can(developer, "projects.delete")).toBe(false);
  });
});

describe("delegation rules", () => {
  const manager = principal({
    id: "manager",
    role: "DEVELOPER",
    accessLevel: ROLES.DEVELOPER,
    permissionManagement: {
      enabled: true,
      minTargetRank: 90,
      allowedPermissions: ["projects.edit", "secrets.reveal"],
    },
  });

  it("gives only root admin the delegation permission", () => {
    expect(can(admin, "permissions.delegate")).toBe(true);
    expect(can(manager, "permissions.delegate")).toBe(false);
    expect(() => assertCanDelegate(manager, { id: "x" })).toThrow(/root admin/i);
    expect(() => assertCanDelegate(admin, { id: "x" })).not.toThrow();
  });

  it("exposes a scope only to an enabled manager or root admin", () => {
    expect(managementScope(manager)?.allowedPermissions).toEqual([
      "projects.edit",
      "secrets.reveal",
    ]);
    expect(
      managementScope({ ...manager, permissionManagement: { enabled: false, minTargetRank: 90, allowedPermissions: [] } }),
    ).toBeNull();
    expect(managementScope(principal())).toBeNull();
  });

  it("strips non-delegable permissions out of a manager ceiling", () => {
    const scope = managementScope({
      ...manager,
      permissionManagement: {
        enabled: true,
        minTargetRank: 90,
        allowedPermissions: ["projects.edit", "users.manage", "secrets.export"],
      },
    });
    expect(scope?.allowedPermissions).toEqual(["projects.edit"]);
  });

  it("refuses targets above the manager rank boundary", () => {
    expect(() =>
      assertCanManageTarget(manager, { id: "u2", role: "DEVELOPER", accessLevel: ROLES.DEVELOPER }),
    ).toThrow(/rank boundary/i);
    expect(() =>
      assertCanManageTarget(manager, { id: "u3", role: "USER", accessLevel: ROLES.USER }),
    ).not.toThrow();
  });

  it("refuses to let a manager touch root admin or itself", () => {
    expect(() =>
      assertCanManageTarget(manager, { id: "root", role: "ADMIN", accessLevel: ROLES.ADMIN }),
    ).toThrow(/root admin/i);
    expect(() =>
      assertCanManageTarget(manager, { id: manager.id, role: "DEVELOPER", accessLevel: 50 }),
    ).toThrow(/own permission-management scope/i);
  });

  it("refuses a principal with no management permission at all", () => {
    expect(() =>
      assertCanManageTarget(principal(), { id: "x", role: "USER", accessLevel: 100 }),
    ).toThrow(/permission management required/i);
  });

  it("refuses grants outside the ceiling or above what the manager holds", () => {
    expect(() => assertCanGrant(manager, "projects.edit")).not.toThrow();
    expect(() => assertCanGrant(manager, "projects.create")).toThrow(/ceiling/i);
    expect(() => assertCanGrant(manager, "users.manage")).toThrow(/root admin/i);
    expect(() => assertCanGrant(manager, "bogus" as PermissionKey)).toThrow(/unknown/i);
  });

  it("refuses to let a manager grant a permission they do not hold", () => {
    const weak = principal({
      id: "weak",
      role: "DEVELOPER",
      accessLevel: ROLES.DEVELOPER,
      permissionManagement: {
        enabled: true,
        minTargetRank: 100,
        allowedPermissions: ["users.manage" as PermissionKey],
      },
    });
    expect(() => assertCanGrant(weak, "users.manage")).toThrow(/root admin/i);
  });
});

describe("isRootAdmin", () => {
  it("recognises only an enabled rank-0 ADMIN", () => {
    expect(isRootAdmin(admin)).toBe(true);
    expect(isRootAdmin({ ...admin, disabled: true })).toBe(false);
    expect(isRootAdmin({ ...admin, accessLevel: 1 })).toBe(false);
    expect(isRootAdmin({ ...admin, role: "DEVELOPER" })).toBe(false);
    expect(isRootAdmin(null)).toBe(false);
  });
});
