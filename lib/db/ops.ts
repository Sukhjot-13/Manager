import mongoose, { Schema } from "mongoose";

export const LOG_TTL_DAYS = 30;
export const EVENT_TTL_DAYS = 90;
export const SECRET_AUDIT_TTL_DAYS = 180;
export const RATE_LIMIT_WINDOW_SECONDS = 60;

const dailyStatSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    date: { type: String, required: true },
    pageviews: { type: Number, default: 0 },
    visitors: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    customEvents: { type: Number, default: 0 },
    byPath: { type: Schema.Types.Mixed, default: {} },
    byCountry: { type: Schema.Types.Mixed, default: {} },
    byReferrer: { type: Schema.Types.Mixed, default: {} },
    byDevice: { type: Schema.Types.Mixed, default: {} },
    byBrowser: { type: Schema.Types.Mixed, default: {} },
    byOs: { type: Schema.Types.Mixed, default: {} },
    clicksByTarget: { type: Schema.Types.Mixed, default: {} },
    byEvent: { type: Schema.Types.Mixed, default: {} },
    visitorIds: { type: [String], default: [] },
  },
  { timestamps: true },
);

dailyStatSchema.index({ projectId: 1, date: 1 }, { unique: true });

export type DailyStatDoc = mongoose.InferSchemaType<typeof dailyStatSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const DailyStatModel =
  (mongoose.models.DailyStat as mongoose.Model<DailyStatDoc>) ??
  mongoose.model<DailyStatDoc>("DailyStat", dailyStatSchema);

const rateLimitSchema = new Schema(
  {
    key: { type: String, required: true },
    windowStart: { type: Date, required: true },
    count: { type: Number, default: 0 },
  },
  { timestamps: false },
);

rateLimitSchema.index({ key: 1, windowStart: 1 }, { unique: true });
rateLimitSchema.index(
  { windowStart: 1 },
  { expireAfterSeconds: RATE_LIMIT_WINDOW_SECONDS * 10 },
);

export type RateLimitDoc = mongoose.InferSchemaType<typeof rateLimitSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const RateLimitModel =
  (mongoose.models.RateLimit as mongoose.Model<RateLimitDoc>) ??
  mongoose.model<RateLimitDoc>("RateLimit", rateLimitSchema);

const appSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

export const APP_SETTING_KEYS = {
  ingestEnabled: "ingest.enabled",
  analyticsEnabled: "ingest.analyticsEnabled",
  maxLogBatch: "ingest.maxLogBatch",
  maxEventBatch: "ingest.maxEventBatch",
} as const;

export type AppSettingDoc = mongoose.InferSchemaType<typeof appSettingSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const AppSettingModel =
  (mongoose.models.AppSetting as mongoose.Model<AppSettingDoc>) ??
  mongoose.model<AppSettingDoc>("AppSetting", appSettingSchema);

const loginAttemptSchema = new Schema(
  {
    identifier: { type: String, required: true, index: true },
    count: { type: Number, default: 0 },
    firstAt: { type: Date, default: Date.now },
    lockedUntil: { type: Date },
  },
  { timestamps: false },
);

export type LoginAttemptDoc = mongoose.InferSchemaType<
  typeof loginAttemptSchema
> & { _id: mongoose.Types.ObjectId };

export const LoginAttemptModel =
  (mongoose.models.LoginAttempt as mongoose.Model<LoginAttemptDoc>) ??
  mongoose.model<LoginAttemptDoc>("LoginAttempt", loginAttemptSchema);

const auditEventSchema = new Schema(
  {
    action: { type: String, required: true, index: true },
    actor: { type: String, required: true },
    targetType: { type: String, default: "" },
    targetId: { type: String, default: "" },
    detail: { type: Schema.Types.Mixed, default: undefined },
    ip: { type: String, default: "" },
    ts: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

auditEventSchema.index({ ts: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 });

export type AuditEventDoc = mongoose.InferSchemaType<typeof auditEventSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const AuditEventModel =
  (mongoose.models.AuditEvent as mongoose.Model<AuditEventDoc>) ??
  mongoose.model<AuditEventDoc>("AuditEvent", auditEventSchema);
