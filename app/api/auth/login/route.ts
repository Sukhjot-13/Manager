import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { attemptLogin, lockoutRemainingMs } from "@/lib/authService";
import { loginSchema } from "@/lib/validation";
import { clientIp } from "@/lib/visitor";
import { SESSION_COOKIE, sessionCookieOptions, signSessionToken } from "@/lib/session";

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const ip = clientIp(request.headers);
  const identifiers = [
    `email:${parsed.data.email.toLowerCase()}`,
    `ip:${ip}`,
  ];
  const remaining = await lockoutRemainingMs(identifiers);
  if (remaining > 0) {
    return Response.json(
      { error: "invalid_credentials", retryAfterSeconds: Math.ceil(remaining / 1000) },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(Math.ceil(remaining / 1000)),
        },
      },
    );
  }
  const outcome = await attemptLogin(parsed.data.email, parsed.data.password, ip);
  if (!outcome.ok) {
    const status = outcome.reason === "locked" ? 429 : 401;
    return Response.json(
      { error: "invalid_credentials" },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const token = await signSessionToken({
    sub: outcome.principal.id,
    email: outcome.principal.email,
    name: outcome.principal.name,
    role: outcome.principal.role,
    level: outcome.principal.level,
  });
  const response = NextResponse.json(
    { ok: true, role: outcome.principal.role },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}
