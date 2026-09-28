import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { requirePrincipalFromCookieStore } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listProjects, serializeProject } from "@/lib/projects";
import { listAllApiKeys } from "@/lib/keyManagement";
import { listUsers } from "@/lib/users";
import { getSettings } from "@/lib/settings";
import { countLogs } from "@/lib/ingest";
import { projectTotals } from "@/lib/analytics";
import { AppPing } from "@/components/dashboard/app-ping";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const principal = await requirePrincipalFromCookieStore().catch(() => null);
  if (principal === null) {
    redirect("/login");
  }
  const projects = (await listProjects()).map(serializeProject);
  const settings = await getSettings();
  const totals = (await projectTotals({ range: "30d" })).totals;
  const keys = can(principal, "keys.view") ? await listAllApiKeys({}) : [];
  const users = can(principal, "users.manage") ? await listUsers() : [];
  const recentLogs = can(principal, "logs.view")
    ? await Promise.all(
        projects.slice(0, 6).map(async (project) => ({
          slug: project.slug,
          name: project.name,
          count: await countLogs(project.id, {}),
        })),
      )
    : [];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-zinc-500">
            Signed in as {principal.email} · {principal.role}
          </p>
        </div>
        <AppPing />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Projects" value={projects.length} />
        <StatCard
          label="Pageviews (30d)"
          value={totals.pageviews}
          href={can(principal, "analytics.view") ? "/analytics" : undefined}
        />
        <StatCard label="Visitors (30d)" value={totals.visitors} />
        <StatCard
          label="API keys"
          value={keys.filter((key) => key.revokedAt === null).length}
          href={can(principal, "keys.view") ? "/settings/keys" : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Projects</CardTitle>
            <Link href="/projects" className="text-xs text-zinc-500 hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No projects yet. Create one to attach API keys, secrets and analytics.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {projects.slice(0, 8).map((project) => (
                  <li
                    key={project.id}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <Link
                      href={`/projects/${project.slug}`}
                      className="flex items-center gap-2 text-sm font-medium hover:underline"
                    >
                      <span aria-hidden>{project.emoji}</span>
                      {project.name}
                    </Link>
                    <div className="flex items-center gap-2">
                      {recentLogs
                        .filter((entry) => entry.slug === project.slug)
                        .map((entry) => (
                          <span key={entry.slug} className="text-xs text-zinc-500">
                            {entry.count} logs
                          </span>
                        ))}
                      <Badge tone={STATUS_TONE[project.status] ?? "neutral"}>
                        {project.status}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Ingest</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Log ingest" on={settings.ingestEnabled} />
              <Row label="Analytics ingest" on={settings.analyticsEnabled} />
              <Row
                label="Per-project log ingest"
                on={projects.length > 0 && projects.every((project) => project.ingestEnabled)}
              />
              <p className="pt-1 text-xs text-zinc-500">
                Global kill switches live in{" "}
                {can(principal, "settings.manage") ? (
                  <Link href="/settings" className="underline">
                    settings
                  </Link>
                ) : (
                  "settings"
                )}
                .
              </p>
            </CardContent>
          </Card>

          {users.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Users</CardTitle>
                {can(principal, "users.manage") ? (
                  <Link href="/settings/users" className="text-xs text-zinc-500 hover:underline">
                    Manage
                  </Link>
                ) : null}
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {users.map((user) => (
                    <li key={user.id} className="flex items-center justify-between">
                      <span className="truncate">{user.email}</span>
                      <Badge tone={user.role === "ADMIN" ? "violet" : "neutral"}>
                        {user.role}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href?: string;
}) {
  const body = (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
  return href === undefined ? body : <Link href={href}>{body}</Link>;
}

function Row({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <Badge tone={on ? "green" : "red"}>{on ? "on" : "off"}</Badge>
    </div>
  );
}
