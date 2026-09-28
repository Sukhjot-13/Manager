import { redirect } from "next/navigation";
import { ProjectList } from "@/components/projects/project-list";
import { requirePrincipalFromCookieStore } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listProjects, serializeProject } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const principal = await requirePrincipalFromCookieStore().catch(() => null);
  if (principal === null) {
    redirect("/login");
  }
  if (!can(principal, "projects.view")) {
    return <p className="text-sm text-zinc-500">You do not have permission to view projects.</p>;
  }
  const projects = (await listProjects()).map(serializeProject);
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Projects</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Every project with its keys, secrets, logs and analytics in one place.
      </p>
      <ProjectList projects={projects} />
    </div>
  );
}
