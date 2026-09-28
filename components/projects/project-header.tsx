"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderGit2, Star, GitPullRequest, GitBranch, RefreshCw } from "lucide-react";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/permission-gate";
import { useToast } from "@/components/ui/toast";
import type { ProjectSummary } from "@/lib/projects";
import type { Principal } from "@/lib/permissions";

export function ProjectHeader({
  project,
  principal,
}: {
  project: ProjectSummary;
  principal: Principal;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const cache = project.githubCache;

  async function refreshGithub() {
    setRefreshing(true);
    const response = await fetch(`/api/projects/${project.slug}/github`, {
      method: "POST",
    });
    setRefreshing(false);
    if (response.ok) {
      push("GitHub data refreshed", "success");
      router.refresh();
      return;
    }
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    push(
      body.error === "no_repository"
        ? "Set a repository on this project first"
        : "Could not refresh GitHub data",
      "error",
    );
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-3xl" aria-hidden>
          {project.emoji}
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <p className="text-xs text-zinc-500">/{project.slug}</p>
        </div>
        <Badge tone={STATUS_TONE[project.status] ?? "neutral"}>{project.status}</Badge>
        {!project.ingestEnabled ? <Badge tone="red">ingest off</Badge> : null}
        {!project.analyticsEnabled ? (
          <Badge tone="amber">analytics off</Badge>
        ) : null}
      </div>
      {project.description !== "" ? (
        <p className="mt-3 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          {project.description}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {project.tags.map((tag) => (
          <Badge key={tag}>#{tag}</Badge>
        ))}
        {project.githubRepo !== "" ? (
          <a
            href={`https://github.com/${project.githubRepo}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            <FolderGit2 size={13} />
            {project.githubRepo}
          </a>
        ) : null}
        {cache !== null ? (
          <span className="inline-flex items-center gap-3 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <Star size={12} />
              {Number(cache.stars ?? 0)}
            </span>
            <span className="inline-flex items-center gap-1">
              <GitPullRequest size={12} />
              {Number(cache.openIssues ?? 0)}
            </span>
            <span className="inline-flex items-center gap-1">
              <GitBranch size={12} />
              {String(cache.defaultBranch ?? "—")}
            </span>
          </span>
        ) : null}
        {project.githubRepo !== "" ? (
          <PermissionGate permission="projects.edit">
            <Button
              variant="ghost"
              size="sm"
              onClick={refreshGithub}
              disabled={refreshing}
            >
              <RefreshCw size={12} />
              {refreshing ? "Refreshing" : "Refresh"}
            </Button>
          </PermissionGate>
        ) : null}
      </div>
      <p className="sr-only">{principal.email}</p>
    </div>
  );
}
