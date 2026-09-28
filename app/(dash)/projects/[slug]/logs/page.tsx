import { notFound, redirect } from "next/navigation";
import { LogViewer } from "@/components/logs/log-viewer";
import { Badge } from "@/components/ui/badge";
import { requirePrincipalFromCookieStore } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProjectBySlug } from "@/lib/projects";
import { countLogs, groupLogs, logFacets, queryLogs } from "@/lib/ingest";

export const dynamic = "force-dynamic";

export default async function ProjectLogsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const principal = await requirePrincipalFromCookieStore().catch(() => null);
  if (principal === null) {
    redirect("/login");
  }
  if (!can(principal, "logs.view")) {
    return (
      <p className="text-sm text-zinc-500">You do not have permission to view logs.</p>
    );
  }
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (project === null) {
    notFound();
  }
  const projectId = String(project._id);
  const [page, total, groups, facets] = await Promise.all([
    queryLogs(projectId, { limit: 50 }),
    countLogs(projectId),
    groupLogs(projectId, { limit: 25 }),
    logFacets(projectId),
  ]);

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <span aria-hidden className="text-2xl">
          {project.emoji}
        </span>
        <div>
          <h1 className="text-lg font-semibold">{project.name} · Logs</h1>
          <p className="text-xs text-zinc-500">
            Merged client and server stream. Click a trace id to follow one journey
            end-to-end.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge tone={project.ingestEnabled === false ? "red" : "green"}>
            ingest {project.ingestEnabled === false ? "off" : "on"}
          </Badge>
          <Badge tone="violet">{project.slug}</Badge>
        </div>
      </header>
      <LogViewer
        projectSlug={project.slug}
        initialLogs={page.logs}
        initialCursor={page.nextCursor}
        initialHasMore={page.hasMore}
        initialTotal={total}
        initialGroups={groups}
        environments={facets.environments}
        releases={facets.releases}
      />
    </div>
  );
}
