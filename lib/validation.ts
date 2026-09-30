import { z } from "zod";
import { LINK_TYPES, PROJECT_STATUSES } from "@/lib/projectTypes";
import { ENVIRONMENTS } from "@/lib/db/secrets";
import { KEY_KINDS } from "@/lib/db/apikeys";
import { LOG_LEVELS } from "@/lib/db/logs";
import { EVENT_TYPES } from "@/lib/db/events";

const MAX_MESSAGE = 1024;
export const MAX_META_BYTES = 8 * 1024;
export const MAX_BODY_BYTES = 128 * 1024;
export const MAX_LOG_BATCH = 100;
export const MAX_EVENT_BATCH = 100;
export const MAX_TS_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_TS_FUTURE_MS = 10 * 60 * 1000;

const safeString = (max: number) => z.string().max(max);

export const slugSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters and numbers separated by hyphens, e.g. resume-builder.");

export const linkSchema = z.object({
  type: z.enum(LINK_TYPES),
  url: z.string().url("Enter a complete URL, e.g. https://example.com.").max(500)
    .refine((value) => !URL.canParse(value) || ["http:", "https:"].includes(new URL(value).protocol),
      "Use an http:// or https:// project URL."),
  label: z.string().max(80).default(""),
});

function normalizeOptionalProjectSlug(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

// Keep update validation free of creation defaults: a links-only PATCH must not
// clear omitted notes, tags or other project settings.
const projectFields = {
  name: z.string({ error: "Enter a project name." }).trim().min(1, "Enter a project name.").max(80, "Use 80 characters or fewer."),
  slug: z.preprocess(normalizeOptionalProjectSlug, slugSchema.optional()),
  description: z.string().max(1000),
  status: z.enum(PROJECT_STATUSES),
  tags: z.array(z.string().max(30)).max(20),
  color: z.string().max(20),
  emoji: z.string().max(8),
  links: z.array(linkSchema).max(20),
  notesMd: z.string().max(20_000),
  githubRepo: z.string().max(200),
};

export const projectCreateSchema = z.object({
  ...projectFields,
  description: projectFields.description.default(""),
  status: projectFields.status.default("idea"),
  tags: projectFields.tags.default([]),
  color: projectFields.color.default("#6366f1"),
  emoji: projectFields.emoji.default("📁"),
  links: projectFields.links.default([]),
  notesMd: projectFields.notesMd.default(""),
  githubRepo: projectFields.githubRepo.default(""),
});

export const projectUpdateSchema = z.object(projectFields).partial().extend({
  ingestEnabled: z.boolean().optional(),
  analyticsEnabled: z.boolean().optional(),
});

const jsonish = z.union([
  z.string().max(MAX_META_BYTES),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const logEntrySchema = z
  .object({
    level: z.enum(LOG_LEVELS),
    message: z.string().min(1).max(MAX_MESSAGE),
    meta: jsonish.optional(),
    stack: z.string().max(8000).optional(),
    ts: z.union([z.string(), z.number()]).optional(),
    sessionId: z.string().max(80).optional(),
    pageId: z.string().max(80).optional(),
    traceId: z.string().max(80).optional(),
    requestId: z.string().max(80).optional(),
    url: safeString(500).optional(),
    route: safeString(200).optional(),
    referrer: safeString(500).optional(),
    ua: safeString(500).optional(),
    viewport: safeString(40).optional(),
    lang: safeString(40).optional(),
    tz: safeString(60).optional(),
    connection: safeString(40).optional(),
    appVersion: safeString(60).optional(),
    environment: safeString(40).optional(),
    release: safeString(80).optional(),
    hostname: safeString(120).optional(),
    pid: z.number().int().nonnegative().max(4_000_000).optional(),
    runtimeVersion: safeString(60).optional(),
    rssMb: z.number().min(0).max(1_000_000).optional(),
    uptimeSec: z.number().min(0).max(1e9).optional(),
    durationMs: z.number().min(0).max(1e9).optional(),
  })
  .strict();

export const logIngestSchema = z.object({
  logs: z.array(logEntrySchema).min(1).max(MAX_LOG_BATCH),
});

export const eventEntrySchema = z
  .object({
    type: z.enum(EVENT_TYPES),
    name: z.string().max(120).default(""),
    path: z.string().max(500).default(""),
    props: jsonish.optional(),
    sessionId: z.string().max(80).optional(),
    referrer: z.string().max(500).default(""),
    utm: z
      .object({
        source: z.string().max(120).default(""),
        medium: z.string().max(120).default(""),
        campaign: z.string().max(120).default(""),
        term: z.string().max(120).default(""),
        content: z.string().max(120).default(""),
      })
      .partial()
      .optional(),
    ua: z.string().max(500).default(""),
    ts: z.union([z.string(), z.number()]).optional(),
  })
  .strict();

export const eventIngestSchema = z.object({
  events: z.array(eventEntrySchema).min(1).max(MAX_EVENT_BATCH),
  key: z.string().min(8).max(200).optional(),
});

export const secretUpsertSchema = z.object({
  environment: z.enum(ENVIRONMENTS),
  key: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "key must be a valid env var name"),
  value: z.string().min(1).max(20_000),
  note: z.string().max(200).default(""),
});

export const secretImportSchema = z.object({
  environment: z.enum(ENVIRONMENTS),
  content: z.string().min(1).max(200_000),
});

export const secretUpdateSchema = z.object({
  value: z.string().min(1).max(20_000).optional(),
  note: z.string().max(200).optional(),
});

export const apiKeyCreateSchema = z.object({
  name: z.string().min(1).max(60),
  kind: z.enum(KEY_KINDS),
});

export const logQuerySchema = z.object({
  levels: z.array(z.enum(LOG_LEVELS)).max(LOG_LEVELS.length).optional(),
  source: z.enum(["client", "server", "all"]).default("all"),
  environment: z.string().max(40).optional(),
  release: z.string().max(80).optional(),
  search: z.string().max(200).optional(),
  sessionId: z.string().max(80).optional(),
  traceId: z.string().max(80).optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
  group: z.coerce.boolean().default(false),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const analyticsQuerySchema = z.object({
  range: z.enum(["today", "7d", "30d", "custom"]).default("7d"),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const userCreateSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().max(80).default(""),
  password: z.string().min(10).max(200),
  role: z.enum(["ADMIN", "DEVELOPER", "USER"]),
  overrides: z.record(z.string(), z.enum(["allow", "deny"])).default({}),
  permissionManagement: z
    .object({
      enabled: z.boolean().default(false),
      minTargetRank: z.number().int().min(1).max(1000).default(100),
      allowedPermissions: z.array(z.string().max(60)).max(50).default([]),
    })
    .optional(),
});

export const userUpdateSchema = z.object({
  name: z.string().max(80).optional(),
  password: z.string().min(10).max(200).optional(),
  disabled: z.boolean().optional(),
  overrides: z.record(z.string(), z.enum(["allow", "deny"])).optional(),
  permissionManagement: z
    .object({
      enabled: z.boolean(),
      minTargetRank: z.number().int().min(1).max(1000),
      allowedPermissions: z.array(z.string().max(60)).max(50),
    })
    .optional(),
});

export const settingsUpdateSchema = z.object({
  ingestEnabled: z.boolean().optional(),
  analyticsEnabled: z.boolean().optional(),
  maxLogBatch: z.number().int().min(1).max(MAX_LOG_BATCH).optional(),
  maxEventBatch: z.number().int().min(1).max(MAX_EVENT_BATCH).optional(),
});

export const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});
