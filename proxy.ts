import { NextResponse, type NextRequest } from "next/server";
import { capabilitiesFor, getPrincipal } from "@/lib/auth";
import { buildCsp, generateNonce } from "@/lib/csp";
import { SESSION_COOKIE } from "@/lib/session";
import { can, type PermissionKey } from "@/lib/permissions";

const CSP_HEADER = "content-security-policy";
const NONCE_HEADER = "x-nonce";

const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/api/ping",
  "/api/auth/login",
  "/api/auth/logout",
  "/t.js",
]);

const PUBLIC_PREFIXES = ["/api/ingest/", "/api/sdk/"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) {
    return true;
  }
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function unauthenticatedResponse(request: NextRequest): Response {
  if (isApiPath(request.nextUrl.pathname)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
  return new Response(null, { status: 307, headers: { location: url.toString() } });
}

function forbiddenResponse(pathname: string): Response {
  if (isApiPath(pathname)) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  return new Response(JSON.stringify({ error: "forbidden" }), {
    status: 403,
    headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
  });
}

export async function proxy(request: NextRequest): Promise<Response> {
  const { pathname } = request.nextUrl;
  const nonce = generateNonce();
  const csp = buildCsp(nonce, process.env.NODE_ENV !== "production");

  const withCsp = (response: Response): Response => {
    try {
      response.headers.set(CSP_HEADER, csp);
    } catch {
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers([...response.headers, [CSP_HEADER, csp]]),
      });
    }
    return response;
  };

  if (isPublicPath(pathname)) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(CSP_HEADER, csp);
    requestHeaders.set(NONCE_HEADER, nonce);
    return withCsp(
      NextResponse.next({ request: { headers: requestHeaders } }),
    );
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token === undefined || token === "") {
    return withCsp(unauthenticatedResponse(request));
  }

  const principal = await getPrincipal(request).catch(() => null);
  if (principal === null) {
    return withCsp(unauthenticatedResponse(request));
  }

  const guard = guardForPath(pathname);
  if (guard !== null && !can(principal, guard)) {
    return withCsp(forbiddenResponse(pathname));
  }

  if (pathname === "/api/auth/session") {
    return withCsp(
      Response.json(
        {
          user: {
            id: principal.id,
            email: principal.email,
            role: principal.role,
            level: principal.accessLevel,
          },
          capabilities: capabilitiesFor(principal),
        },
        { headers: { "Cache-Control": "no-store" } },
      ),
    );
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_HEADER, csp);
  requestHeaders.set(NONCE_HEADER, nonce);
  return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));
}

function guardForPath(pathname: string): PermissionKey | null {
  if (pathname.startsWith("/api/secrets") || pathname.includes("/secrets/export")) {
    return "secrets.view";
  }
  if (pathname.includes("/reveal")) {
    return "secrets.reveal";
  }
  if (pathname.includes("/keys") || pathname.includes("/sdk/")) {
    return "keys.view";
  }
  if (pathname.startsWith("/settings/keys")) {
    return "keys.view";
  }
  if (pathname.includes("/users")) {
    return "users.manage";
  }
  if (pathname.includes("/logs/export")) {
    return "logs.export";
  }
  if (pathname.includes("/logs")) {
    return "logs.view";
  }
  if (pathname.includes("/analytics") || pathname.includes("/events")) {
    return "analytics.view";
  }
  if (pathname.startsWith("/api/projects")) {
    return "projects.view";
  }
  if (pathname.startsWith("/settings")) {
    return "settings.manage";
  }
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/projects")) {
    return "dashboard.view";
  }
  return null;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
