import mongoose, { Schema } from "mongoose";

export const ENVIRONMENTS = ["dev", "staging", "prod"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

const secretSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    environment: { type: String, enum: ENVIRONMENTS, required: true },
    key: { type: String, required: true, maxlength: 200 },
    valueEnc: { type: String, required: true },
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    keyVer: { type: Number, default: 1 },
    note: { type: String, default: "" },
  },
  { timestamps: true },
);

secretSchema.index({ projectId: 1, environment: 1, key: 1 }, { unique: true });

const secretAuditSchema = new Schema(
  {
    secretId: { type: Schema.Types.ObjectId, ref: "Secret", required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    action: { type: String, enum: ["reveal", "copy", "export", "import", "update", "delete"], required: true },
    actor: { type: String, default: "admin" },
    keyName: { type: String, default: "" },
    environment: { type: String, default: "" },
    ip: { type: String, default: "" },
    ts: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

secretAuditSchema.index({ ts: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

export type SecretDoc = mongoose.InferSchemaType<typeof secretSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const SecretModel =
  (mongoose.models.Secret as mongoose.Model<SecretDoc>) ??
  mongoose.model<SecretDoc>("Secret", secretSchema);

export type SecretAuditDoc = mongoose.InferSchemaType<
  typeof secretAuditSchema
> & { _id: mongoose.Types.ObjectId };

export const SecretAuditModel =
  (mongoose.models.SecretAudit as mongoose.Model<SecretAuditDoc>) ??
  mongoose.model<SecretAuditDoc>("SecretAudit", secretAuditSchema);
