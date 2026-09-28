"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LayoutGrid, List, Search, Trash2 } from "lucide-react";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { PermissionGate } from "@/components/permission-gate";
import { ProjectForm } from "@/components/projects/project-form";
import { PROJECT_STATUSES } from "@/lib/db/projects";
import type { ProjectSummary } from "@/lib/projects";

export function ProjectList({ projects }: { projects: ProjectSummary[] }) {
  const { push } = useToast();
  const [view, setView] = useState<"grid" | "table">("grid");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [confirmSlug, setConfirmSlug] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter((project) => {
      if (status !== "all" && project.status !== status) {
        return false;
      }
      if (needle === "") {
        return true;
      }
      return (
        project.name.toLowerCase().includes(needle) ||
        project.slug.includes(needle) ||
        project.description.toLowerCase().includes(needle) ||
        project.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
  }, [projects, query, status]);

  async function remove(slug: string) {
    setPending(true);
    const response = await fetch(`/api/projects/${slug}`, { method: "DELETE" });
    setPending(false);
    setConfirmSlug(null);
    if (response.ok) {
      push("Project deleted", "success");
      window.location.reload();
      return;
    }
    push("Could not delete project", "error");
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-2.5 text-zinc-400"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects, tags, descriptions"
            className="pl-8"
            aria-label="Search projects"
          />
        </div>
        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Filter by status"
          className="w-36"
        >
          <option value="all">all statuses</option>
          {PROJECT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Button
          variant={view === "grid" ? "secondary" : "ghost"}
          size="icon"
          onClick={() => setView("grid")}
          aria-label="Grid view"
        >
          <LayoutGrid size={15} />
        </Button>
        <Button
          variant={view === "table" ? "secondary" : "ghost"}
          size="icon"
          onClick={() => setView("table")}
          aria-label="Table view"
        >
          <List size={15} />
        </Button>
        <PermissionGate permission="projects.create">
          <ProjectForm />
        </PermissionGate>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {projects.length === 0
            ? "No projects yet — create your first one to start attaching keys, secrets and analytics."
            : "Nothing matches those filters."}
        </p>
      ) : null}

      {view === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project) => (
            <div
              key={project.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950"
            >
              <Link href={`/projects/${project.slug}`} className="block">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-2xl" aria-hidden>
                    {project.emoji}
                  </span>
                  <Badge tone={STATUS_TONE[project.status] ?? "neutral"}>
                    {project.status}
                  </Badge>
                </div>
                <h2 className="mt-2 font-semibold">{project.name}</h2>
                <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                  {project.description === "" ? "No description" : project.description}
                </p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {project.tags.slice(0, 4).map((tag) => (
                    <Badge key={tag}>#{tag}</Badge>
                  ))}
                </div>
              </Link>
              <div className="mt-3 flex justify-end">
                <PermissionGate permission="projects.delete">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmSlug(project.slug)}
                  >
                    <Trash2 size={12} />
                    Delete
                  </Button>
                </PermissionGate>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
          <Table>
            <THead>
              <TR>
                <TH>Project</TH>
                <TH>Status</TH>
                <TH>Tags</TH>
                <TH>Updated</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {filtered.map((project) => (
                <TR key={project.id}>
                  <TD>
                    <Link
                      href={`/projects/${project.slug}`}
                      className="font-medium hover:underline"
                    >
                      {project.emoji} {project.name}
                    </Link>
                    <p className="text-xs text-zinc-500">/{project.slug}</p>
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[project.status] ?? "neutral"}>
                      {project.status}
                    </Badge>
                  </TD>
                  <TD className="text-xs text-zinc-500">
                    {project.tags.join(", ") || "—"}
                  </TD>
                  <TD className="text-xs text-zinc-500">
                    {project.updatedAt === null
                      ? "—"
                      : new Date(project.updatedAt).toLocaleDateString()}
                  </TD>
                  <TD className="text-right">
                    <PermissionGate permission="projects.delete">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmSlug(project.slug)}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </PermissionGate>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}

      <Dialog
        open={confirmSlug !== null}
        onClose={() => setConfirmSlug(null)}
        title="Delete project"
        description="This also deletes its API keys, secrets, logs, events and rollups. It cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmSlug(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => {
                if (confirmSlug !== null) {
                  void remove(confirmSlug);
                }
              }}
            >
              {pending ? "Deleting…" : "Delete permanently"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Type nothing, just confirm — the project and all of its data are removed.
        </p>
      </Dialog>
    </div>
  );
}
