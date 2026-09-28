import { SignJWT, jwtVerify } from "jose";
import { authSecret } from "@/lib/env";
import { ROLES, isRoleKey, type RoleKey } from "@/lib/permissions";

export const SESSION_COOKIE = "mgr_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type SessionClaims = {
  sub: string;
  email: string;
  name: string;
  role: RoleKey;
  level: number;
};

export async function signSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({
    email: claims.email,
    name: claims.name,
    role: claims.role,
    level: claims.level,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(authSecret());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, authSecret(), {
      algorithms: ["HS256"],
    });
    const sub = payload.sub;
    const email = payload.email;
    const role = payload.role;
    const level = payload.level;
    if (
      typeof sub !== "string" ||
      typeof email !== "string" ||
      typeof role !== "string" ||
      !isRoleKey(role) ||
      typeof level !== "number" ||
      !Number.isInteger(level) ||
      level < 0 ||
      level > 1000
    ) {
      return null;
    }
    return {
      sub,
      email,
      name: typeof payload.name === "string" ? payload.name : "",
      role,
      level,
    };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function clearedSessionCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return { ...sessionCookieOptions(), maxAge: 0 };
}

export function defaultLevelForRole(role: RoleKey): number {
  return ROLES[role];
}
