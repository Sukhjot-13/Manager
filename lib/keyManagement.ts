import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import { ApiKeyModel, type KeyKind } from "@/lib/db/apikeys";
import { ProjectModel } from "@/lib/db/projects";
import { generateApiKey, type GeneratedKey } from "@/lib/apiKeys";

export const MASK_TAIL = "••••••••";
export const MAX_KEY_GENERATION_ATTEMPTS = 32;

export type MaskedApiKey = {
  id: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  name: string;
  kind: KeyKind;
  prefix: string;
  masked: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type CreatedApiKey = MaskedApiKey & { key: string };

export type KeyInput = {
  projectId: string;
  name: string;
  kind: KeyKind;
};

export class KeyError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function objectIdOrNull(value: string): mongoose.Types.ObjectId | null {
  return /^[a-f0-9]{24}$/i.test(value) ? new mongoose.Types.ObjectId(value) : null;
}

function isoOrNull(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

export function maskKeyPrefix(prefix: string): string {
  return `${prefix}${MASK_TAIL}`;
}

export function isVerifiablePrefix(prefix: string): boolean {
  return prefix.split("_").length === 2;
}

export function generateVerifiableApiKey(kind: KeyKind): GeneratedKey {
  for (let attempt = 0; attempt < MAX_KEY_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = generateApiKey(kind);
    if (isVerifiablePrefix(candidate.prefix)) {
      return candidate;
    }
  }
  throw new KeyError(
    "key_generation_failed",
    500,
    "could not generate a verifiable api key",
  );
}

export async function createApiKey(input: KeyInput): Promise<CreatedApiKey> {
  const projectId = objectIdOrNull(input.projectId);
  if (projectId === null) {
    throw new KeyError("invalid_project", 400, "invalid project id");
  }
  await connectToDatabase();
  const project = await ProjectModel.findById(projectId).lean();
  if (project === null || project === undefined) {
    throw new KeyError("not_found", 404, "project not found");
  }
  const generated = generateVerifiableApiKey(input.kind);
  const created = await ApiKeyModel.create({
    projectId,
    name: input.name.trim(),
    kind: input.kind,
    keyHash: generated.hash,
    prefix: generated.prefix,
  });
  const row = created.toObject() as unknown as {
    _id: mongoose.Types.ObjectId;
    createdAt?: Date;
    lastUsedAt?: Date | null;
    revokedAt?: Date | null;
  };
  return {
    id: String(row._id),
    projectId: String(project._id),
    projectSlug: project.slug,
    projectName: project.name,
    name: input.name.trim(),
    kind: input.kind,
    prefix: generated.prefix,
    masked: maskKeyPrefix(generated.prefix),
    createdAt: isoOrNull(row.createdAt),
    lastUsedAt: isoOrNull(row.lastUsedAt),
    revokedAt: isoOrNull(row.revokedAt),
    key: generated.key,
  };
}

function toMasked(
  row: Record<string, unknown>,
  project: { id: string; slug: string; name: string } | null,
): MaskedApiKey {
  const prefix = String(row.prefix ?? "");
  return {
    id: String(row._id),
    projectId: String(row.projectId ?? ""),
    projectSlug: project?.slug ?? "",
    projectName: project?.name ?? "",
    name: String(row.name ?? ""),
    kind: row.kind as KeyKind,
    prefix,
    masked: maskKeyPrefix(prefix),
    createdAt: isoOrNull(row.createdAt),
    lastUsedAt: isoOrNull(row.lastUsedAt),
    revokedAt: isoOrNull(row.revokedAt),
  };
}

export async function listApiKeys(
  projectId: string,
  options: { includeRevoked?: boolean } = {},
): Promise<MaskedApiKey[]> {
  const id = objectIdOrNull(projectId);
  if (id === null) {
    return [];
  }
  await connectToDatabase();
  const filter: Record<string, unknown> = { projectId: id };
  if (options.includeRevoked !== true) {
    filter.revokedAt = { $exists: false };
  }
  const rows = await ApiKeyModel.find(filter).sort({ createdAt: -1 }).lean();
  const project = await ProjectModel.findById(id).lean();
  const info =
    project === null || project === undefined
      ? null
      : { id: String(project._id), slug: project.slug, name: project.name };
  return rows.map((row) => toMasked(row as unknown as Record<string, unknown>, info));
}

export async function listAllApiKeys(
  options: { includeRevoked?: boolean; projectId?: string; kind?: KeyKind } = {},
): Promise<MaskedApiKey[]> {
  await connectToDatabase();
  const filter: Record<string, unknown> = {};
  if (options.includeRevoked !== true) {
    filter.revokedAt = { $exists: false };
  }
  if (options.projectId !== undefined && options.projectId !== "") {
    const id = objectIdOrNull(options.projectId);
    if (id === null) {
      return [];
    }
    filter.projectId = id;
  }
  if (options.kind !== undefined) {
    filter.kind = options.kind;
  }
  const rows = await ApiKeyModel.find(filter).sort({ createdAt: -1 }).lean();
  const projects = await ProjectModel.find({}, { slug: 1, name: 1 }).lean();
  const byId = new Map(
    projects.map((project) => [
      String(project._id),
      { id: String(project._id), slug: project.slug, name: project.name },
    ]),
  );
  return rows.map((row) => {
    const raw = row as unknown as Record<string, unknown>;
    return toMasked(raw, byId.get(String(raw.projectId ?? "")) ?? null);
  });
}

export async function revokeApiKey(id: string): Promise<MaskedApiKey | null> {
  const objectId = objectIdOrNull(id);
  if (objectId === null) {
    return null;
  }
  await connectToDatabase();
  const row = await ApiKeyModel.findOneAndUpdate(
    { _id: objectId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
    { new: true },
  ).lean();
  if (row === null) {
    const existing = await ApiKeyModel.findById(objectId).lean();
    if (existing === null) {
      return null;
    }
    return toMasked(existing as unknown as Record<string, unknown>, null);
  }
  return toMasked(row as unknown as Record<string, unknown>, null);
}

export async function deleteApiKey(id: string): Promise<boolean> {
  const objectId = objectIdOrNull(id);
  if (objectId === null) {
    return false;
  }
  await connectToDatabase();
  const result = await ApiKeyModel.deleteOne({ _id: objectId });
  return result.deletedCount === 1;
}
