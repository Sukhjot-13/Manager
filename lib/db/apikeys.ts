import mongoose, { Schema } from "mongoose";

export const KEY_KINDS = ["server", "client", "analytics"] as const;
export type KeyKind = (typeof KEY_KINDS)[number];

export const KEY_PREFIXES: Record<KeyKind, string> = {
  server: "mlk",
  client: "mck",
  analytics: "mak",
};

const apiKeySchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    kind: { type: String, enum: KEY_KINDS, required: true, index: true },
    keyHash: { type: String, required: true, unique: true },
    prefix: { type: String, required: true, index: true },
    lastUsedAt: { type: Date },
    revokedAt: { type: Date },
  },
  { timestamps: true },
);

export type ApiKeyDoc = mongoose.InferSchemaType<typeof apiKeySchema> & {
  _id: mongoose.Types.ObjectId;
};

export const ApiKeyModel =
  (mongoose.models.ApiKey as mongoose.Model<ApiKeyDoc>) ??
  mongoose.model<ApiKeyDoc>("ApiKey", apiKeySchema);
