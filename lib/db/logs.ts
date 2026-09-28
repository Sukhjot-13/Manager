import mongoose, { Schema } from "mongoose";

export const LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_SOURCES = ["client", "server"] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

const logSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    keyPrefix: { type: String, default: "" },
    level: { type: String, enum: LOG_LEVELS, required: true },
    message: { type: String, required: true, maxlength: 1024 },
    meta: { type: Schema.Types.Mixed, default: undefined },
    stack: { type: String, default: "" },
    fingerprint: { type: String, default: "" },
    count: { type: Number, default: 1 },
    source: { type: String, enum: LOG_SOURCES, required: true },
    sessionId: { type: String, default: "" },
    pageId: { type: String, default: "" },
    traceId: { type: String, default: "" },
    requestId: { type: String, default: "" },
    url: { type: String, default: "" },
    route: { type: String, default: "" },
    referrer: { type: String, default: "" },
    ua: { type: String, default: "" },
    browser: { type: String, default: "" },
    os: { type: String, default: "" },
    device: { type: String, default: "" },
    viewport: { type: String, default: "" },
    lang: { type: String, default: "" },
    tz: { type: String, default: "" },
    connection: { type: String, default: "" },
    ip: { type: String, default: "" },
    country: { type: String, default: "" },
    appVersion: { type: String, default: "" },
    environment: { type: String, default: "" },
    release: { type: String, default: "" },
    hostname: { type: String, default: "" },
    pid: { type: Number },
    runtimeVersion: { type: String, default: "" },
    rssMb: { type: Number },
    uptimeSec: { type: Number },
    durationMs: { type: Number },
    ts: { type: Date, required: true },
    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

logSchema.index({ projectId: 1, ts: -1, _id: -1 });
logSchema.index({ projectId: 1, fingerprint: 1, ts: -1 });
logSchema.index({ projectId: 1, traceId: 1, ts: -1 });
// The viewer filters on level and on environment/release, and the facet panel runs
// distinct() on environment and release on every load. Without these the filtered
// queries and both distinct() calls fall back to scanning the project's documents.
logSchema.index({ projectId: 1, level: 1, ts: -1 });
// traceId lookups are always project-scoped ("Together" view), so the compound index
// replaces what used to be a standalone index on traceId.
logSchema.index({ projectId: 1, environment: 1, release: 1, ts: -1 });
logSchema.index({ ts: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export type LogDoc = mongoose.InferSchemaType<typeof logSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const LogModel =
  (mongoose.models.Log as mongoose.Model<LogDoc>) ??
  mongoose.model<LogDoc>("Log", logSchema);
