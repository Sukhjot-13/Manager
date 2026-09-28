import { redirect } from "next/navigation";
import { KeysPanel } from "@/components/logs/keys-panel";
import { Badge } from "@/components/ui/badge";
import { requirePrincipalFromCookieStore } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listAllApiKeys } from "@/lib/keyManagement";

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
  const projects = new Set(keys.map((row) => row.projectSlug).filter((slug) => slug !== ""));

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">API keys</h1>
          <p className="text-xs text-zinc-500">
            Every key across {projects.size} project{projects.size === 1 ? "" : "s"}. Full
            values are never recoverable — only prefixes are stored.
          </p>
        </div>
        <Badge tone="violet" className="ml-auto">
          {keys.length} keys
        </Badge>
      </header>
      <KeysPanel initialKeys={keys} showProjectColumn basePath="/api/keys" />
    </div>
  );
}
