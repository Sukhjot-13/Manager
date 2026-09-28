import { notFound, redirect } from "next/navigation";
import { KeysPanel } from "@/components/logs/keys-panel";
import { Badge } from "@/components/ui/badge";
import { requirePrincipalFromCookieStore } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listApiKeys } from "@/lib/keyManagement";
import { getProjectBySlug } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function ProjectKeysPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const principal = await requirePrincipalFromCookieStore().catch(() => null);
  if (principal === null) {
    redirect("/login");
  }
  if (!can(principal, "keys.view")) {
    return (
      <p className="text-sm text-zinc-500">You do not have permission to view API keys.</p>
    );
  }
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (project === null) {
    notFound();
  }
  const keys = await listApiKeys(String(project._id), { includeRevoked: true });

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <span aria-hidden className="text-2xl">
          {project.emoji}
        </span>
        <div>
          <h1 className="text-lg font-semibold">{project.name} · API keys</h1>
          <p className="text-xs text-zinc-500">
            Keys are stored hashed. A key is shown in full once, at creation, and can be
            revoked at any time.
          </p>
        </div>
        <Badge tone="violet" className="ml-auto">
          {project.slug}
        </Badge>
      </header>
      <KeysPanel
        initialKeys={keys}
        basePath={`/api/projects/${project.slug}/keys`}
      />
    </div>
  );
}
