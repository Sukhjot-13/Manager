import { NextRequest } from "next/server";
import { signSessionToken, SESSION_COOKIE } from "@/lib/session";
import {
  ROLES,
  type PermissionManagementScope,
  type PermissionKey,
  type RoleKey,
} from "@/lib/permissions";

export type TestPrincipalOptions = {
  id?: string;
  email?: string;
  role?: RoleKey;
  overrides?: Partial<Record<PermissionKey, "allow" | "deny">>;
  permissionManagement?: PermissionManagementScope | null;
  disabled?: boolean;
};

export async function authCookie(
  options: TestPrincipalOptions = {},
): Promise<{ name: string; value: string }> {
  const role = options.role ?? "ADMIN";
  const token = await signSessionToken({
    sub: options.id ?? "507f1f77bcf86cd799439011",
    email: options.email ?? "owner@example.com",
    name: "Test",
    role,
    level: ROLES[role],
  });
  return { name: SESSION_COOKIE, value: token };
}

export function requestWithCookie(
  url: string,
  cookie?: { name: string; value: string },
  init: RequestInit = {},
): NextRequest {
  const headers = new Headers(init.headers);
  if (cookie !== undefined && cookie.value !== "") {
    headers.set("cookie", `${cookie.name}=${cookie.value}`);
  }
  return new NextRequest(new Request(url, { ...init, headers }));
}
