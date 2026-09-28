import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  clearedSessionCookieOptions,
} from "@/lib/session";

export async function POST(): Promise<Response> {
  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(SESSION_COOKIE, "", clearedSessionCookieOptions());
  return response;
}
