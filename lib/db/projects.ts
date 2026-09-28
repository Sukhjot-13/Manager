import mongoose, { Schema } from "mongoose";

export const PROJECT_STATUSES = [
  "idea",
  "building",
  "live",
  "paused",
  "archived",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const LINK_TYPES = ["github", "live", "docs", "other"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

const linkSchema = new Schema(
  {
    type: { type: String, enum: LINK_TYPES, required: true },
    url: { type: String, required: true },
    label: { type: String, default: "" },
  },
  { _id: true },
);

const projectSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true, lowercase: true },
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: PROJECT_STATUSES,
      default: "idea",
      index: true,
    },
    tags: { type: [String], default: [], index: true },
    color: { type: String, default: "#6366f1" },
    emoji: { type: String, default: "📁" },
    links: { type: [linkSchema], default: [] },
    notesMd: { type: String, default: "" },
    ingestEnabled: { type: Boolean, default: true },
    analyticsEnabled: { type: Boolean, default: true },
    githubRepo: { type: String, default: "" },
    githubCache: {
      stars: { type: Number, default: 0 },
      openIssues: { type: Number, default: 0 },
      defaultBranch: { type: String, default: "" },
      lastPush: { type: String, default: "" },
      description: { type: String, default: "" },
      fetchedAt: { type: Date },
    },
  },
  { timestamps: true },
);

projectSchema.index({ name: "text", description: "text", tags: "text" });

export type ProjectDoc = mongoose.InferSchemaType<typeof projectSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const ProjectModel =
  (mongoose.models.Project as mongoose.Model<ProjectDoc>) ??
  mongoose.model<ProjectDoc>("Project", projectSchema);
