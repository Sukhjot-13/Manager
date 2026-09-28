import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import { SecretAuditModel, SecretModel, type Environment } from "@/lib/db/secrets";
import {
  decrypt,
  encrypt,
  maskValue,
  reencryptWithNewKey,
  type EncryptedValue,
} from "@/lib/crypto";

export const CURRENT_KEY_VER = 1;
export const MAX_AUDIT_LIMIT = 200;
export const DEFAULT_AUDIT_LIMIT = 50;
export const MAX_IMPORT_BYTES = 200_000;

const KEY_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNREADABLE_MASK = "••••";

export type SecretRow = {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  environment: Environment;
  key: string;
  valueEnc: string;
  iv: string;
  tag: string;
  keyVer?: number | null;
  note?: string | null;
  updatedAt?: Date | null;
};

export type MaskedSecret = {
  id: string;
  environment: Environment;
  key: string;
  note: string;
  maskedValue: string;
  updatedAt: string | null;
};

export type RevealedSecret = {
  id: string;
  projectId: string;
  environment: Environment;
  key: string;
  value: string;
};

export type UpdatedSecret = MaskedSecret & { projectId: string };

export type SecretInput = {
  environment: Environment;
  key: string;
  value: string;
  note?: string;
};

export type SecretPatch = {
  value?: string;
  note?: string;
};

export type RemovedSecret = {
  id: string;
  projectId: string;
  environment: Environment;
  key: string;
};

export type EnvEntry = { key: string; value: string };

export type ParsedEnvFile = { entries: EnvEntry[]; errors: string[] };

export type ImportResult = {
  imported: number;
  skipped: number;
  errors: string[];
};

export type SecretAuditAction =
  | "reveal"
  | "copy"
  | "export"
  | "import"
  | "update"
  | "delete";

export type SecretActionInput = {
  projectId: string;
  action: SecretAuditAction;
  actor: string;
  ip?: string;
  secretId?: string;
  keyName?: string;
  environment?: string;
};

export type SecretAuditRow = {
  id: string;
  action: string;
  actor: string;
  keyName: string;
  environment: string;
  ip: string;
  ts: string | null;
};

export type RotationResult = {
  rotated: number;
  skipped: number;
  failed: number;
  newKeyVer: number;
  errors: string[];
};

export type RotationOptions = { keyVer?: number };

function objectIdOrNull(value: string): mongoose.Types.ObjectId | null {
  return /^[a-f0-9]{24}$/i.test(value) ? new mongoose.Types.ObjectId(value) : null;
}

function requireObjectId(value: string, label: string): mongoose.Types.ObjectId {
  const id = objectIdOrNull(value);
  if (id === null) {
    throw new Error(`invalid ${label}`);
  }
  return id;
}

function payloadOf(row: SecretRow): EncryptedValue {
  return {
    valueEnc: row.valueEnc,
    iv: row.iv,
    tag: row.tag,
    keyVer: row.keyVer ?? CURRENT_KEY_VER,
  };
}

