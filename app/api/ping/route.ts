import { NextResponse } from "next/server";
import { checkReadiness } from "@/lib/readiness";
import { vaultKeyStatus } from "@/lib/crypto";

export async function GET() {
  const readiness = await checkReadiness();
  return NextResponse.json(
    {
      ok: readiness.setup === "ready",
      setup: readiness.setup,
      database: readiness.database.ok ? "connected" : readiness.database.error,
      databaseKind: readiness.database.kind,
      missingEnv: readiness.env.missing,
      vaultEncryption: vaultKeyStatus(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
