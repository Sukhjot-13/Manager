import { connectToDatabase } from "@/lib/db/connect";
import { ProjectModel } from "@/lib/db/projects";

export type GithubRepoInfo = {
  stars: number;
  openIssues: number;
  defaultBranch: string;
  lastPush: string;
  description: string;
  fetchedAt: string;
};

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { value: GithubRepoInfo; expiresAt: number }>();

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function parseRepoSlug(value: string): string | null {
  const trimmed = value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "");
  return REPO_PATTERN.test(trimmed) ? trimmed : null;
}

export async function fetchRepoInfo(repo: string): Promise<GithubRepoInfo | null> {
  const slug = parseRepoSlug(repo);
  if (slug === null) {
    return null;
  }
  const cached = cache.get(slug);
  if (cached !== undefined && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "manager-app",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token !== undefined && token !== "") {
    headers.authorization = `Bearer ${token}`;
  }
  try {
    const response = await fetch(`https://api.github.com/repos/${slug}`, {
      headers,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as {
      stargazers_count?: number;
      open_issues_count?: number;
      default_branch?: string;
      pushed_at?: string;
      description?: string | null;
    };
    const info: GithubRepoInfo = {
      stars: body.stargazers_count ?? 0,
      openIssues: body.open_issues_count ?? 0,
      defaultBranch: body.default_branch ?? "",
      lastPush: body.pushed_at ?? "",
      description: body.description ?? "",
      fetchedAt: new Date().toISOString(),
    };
    cache.set(slug, { value: info, expiresAt: Date.now() + CACHE_TTL_MS });
    return info;
  } catch {
    return null;
  }
}

export async function refreshProjectGithub(projectId: string): Promise<boolean> {
  await connectToDatabase();
  const project = await ProjectModel.findById(projectId).lean();
  if (project === null || project === undefined || project.githubRepo === "") {
    return false;
  }
  const info = await fetchRepoInfo(project.githubRepo);
  if (info === null) {
    return false;
  }
  await ProjectModel.updateOne(
    { _id: projectId },
    {
      $set: {
        githubCache: {
          stars: info.stars,
          openIssues: info.openIssues,
          defaultBranch: info.defaultBranch,
          lastPush: info.lastPush,
          description: info.description,
          fetchedAt: new Date(info.fetchedAt),
        },
      },
    },
  ).exec();
  return true;
}
