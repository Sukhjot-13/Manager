import { NextRequest, NextResponse } from "next/server";
import { buildCsp, generateNonce } from "@/lib/csp";

const CSP_HEADER = "content-security-policy";
const NONCE_HEADER = "x-nonce";

export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp(nonce, process.env.NODE_ENV !== "production");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_HEADER, csp);
  requestHeaders.set(NONCE_HEADER, nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set(CSP_HEADER, csp);

  return response;
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
