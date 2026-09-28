import crypto from "node:crypto";
import { connectToDatabase } from "@/lib/db/connect";
import { ApiKeyModel, KEY_PREFIXES, type ApiKeyDoc, type KeyKind } from "@/lib/db/apikeys";
import { ProjectModel } from "@/lib/db/projects";
import { timingSafeEqualString } from "@/lib/crypto";

const KEY_RANDOM_BYTES = 24;
const PREFIX_VISIBLE = 6;

export type GeneratedKey = {
  key: string;
  prefix: string;
  hash: string;
  kind: KeyKind;
};

export function keyPrefixOf(key: string): string {
  return key.slice(0, PREFIX_VISIBLE + 1);
}

export function generateApiKey(kind: KeyKind): GeneratedKey {
  const prefix = KEY_PREFIXES[kind];
  const secret = crypto.randomBytes(KEY_RANDOM_BYTES).toString("base64url");
  const key = `${prefix}_${secret}`;
  return { key, prefix: keyPrefixOf(key), hash: hashKey(key), kind };
}

export function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key, "utf8").digest("hex");
}

export type VerifiedKey = {
  keyId: string;
  projectId: string;
  projectSlug: string;
  kind: KeyKind;
  prefix: string;
  ingestEnabled: boolean;
  analyticsEnabled: boolean;
};

const KEY_PATTERN = /^(mlk|mck|mak)_/;

export async function verifyApiKey(key: string): Promise<VerifiedKey | null> {
  if (typeof key !== "string" || key.length < 16 || key.length > 200) {
    return null;
  }
  if (!KEY_PATTERN.test(key)) {
    return null;
  }
  const prefix = keyPrefixOf(key);
  await connectToDatabase();
  const candidates = await ApiKeyModel.find({
    prefix,
    revokedAt: { $exists: false },
  }).lean();
  const hash = hashKey(key);
  for (const candidate of candidates) {
    if (timingSafeEqualString(candidate.keyHash, hash)) {
      return attachProject(candidate);
    }
  }
  return null;
}

async function attachProject(
  candidate: ApiKeyDoc & { _id: unknown },
): Promise<VerifiedKey | null> {
  const project = await ProjectModel.findById(candidate.projectId).lean();
  if (project === null || project === undefined) {
    return null;
  }
  void ApiKeyModel.updateOne(
    { _id: candidate._id },
    { $set: { lastUsedAt: new Date() } },
  ).exec();
  return {
    keyId: String(candidate._id),
    projectId: String(project._id),
    projectSlug: project.slug,
    kind: candidate.kind as KeyKind,
    prefix: candidate.prefix,
    ingestEnabled: project.ingestEnabled !== false,
    analyticsEnabled: project.analyticsEnabled !== false,
  };
}

export function sourceForKind(kind: KeyKind): "client" | "server" {
  return kind === "client" ? "client" : "server";
}

export function kindCanWriteLogs(kind: KeyKind): boolean {
  return kind === "server" || kind === "client";
}

export function kindCanWriteEvents(kind: KeyKind): boolean {
  return kind === "analytics";
}

export function redactKey(key: string): string {
  const prefix = keyPrefixOf(key);
  return `${prefix}${"*".repeat(Math.max(0, key.length - prefix.length))}`;
}
