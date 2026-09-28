import mongoose, { Schema } from "mongoose";

const permissionManagementSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    minTargetRank: { type: Number, default: 100 },
    allowedPermissions: { type: [String], default: [] },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    name: { type: String, default: "" },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["ADMIN", "DEVELOPER", "USER"], required: true },
    accessLevel: { type: Number, required: true, min: 0 },
    overrides: { type: Map, of: String, default: undefined },
    permissionManagement: { type: permissionManagementSchema, default: undefined },
    disabled: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

export type UserDoc = mongoose.InferSchemaType<typeof userSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const UserModel =
  (mongoose.models.User as mongoose.Model<UserDoc>) ??
  mongoose.model<UserDoc>("User", userSchema);
