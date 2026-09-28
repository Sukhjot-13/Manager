import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/permission-gate";
import { ProjectForm } from "@/components/projects/project-form";
import { Markdown } from "@/components/ui/markdown";
import { requirePrincipalFromCookieStore } from "@/lib/auth";
import { getProjectBySlug, serializeProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const principal = await requirePrincipalFromCookieStore().catch(() => null);
  if (principal === null) {
    redirect("/login");
  }
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (project === null) {
    notFound();
  }
  const summary = serializeProject(project);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
            <PermissionGate permission="projects.edit">
              <ProjectForm project={summary} />
            </PermissionGate>
          </CardHeader>
          <CardContent>
            {summary.notesMd.trim() === "" ? (
              <p className="text-sm text-zinc-500">
                No notes yet. Add a changelog, reminders or TODOs for this project.
              </p>
            ) : (
              <Markdown source={summary.notesMd} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Links</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.links.length === 0 ? (
              <p className="text-sm text-zinc-500">No links yet.</p>
            ) : (
              <ul className="space-y-2">
                {summary.links.map((link) => (
                  <li key={`${link.type}-${link.url}`} className="flex items-center gap-2 text-sm">
                    <Badge>{link.type}</Badge>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-zinc-700 hover:underline dark:text-zinc-300"
                    >
                      {link.label === "" ? link.url : link.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ingest switches</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Log ingest</span>
              <Badge tone={summary.ingestEnabled ? "green" : "red"}>
                {summary.ingestEnabled ? "accepting" : "blocked"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Analytics ingest</span>
              <Badge tone={summary.analyticsEnabled ? "green" : "amber"}>
                {summary.analyticsEnabled ? "accepting" : "off"}
              </Badge>
            </div>
            <p className="pt-2 text-xs text-zinc-500">
              Kill switches stop writes immediately; existing data stays.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick links</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link href={`/projects/${summary.slug}/logs`}>
              <Button variant="outline" size="sm">
                Logs
              </Button>
            </Link>
            <Link href={`/projects/${summary.slug}/env`}>
              <Button variant="outline" size="sm">
                Env vault
              </Button>
            </Link>
            <Link href={`/projects/${summary.slug}/keys`}>
              <Button variant="outline" size="sm">
                API keys
              </Button>
            </Link>
            <Link href={`/projects/${summary.slug}/analytics`}>
              <Button variant="outline" size="sm">
                Analytics
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
