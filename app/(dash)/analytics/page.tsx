import { redirect } from "next/navigation";
import { AnalyticsOverview } from "@/components/analytics/overview";
import { requirePrincipalFromCookieStore } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { projectTotals } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const principal = await requirePrincipalFromCookieStore().catch(() => null);
  if (principal === null) {
    redirect("/login");
  }
  if (!can(principal, "analytics.view")) {
    return (
      <p className="text-sm text-zinc-500">
        You do not have permission to view analytics.
      </p>
    );
  }
  const totals = await projectTotals({ range: "7d" });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold">Analytics</h1>
        <p className="text-xs text-zinc-500">
          Every project with an embedded tracker. Daily rollups are recomputed on read and
          kept forever, so history survives the 90-day event TTL.
        </p>
      </header>
      <AnalyticsOverview initial={totals} />
    </div>
  );
}
