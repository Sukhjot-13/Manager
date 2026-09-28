import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { attemptLogin, lockoutRemainingMs } from "@/lib/authService";
import { loginSchema } from "@/lib/validation";
import { clientIp } from "@/lib/visitor";
import { SESSION_COOKIE, sessionCookieOptions, signSessionToken } from "@/lib/session";
import { checkReadiness } from "@/lib/readiness";

const NO_STORE = { "Cache-Control": "no-store" };

function unavailable(setup: string, missing: string[]): Response {
  return NextResponse.json(
    { error: "not_ready", setup, missingEnv: missing },
    { status: 503, headers: NO_STORE },
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  const readiness = await checkReadiness();
  if (readiness.setup !== "ready") {
    return unavailable(readiness.setup, readiness.env.missing);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }

  try {
    const ip = clientIp(request.headers);
    const identifiers = [`email:${parsed.data.email.toLowerCase()}`, `ip:${ip}`];
    const remaining = await lockoutRemainingMs(identifiers);
    if (remaining > 0) {
      return NextResponse.json(
        { error: "invalid_credentials", retryAfterSeconds: Math.ceil(remaining / 1000) },
        {
          status: 429,
          headers: {
            ...NO_STORE,
            "Retry-After": String(Math.ceil(remaining / 1000)),
          },
        },
      );
    }
    const outcome = await attemptLogin(parsed.data.email, parsed.data.password, ip);
    if (!outcome.ok) {
      const status = outcome.reason === "locked" ? 429 : 401;
      return NextResponse.json(
        { error: "invalid_credentials" },
        { status, headers: NO_STORE },
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
      { headers: NO_STORE },
    );
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch {
    return NextResponse.json(
      { error: "database_unavailable" },
      { status: 503, headers: NO_STORE },
    );
  }
}
