import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/db/connect";
import { UserModel } from "@/lib/db/users";
import {
  AuthorizationError,
  can,
  getEffectivePermissions,
  managementScope,
  type PermissionKey,
  type Principal,
  type RoleKey,
} from "@/lib/permissions";
import {
  SESSION_COOKIE,
  verifySessionToken,
  type SessionClaims,
} from "@/lib/session";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function unauthorized(message = "authentication required"): HttpError {
  return new HttpError(401, "unauthorized", message);
}

export function forbidden(message = "permission denied"): HttpError {
  return new HttpError(403, "forbidden", message);
}

export function notFound(message = "not found"): HttpError {
  return new HttpError(404, "not_found", message);
}

export async function principalFromClaims(
  claims: SessionClaims | null,
): Promise<Principal | null> {
  if (claims === null) {
    return null;
  }
  await connectToDatabase();
  const user = await UserModel.findOne({ email: claims.email }).lean();
  if (user === null || user === undefined) {
    return null;
  }
  if (user.disabled === true) {
    return null;
  }
  const role = (user.role ?? claims.role) as RoleKey;
  const overrides = normalizeOverrides(user.overrides);
  const scope =
    user.permissionManagement === undefined || user.permissionManagement === null
      ? null
      : {
          enabled: user.permissionManagement.enabled === true,
          minTargetRank: user.permissionManagement.minTargetRank ?? 100,
          allowedPermissions: (user.permissionManagement.allowedPermissions ??
            []) as PermissionKey[],
        };
  return {
    id: String(user._id),
    email: user.email,
    role,
    accessLevel: user.accessLevel ?? claims.level,
    overrides,
    permissionManagement: scope,
    disabled: false,
  };
}

function normalizeOverrides(
  raw: unknown,
): Partial<Record<PermissionKey, "allow" | "deny">> | null {
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return null;
  }
  const result: Partial<Record<PermissionKey, "allow" | "deny">> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === "allow" || value === "deny") {
      result[key as PermissionKey] = value;
    }
  }
  return result;
}

export async function getPrincipal(
  request: NextRequest,
): Promise<Principal | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token === undefined || token === "") {
    return null;
  }
  return principalFromClaims(await verifySessionToken(token));
}

export async function getPrincipalFromCookieStore(): Promise<Principal | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token === undefined || token === "") {
    return null;
  }
  return principalFromClaims(await verifySessionToken(token));
}

export async function requirePrincipal(
  request: NextRequest,
): Promise<Principal> {
  const principal = await getPrincipal(request);
  if (principal === null) {
    throw unauthorized();
  }
  return principal;
}

export async function requirePrincipalFromCookieStore(): Promise<Principal> {
  const principal = await getPrincipalFromCookieStore();
  if (principal === null) {
    throw unauthorized();
  }
  return principal;
}

export async function authorize(
  request: NextRequest,
  permission: PermissionKey,
): Promise<Principal> {
  const principal = await requirePrincipal(request);
  assertPermission(principal, permission);
  return principal;
}

export function assertPermission(
  principal: Principal,
  permission: PermissionKey,
): void {
  if (!can(principal, permission)) {
    throw forbidden(`missing permission ${permission}`);
  }
}

export async function authorizeUserManagement(
  request: NextRequest,
): Promise<Principal> {
  const principal = await requirePrincipal(request);
  if (
    can(principal, "users.manage") ||
    managementScope(principal) !== null
  ) {
    return principal;
  }
  throw forbidden("user management or a permission-management scope is required");
}

export function capabilitiesFor(principal: Principal): PermissionKey[] {
  return getEffectivePermissions(principal);
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json(
      { error: error.code },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof AuthorizationError) {
    return Response.json(
      { error: error.code },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { error: "internal_error" },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
