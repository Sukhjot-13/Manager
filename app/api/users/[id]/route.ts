import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  assertCanDelegate,
  assertCanGrant,
  assertCanManageTarget,
  can,
  isPermissionKey,
  type PermissionKey,
} from "@/lib/permissions";
import { authorizeUserManagement, errorResponse, notFound } from "@/lib/auth";
import { clientIp } from "@/lib/visitor";
import {
  getUserById,
  recordAudit,
  updateUser,
  countAdmins,
} from "@/lib/users";

const NO_STORE = { "Cache-Control": "no-store" };

const patchSchema = z.object({
  name: z.string().max(80).optional(),
  password: z.string().min(10).max(200).optional(),
  disabled: z.boolean().optional(),
  overrides: z.record(z.string(), z.enum(["allow", "deny"])).optional(),
  permissionManagement: z
    .object({
      enabled: z.boolean(),
      minTargetRank: z.number().int().min(1).max(1000),
      allowedPermissions: z.array(z.string().max(60)).max(50),
    })
    .optional(),
});

type Context = { params: Promise<{ id: string }> };

export async function PATCH(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    const actor = await authorizeUserManagement(request);
    const { id } = await context.params;
    const target = await getUserById(id);
    if (target === null) {
      throw notFound("user not found");
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
    }
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
    }
    const data = parsed.data;

    if (target.id === actor.id && data.disabled === true) {
      return Response.json(
        { error: "self_lockout" },
        { status: 400, headers: NO_STORE },
      );
    }

    assertCanManageTarget(actor, {
      id: target.id,
      role: target.role,
      accessLevel: target.accessLevel,
    });
    if (
      target.role === "ADMIN" &&
      (data.disabled === true || target.accessLevel !== 0)
    ) {
      if (!can(actor, "permissions.delegate")) {
        return Response.json(
          { error: "delegate_root_only" },
          { status: 403, headers: NO_STORE },
        );
      }
    }
    if (target.role === "ADMIN" && data.disabled === true) {
      const admins = await countAdmins();
      if (admins <= 1) {
        return Response.json(
          { error: "last_admin" },
          { status: 400, headers: NO_STORE },
        );
      }
    }
    if (data.permissionManagement !== undefined) {
      if (data.permissionManagement.enabled && !can(actor, "permissions.delegate")) {
        return Response.json(
          { error: "delegate_root_only" },
          { status: 403, headers: NO_STORE },
        );
      }
      for (const permission of data.permissionManagement.allowedPermissions) {
        if (!isPermissionKey(permission)) {
          return Response.json(
            { error: "unknown_permission" },
            { status: 400, headers: NO_STORE },
          );
        }
        assertCanGrant(actor, permission);
      }
      if (target.id === actor.id) {
        return Response.json(
          { error: "self_management" },
          { status: 403, headers: NO_STORE },
        );
      }
    }
    for (const permission of Object.keys(data.overrides ?? {})) {
      if (!isPermissionKey(permission)) {
        return Response.json(
          { error: "unknown_permission" },
          { status: 400, headers: NO_STORE },
        );
      }
    }

    const updated = await updateUser(id, {
      ...(data.name === undefined ? {} : { name: data.name }),
      ...(data.password === undefined ? {} : { password: data.password }),
      ...(data.disabled === undefined ? {} : { disabled: data.disabled }),
      ...(data.overrides === undefined
        ? {}
        : { overrides: data.overrides as Record<PermissionKey, "allow" | "deny"> }),
      ...(data.permissionManagement === undefined
        ? {}
        : {
            permissionManagement: {
              enabled: data.permissionManagement.enabled,
              minTargetRank: data.permissionManagement.minTargetRank,
              allowedPermissions: data.permissionManagement.allowedPermissions.filter(
                (permission): permission is PermissionKey => isPermissionKey(permission),
              ),
            },
          }),
    });
    if (updated === null) {
      throw notFound("user not found");
    }
    await recordAudit({
      action: "user.updated",
      actor: actor.email,
      targetType: "user",
      targetId: id,
      detail: {
        disabled: data.disabled,
        overrides: data.overrides,
        permissionManagement: data.permissionManagement,
        passwordChanged: data.password !== undefined,
      },
      ip: clientIp(request.headers),
    });
    return Response.json({ user: updated }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    const actor = await authorizeUserManagement(request);
    const { id } = await context.params;
    const target = await getUserById(id);
    if (target === null) {
      throw notFound("user not found");
    }
    if (target.id === actor.id) {
      return Response.json(
        { error: "self_delete" },
        { status: 400, headers: NO_STORE },
      );
    }
    assertCanManageTarget(actor, {
      id: target.id,
      role: target.role,
      accessLevel: target.accessLevel,
    });
    if (target.role === "ADMIN") {
      assertCanDelegate(actor, target);
      const admins = await countAdmins();
      if (admins <= 1) {
        return Response.json(
          { error: "last_admin" },
          { status: 400, headers: NO_STORE },
        );
      }
    }
    const updated = await updateUser(id, { disabled: true });
    await recordAudit({
      action: "user.disabled",
      actor: actor.email,
      targetType: "user",
      targetId: id,
      detail: { email: target.email },
      ip: clientIp(request.headers),
    });
    return Response.json({ user: updated, deleted: true }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
