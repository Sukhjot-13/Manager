import type { NextRequest } from "next/server";
import { authorize, errorResponse } from "@/lib/auth";
import { IngestError } from "@/lib/ingest";
import { projectTotals } from "@/lib/analytics";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest): Promise<Response> {
  try {
    await authorize(request, "analytics.view");
    const params = request.nextUrl.searchParams;
    const totals = await projectTotals({
      range: params.get("range") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
    });
    return Response.json(totals, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof IngestError) {
      return Response.json(
        { error: error.code },
        { status: error.status, headers: NO_STORE },
      );
    }
    return errorResponse(error);
  }
}
