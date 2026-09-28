import { NextResponse } from "next/server";
import { checkReadiness } from "@/lib/readiness";

export async function GET() {
  const readiness = await checkReadiness();
  return NextResponse.json(
    {
      ok: readiness.setup === "ready",
      setup: readiness.setup,
      database: readiness.database.ok ? "connected" : readiness.database.error,
      missingEnv: readiness.env.missing,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
