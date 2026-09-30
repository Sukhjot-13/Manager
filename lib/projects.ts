import { connectToDatabase } from "@/lib/db/connect";
import { ProjectModel, type ProjectDoc } from "@/lib/db/projects";
import { ApiKeyModel } from "@/lib/db/apikeys";
import { LogModel } from "@/lib/db/logs";
import { EventModel } from "@/lib/db/events";
import { SecretAuditModel, SecretModel } from "@/lib/db/secrets";
import { DailyStatModel } from "@/lib/db/ops";

export class ProjectSlugConflictError extends Error {
  constructor() {
    super("slug already in use");
    this.name = "ProjectSlugConflictError";
  }
}

export type ProjectInput = {
  name: string;
  slug?: string;
  description?: string;
  status?: ProjectDoc["status"];
  tags?: string[];
  color?: string;
  emoji?: string;
  links?: { type: "github" | "live" | "docs" | "other"; url: string; label?: string }[];
  notesMd?: string;
  githubRepo?: string;
  ingestEnabled?: boolean;
  analyticsEnabled?: boolean;
};

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) === "" ? "project" : slugify(base);
  let candidate = root;
  let suffix = 2;
  while ((await ProjectModel.exists({ slug: candidate })) !== null) {
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export type ProjectListFilters = {
  query?: string;
  status?: string;
  tag?: string;
};

export async function listProjects(
  filters: ProjectListFilters = {},
): Promise<ProjectDoc[]> {
  await connectToDatabase();
  const query: Record<string, unknown> = {};
  if (filters.status !== undefined && filters.status !== "" && filters.status !== "all") {
    query.status = filters.status;
  }
  if (filters.tag !== undefined && filters.tag !== "") {
    query.tags = filters.tag;
  }
  if (filters.query !== undefined && filters.query.trim() !== "") {
    const safe = filters.query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.$or = [
      { name: { $regex: safe, $options: "i" } },
      { description: { $regex: safe, $options: "i" } },
      { tags: { $regex: safe, $options: "i" } },
      { slug: { $regex: safe, $options: "i" } },
    ];
  }
  return ProjectModel.find(query).sort({ updatedAt: -1 }).lean();
}

export async function getProjectBySlug(slug: string): Promise<ProjectDoc | null> {
  await connectToDatabase();
  return ProjectModel.findOne({ slug: slug.toLowerCase() }).lean();
}

export async function getProjectById(id: string): Promise<ProjectDoc | null> {
  await connectToDatabase();
  if (!/^[a-f0-9]{24}$/i.test(id)) {
    return null;
  }
  return ProjectModel.findById(id).lean();
}

export async function createProject(input: ProjectInput): Promise<ProjectDoc> {
  await connectToDatabase();
  const slug =
    input.slug === undefined || input.slug.trim() === ""
      ? await uniqueSlug(input.name)
      : slugify(input.slug);
  if (slug === "") {
    throw new Error("invalid slug");
  }
  const duplicate = await ProjectModel.exists({ slug });
  if (duplicate !== null) {
    throw new ProjectSlugConflictError();
  }
  const created = await ProjectModel.create({
    name: input.name.trim(),
    slug,
    description: input.description ?? "",
    status: input.status ?? "idea",
    tags: input.tags ?? [],
    color: input.color ?? "#6366f1",
    emoji: input.emoji ?? "📁",
    links: input.links ?? [],
    notesMd: input.notesMd ?? "",
    githubRepo: input.githubRepo ?? "",
    ingestEnabled: input.ingestEnabled ?? true,
    analyticsEnabled: input.analyticsEnabled ?? true,
  });
  return created.toObject() as ProjectDoc;
}

export async function updateProject(
  slug: string,
  patch: Partial<ProjectInput>,
): Promise<ProjectDoc | null> {
  await connectToDatabase();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    update.name = patch.name.trim();
  }
  if (patch.slug !== undefined && patch.slug !== "") {
    const next = slugify(patch.slug);
    if (next === "") {
      throw new Error("invalid slug");
    }
    if (next !== slug.toLowerCase() && await ProjectModel.exists({ slug: next }) !== null) {
      throw new ProjectSlugConflictError();
    }
    update.slug = next;
  }
  for (const key of [
    "description",
    "status",
    "tags",
    "color",
    "emoji",
    "links",
    "notesMd",
    "githubRepo",
    "ingestEnabled",
    "analyticsEnabled",
  ] as const) {
    if (patch[key] !== undefined) {
      update[key] = patch[key];
    }
  }
  const updated = await ProjectModel.findOneAndUpdate(
    { slug: slug.toLowerCase() },
    { $set: update },
    { new: true },
  ).lean();
  return updated;
}

export async function deleteProject(slug: string): Promise<boolean> {
  await connectToDatabase();
  const project = await ProjectModel.findOneAndDelete({ slug: slug.toLowerCase() });
  if (project === null) {
    return false;
  }
  const id = project._id;
  await Promise.all([
    ApiKeyModel.deleteMany({ projectId: id }),
    LogModel.deleteMany({ projectId: id }),
    EventModel.deleteMany({ projectId: id }),
    SecretModel.deleteMany({ projectId: id }),
    SecretAuditModel.deleteMany({ projectId: id }),
    DailyStatModel.deleteMany({ projectId: id }),
  ]);
  return true;
}

export type ProjectSummary = {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: string;
  tags: string[];
  color: string;
  emoji: string;
  links: { type: string; url: string; label: string }[];
  notesMd: string;
  githubRepo: string;
  githubCache: Record<string, unknown> | null;
  ingestEnabled: boolean;
  analyticsEnabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export function serializeProject(project: ProjectDoc): ProjectSummary {
  return {
    id: String(project._id),
    name: project.name,
    slug: project.slug,
    description: project.description ?? "",
    status: project.status,
    tags: project.tags ?? [],
    color: project.color ?? "#6366f1",
    emoji: project.emoji ?? "📁",
    links: (project.links ?? []).map((link) => ({
      type: String(link.type),
      url: String(link.url),
      label: String(link.label ?? ""),
    })),
    notesMd: project.notesMd ?? "",
    githubRepo: project.githubRepo ?? "",
    githubCache:
      project.githubCache === undefined || project.githubCache === null
        ? null
        : (project.githubCache as unknown as Record<string, unknown>),
    ingestEnabled: project.ingestEnabled !== false,
    analyticsEnabled: project.analyticsEnabled !== false,
    createdAt:
      project.createdAt instanceof Date ? project.createdAt.toISOString() : null,
    updatedAt:
      project.updatedAt instanceof Date ? project.updatedAt.toISOString() : null,
  };
}
