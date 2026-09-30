import { notFound, redirect } from "next/navigation";
import { NavigationLink as Link } from "@/components/ui/navigation-link";
import { ProjectAnalytics } from "@/components/analytics/project-analytics";
import { Badge } from "@/components/ui/badge";
import { requirePrincipalFromCookieStore } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProjectBySlug } from "@/lib/projects";
import { analyticsSummary } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export default async function ProjectAnalyticsPage({
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
      <p className="text-sm text-zinc-500">You do not have permission to view analytics.</p>
    );
  }
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (project === null) {
    notFound();
  }
  const summary = await analyticsSummary(String(project._id), { range: "7d" });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="text-2xl">
          {project.emoji}
        </span>
        <div>
          <h1 className="text-lg font-semibold">{project.name} · Analytics</h1>
          <p className="text-xs text-zinc-500">
            Pageviews, clicks, referrers, devices and countries from the embedded tracker.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge tone={project.analyticsEnabled === false ? "red" : "green"}>
            analytics {project.analyticsEnabled === false ? "off" : "on"}
          </Badge>
          <Link
            href={`/projects/${project.slug}/analytics/setup`}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Install tracker
          </Link>
          <Badge tone="violet">{project.slug}</Badge>
        </div>
      </header>
      <ProjectAnalytics
        projectSlug={project.slug}
        initial={summary}
        initialAnalyticsEnabled={project.analyticsEnabled !== false}
      />
    </div>
  );
}
