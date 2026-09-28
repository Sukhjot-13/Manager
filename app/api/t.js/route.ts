import type { NextRequest } from "next/server";
import { trackerResponse } from "@/lib/trackerHandler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  return trackerResponse(request);
}
