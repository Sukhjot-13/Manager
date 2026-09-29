import { redirect } from "next/navigation";
import { KeysPanel } from "@/components/logs/keys-panel";
import { Badge } from "@/components/ui/badge";
import { requirePrincipalFromCookieStore } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listAllApiKeys } from "@/lib/keyManagement";
import { listProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function SettingsKeysPage() {
  const principal = await requirePrincipalFromCookieStore().catch(() => null);
  if (principal === null) {
    redirect("/login");
  }
  if (!can(principal, "keys.view")) {
    return (
      <p className="text-sm text-zinc-500">You do not have permission to view API keys.</p>
    );
  }
  const keys = await listAllApiKeys({ includeRevoked: true });
  // The project list comes from the projects themselves, not from the keys: a project with
  // no keys yet must still be selectable when issuing its first key.
  const allProjects = can(principal, "keys.manage") ? await listProjects() : [];

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">API keys</h1>
          <p className="text-xs text-zinc-500">
            Every key across {allProjects.length} project{allProjects.length === 1 ? "" : "s"}.
            Full values are never recoverable — only prefixes are stored.
          </p>
        </div>
        <Badge tone="violet" className="ml-auto">
          {keys.length} keys
        </Badge>
      </header>
      <KeysPanel
        initialKeys={keys}
        showProjectColumn
        basePath="/api/keys"
        projects={allProjects.map((project) => ({
          id: String(project._id),
          name: project.name,
          slug: project.slug,
        }))}
      />
    </div>
  );
}
