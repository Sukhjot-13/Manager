import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { IntegratePanel } from "@/components/logs/integrate-panel";
import { Badge } from "@/components/ui/badge";
import { requirePrincipalFromCookieStore } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProjectBySlug } from "@/lib/projects";
import { listApiKeys } from "@/lib/keyManagement";
import { getEmbedSnippet } from "@/lib/tracker";

export const dynamic = "force-dynamic";

export default async function ProjectIntegratePage({
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
      <p className="text-sm text-zinc-500">
        You do not have permission to view the integration setup.
      </p>
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
  const links = [
    { label: "API keys", href: `/projects/${project.slug}/keys` },
    { label: "Log viewer", href: `/projects/${project.slug}/logs` },
    { label: "Analytics", href: `/projects/${project.slug}/analytics` },
  ];

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <span aria-hidden className="text-2xl">
          {project.emoji}
        </span>
        <div>
          <h1 className="text-lg font-semibold">{project.name} · Integrate</h1>
          <p className="text-xs text-zinc-500">
            Vendor the single-file SDK with your project key, then initialize it once.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {keys.map((key) => (
            <Badge key={key.id} tone={key.kind === "client" ? "violet" : "blue"}>
              {key.masked}
            </Badge>
          ))}
          <Badge tone="violet">{project.slug}</Badge>
        </div>
      </header>
      <nav className="flex items-center gap-2 text-xs">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {link.label}
          </a>
        ))}
      </nav>
      <IntegratePanel
        origin={origin}
        projectSlug={project.slug}
        analytics={getEmbedSnippet({ origin, slug: project.slug })}
      />
    </div>
  );
}