function isoOrNull(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function stripSurroundingQuotes(value: string): string {
  if (value.length < 2) {
    return value;
  }
  const first = value.charAt(0);
  const last = value.charAt(value.length - 1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function formatEnvValue(value: string): string {
  if (value === "") {
    return '""';
  }
  if (/[\s#"'\\]/.test(value)) {
    return `"${value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")}"`;
  }
  return value;
}

function safeMaskedValue(row: SecretRow): string {
  try {
    return maskValue(decrypt(payloadOf(row)));
  } catch {
    return UNREADABLE_MASK;
  }
}

function toMasked(row: SecretRow): MaskedSecret {
  return {
    id: String(row._id),
    environment: row.environment,
    key: row.key,
    note: row.note ?? "",
    maskedValue: safeMaskedValue(row),
    updatedAt: isoOrNull(row.updatedAt),
  };
}

function toUpdated(row: SecretRow): UpdatedSecret {
  return { ...toMasked(row), projectId: String(row.projectId) };
}

export function parseEnvFile(content: string): ParsedEnvFile {
  const entries: EnvEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const lines = content.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    let line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      return;
    }
    if (/^export\s+/.test(line)) {
      line = line.replace(/^export\s+/, "").trim();
    }
    const separator = line.indexOf("=");
    if (separator < 0) {
      errors.push(`line ${lineNumber}: expected KEY=value`);
      return;
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (!KEY_NAME_PATTERN.test(key)) {
      errors.push(`line ${lineNumber}: invalid key name`);
      return;
    }
    if (rawValue === "") {
      errors.push(`line ${lineNumber}: empty value for ${key}`);
      return;
    }
    if (seen.has(key)) {
      errors.push(`line ${lineNumber}: duplicate key ${key} skipped`);
      return;
    }
    seen.add(key);
    entries.push({ key, value: stripSurroundingQuotes(rawValue) });
  });
  return { entries, errors };
}

export async function listSecrets(
  projectId: string,
  environment?: Environment,
): Promise<MaskedSecret[]> {
  const id = objectIdOrNull(projectId);
  if (id === null) {
    return [];
  }
  await connectToDatabase();
  const filter: Record<string, unknown> = { projectId: id };
  if (environment !== undefined) {
    filter.environment = environment;
  }
  const rows = await SecretModel.find(filter).sort({ environment: 1, key: 1 }).lean();
  return rows.map((row) => toMasked(row as SecretRow));
}

export async function upsertSecret(
  projectId: string,
  input: SecretInput,
): Promise<MaskedSecret> {
  const id = requireObjectId(projectId, "projectId");
  await connectToDatabase();
  const payload = encrypt(input.value, CURRENT_KEY_VER);
  const row = await SecretModel.findOneAndUpdate(
    { projectId: id, environment: input.environment, key: input.key },
    {
      $set: {
        valueEnc: payload.valueEnc,
        iv: payload.iv,
        tag: payload.tag,
        keyVer: payload.keyVer,
        note: input.note ?? "",
      },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean();
  if (row === null) {
    throw new Error("secret upsert failed");
  }
  return toMasked(row as SecretRow);
}

export async function updateSecret(
  id: string,
  patch: SecretPatch,
): Promise<UpdatedSecret | null> {
  const objectId = objectIdOrNull(id);
  if (objectId === null) {
    return null;
  }
  await connectToDatabase();
  const update: Record<string, unknown> = {};
  if (patch.value !== undefined) {
    const payload = encrypt(patch.value, CURRENT_KEY_VER);
    update.valueEnc = payload.valueEnc;
    update.iv = payload.iv;
    update.tag = payload.tag;
    update.keyVer = payload.keyVer;
  }
  if (patch.note !== undefined) {
    update.note = patch.note;
  }
  if (Object.keys(update).length === 0) {
    const existing = await SecretModel.findById(objectId).lean();
    return existing === null ? null : toUpdated(existing as SecretRow);
  }
  const row = await SecretModel.findByIdAndUpdate(
    objectId,
    { $set: update },
    { new: true, runValidators: true },
  ).lean();
  return row === null ? null : toUpdated(row as SecretRow);
}

export async function deleteSecret(id: string): Promise<RemovedSecret | null> {
  const objectId = objectIdOrNull(id);
  if (objectId === null) {
    return null;
  }
  await connectToDatabase();
  const row = await SecretModel.findOneAndDelete({ _id: objectId }).lean();
  if (row === null) {
    return null;
  }
  return {
    id: String(row._id),
    projectId: String(row.projectId),
    environment: row.environment,
    key: row.key,
  };
}

export async function importEnvFile(
  projectId: string,
  environment: Environment,
  content: string,
): Promise<ImportResult> {
  if (content.length > MAX_IMPORT_BYTES) {
    throw new Error("import payload too large");
  }
  requireObjectId(projectId, "projectId");
  await connectToDatabase();
  const { entries, errors } = parseEnvFile(content);
  let imported = 0;
  let skipped = 0;
  for (const entry of entries) {
    try {
      await upsertSecret(projectId, { environment, key: entry.key, value: entry.value });
      imported += 1;
    } catch {
      skipped += 1;
    }
  }
  return { imported, skipped, errors };
}

export async function logSecretAction(input: SecretActionInput): Promise<void> {
  const projectId = requireObjectId(input.projectId, "projectId");
  await connectToDatabase();
  await SecretAuditModel.create({
    secretId: input.secretId ?? String(projectId),
    projectId,
    action: input.action,
    actor: input.actor,
    keyName: input.keyName ?? "",
    environment: input.environment ?? "",
    ip: input.ip ?? "",
    ts: new Date(),
  });
}

export async function revealSecret(
  id: string,
  actor: string,
  ip: string,
): Promise<RevealedSecret | null> {
  const objectId = objectIdOrNull(id);
  if (objectId === null) {
    return null;
  }
  await connectToDatabase();
  const row = await SecretModel.findById(objectId).lean();
  if (row === null) {
    return null;
  }
  const secret = row as SecretRow;
  const value = decrypt(payloadOf(secret));
  await logSecretAction({
    secretId: String(secret._id),
    projectId: String(secret.projectId),
    environment: secret.environment,
    keyName: secret.key,
    action: "reveal",
    actor,
    ip,
  });
  return {
    id: String(secret._id),
    projectId: String(secret.projectId),
    environment: secret.environment,
    key: secret.key,
    value,
  };
}

export async function exportEnv(
  projectId: string,
  environment: Environment,
  actor: string,
  ip: string,
): Promise<string | null> {
  const id = requireObjectId(projectId, "projectId");
  await connectToDatabase();
  const rows = await SecretModel.find({ projectId: id, environment })
    .sort({ key: 1 })
    .lean();
  if (rows.length === 0) {
    return null;
  }
  const lines = rows.map((raw) => {
    const row = raw as SecretRow;
    return `${row.key}=${formatEnvValue(decrypt(payloadOf(row)))}`;
  });
  await logSecretAction({
    secretId: String((rows[0] as SecretRow)._id),
    projectId,
    environment,
    keyName: `${rows.length} keys`,
    action: "export",
    actor,
    ip,
  });
  return `${lines.join("\n")}\n`;
}

export async function auditTrail(
  projectId: string,
  limit: number = DEFAULT_AUDIT_LIMIT,
): Promise<SecretAuditRow[]> {
  const id = objectIdOrNull(projectId);
  if (id === null) {
    return [];
  }
  await connectToDatabase();
  const requested = Number.isFinite(limit) ? Math.trunc(limit) : DEFAULT_AUDIT_LIMIT;
  const capped = Math.min(Math.max(requested, 1), MAX_AUDIT_LIMIT);
  const rows = await SecretAuditModel.find({ projectId: id })
    .sort({ ts: -1 })
    .limit(capped)
    .lean();
  return rows.map((row) => ({
    id: String(row._id),
    action: String(row.action),
    actor: row.actor ?? "",
    keyName: row.keyName ?? "",
    environment: row.environment ?? "",
    ip: row.ip ?? "",
    ts: isoOrNull(row.ts),
  }));
}

export async function rotateMasterKey(
  newKeyHex: string,
  options: RotationOptions = {},
): Promise<RotationResult> {
  const candidate = typeof newKeyHex === "string" ? newKeyHex.trim() : "";
  if (!/^[0-9a-fA-F]{64}$/.test(candidate)) {
    throw new Error("new master key must be 64 hex characters");
  }
  const requestedVer = options.keyVer;
  if (
    requestedVer !== undefined &&
    (!Number.isInteger(requestedVer) || requestedVer < 1)
  ) {
    throw new Error("rotation key version must be a positive integer");
  }
  await connectToDatabase();
  const [summary] = await SecretModel.aggregate<{ max: number | null }>([
    { $group: { _id: null, max: { $max: "$keyVer" } } },
  ]);
  const newKeyVer = requestedVer ?? (summary?.max ?? 0) + 1;
  const rows = (await SecretModel.find(
    {},
    { valueEnc: 1, iv: 1, tag: 1, keyVer: 1 },
  ).lean()) as SecretRow[];
  let rotated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const row of rows) {
    if ((row.keyVer ?? CURRENT_KEY_VER) >= newKeyVer) {
      skipped += 1;
      continue;
    }
    try {
      const next = reencryptWithNewKey(payloadOf(row), candidate, newKeyVer);
      const result = await SecretModel.updateOne(
        { _id: row._id, keyVer: { $ne: newKeyVer } },
        {
          $set: {
            valueEnc: next.valueEnc,
            iv: next.iv,
            tag: next.tag,
            keyVer: next.keyVer,
          },
        },
      ).exec();
      if (result.modifiedCount === 1) {
        rotated += 1;
      } else {
        skipped += 1;
      }
    } catch {
      failed += 1;
      errors.push(String(row._id));
    }
  }
  return { rotated, skipped, failed, newKeyVer, errors };
}
