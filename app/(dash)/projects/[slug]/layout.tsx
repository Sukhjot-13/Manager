import { NavigationLink as Link } from "@/components/ui/navigation-link";
import { notFound, redirect } from "next/navigation";
import type { Principal } from "@/lib/permissions";
import { getProjectBySlug, serializeProject } from "@/lib/projects";
import { requirePrincipalFromCookieStore } from "@/lib/auth";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { ProjectHeader } from "@/components/projects/project-header";

export const dynamic = "force-dynamic";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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
  return (
    <div>
      <Link
        href="/projects"
        className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        ← All projects
      </Link>
      <ProjectHeader project={serializeProject(project)} principal={principal} />
      <ProjectTabs
        slug={project.slug}
        principal={principal as Principal}
      />
      <div className="mt-6">{children}</div>
    </div>
  );
}
