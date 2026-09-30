import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { NavigationLink as Link } from "@/components/ui/navigation-link";
import { TrackerSnippet } from "@/components/analytics/tracker-snippet";
import { Badge } from "@/components/ui/badge";
import { requirePrincipalFromCookieStore } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProjectBySlug } from "@/lib/projects";
import { listApiKeys } from "@/lib/keyManagement";

export const dynamic = "force-dynamic";

export default async function AnalyticsSetupPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const principal = await requirePrincipalFromCookieStore().catch(() => null);
  if (principal === null) {
    redirect("/login");
  }
  if (!can(principal, "analytics.view")) {
    return (
      <p className="text-sm text-zinc-500">You do not have permission to install the tracker.</p>
    );
  }
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (project === null) {
    notFound();
  }
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;
  const keys = await listApiKeys(String(project._id));
  const analyticsKey = keys.find((key) => key.kind === "analytics");

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="text-2xl">
          {project.emoji}
        </span>
        <div>
          <h1 className="text-lg font-semibold">{project.name} · Install tracker</h1>
          <p className="text-xs text-zinc-500">
            One script tag. Pageviews, SPA navigation, clicks, referrers and UTM
            campaigns.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`/projects/${project.slug}/analytics`}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Back to analytics
          </Link>
          <Badge tone={analyticsKey === undefined ? "amber" : "green"}>
            {analyticsKey === undefined ? "no analytics key" : analyticsKey.masked}
          </Badge>
        </div>
      </header>
      <TrackerSnippet
        origin={origin}
        slug={project.slug}
        maskedKey={analyticsKey?.masked ?? ""}
      />
    </div>
  );
}
