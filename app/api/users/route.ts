import type { NextRequest } from "next/server";
import {
  can,
  isPermissionKey,
  assertCanGrant,
  type PermissionKey,
} from "@/lib/permissions";
import { authorizeUserManagement, errorResponse } from "@/lib/auth";
import { userCreateSchema } from "@/lib/validation";
import { clientIp } from "@/lib/visitor";
import { createUser, listUsers, recordAudit } from "@/lib/users";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest): Promise<Response> {
  try {
    await authorizeUserManagement(request);
    const users = await listUsers();
    return Response.json({ users }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const actor = await authorizeUserManagement(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
    }
    const parsed = userCreateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
    }
    const data = parsed.data;

    if (data.role === "ADMIN" && !can(actor, "permissions.delegate")) {
      return Response.json(
        { error: "delegate_root_only" },
        { status: 403, headers: NO_STORE },
      );
    }
    if (data.permissionManagement?.enabled === true) {
      if (!can(actor, "permissions.delegate")) {
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
    }
    for (const permission of Object.keys(data.overrides)) {
      if (!isPermissionKey(permission)) {
        return Response.json(
          { error: "unknown_permission" },
          { status: 400, headers: NO_STORE },
        );
      }
    }

    const user = await createUser({
      email: data.email,
      name: data.name,
      password: data.password,
      role: data.role,
      overrides: data.overrides as Record<PermissionKey, "allow" | "deny">,
      ...(data.permissionManagement === undefined
        ? {}
        : {
            permissionManagement: {
              enabled: data.permissionManagement.enabled,
              minTargetRank: data.permissionManagement.minTargetRank,
              allowedPermissions: data.permissionManagement
                .allowedPermissions.filter((permission): permission is PermissionKey =>
                  isPermissionKey(permission),
                ),
            },
          }),
    });
    await recordAudit({
      action: "user.created",
      actor: actor.email,
      targetType: "user",
      targetId: user.id,
      detail: { email: user.email, role: user.role },
      ip: clientIp(request.headers),
    });
    return Response.json({ user }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
