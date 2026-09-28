import { notFound, redirect } from "next/navigation";
import { SecretsPanel } from "@/components/secrets/secrets-panel";
import { Badge } from "@/components/ui/badge";
import { requirePrincipalFromCookieStore } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProjectBySlug } from "@/lib/projects";
import { auditTrail, listSecrets } from "@/lib/secrets";

export const dynamic = "force-dynamic";

export default async function ProjectEnvPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const principal = await requirePrincipalFromCookieStore().catch(() => null);
  if (principal === null) {
    redirect("/login");
  }
  if (!can(principal, "secrets.view")) {
    return (
      <p className="text-sm text-zinc-500">
        You do not have permission to view secrets.
      </p>
    );
  }
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (project === null) {
    notFound();
  }
  const projectId = String(project._id);
  const [secrets, audit] = await Promise.all([
    listSecrets(projectId),
    auditTrail(projectId, 25),
  ]);

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <span aria-hidden className="text-2xl">
          {project.emoji}
        </span>
        <div>
          <h1 className="text-lg font-semibold">{project.name} · Environment</h1>
          <p className="text-xs text-zinc-500">
            Values are encrypted at rest. Revealing a value is audited.
          </p>
        </div>
        <Badge tone="violet" className="ml-auto">
          {project.slug}
        </Badge>
      </header>
      <SecretsPanel
        projectSlug={project.slug}
        initialSecrets={secrets}
        initialAudit={audit}
      />
    </div>
  );
}
