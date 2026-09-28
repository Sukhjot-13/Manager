import mongoose, { Schema } from "mongoose";

export const EVENT_TYPES = ["pageview", "click", "custom"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const eventSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    keyPrefix: { type: String, default: "" },
    type: { type: String, enum: EVENT_TYPES, required: true },
    name: { type: String, default: "" },
    path: { type: String, default: "", maxlength: 512 },
    props: { type: Schema.Types.Mixed, default: undefined },
    visitorId: { type: String, default: "", index: true },
    sessionId: { type: String, default: "" },
    referrer: { type: String, default: "" },
    utm: { type: Schema.Types.Mixed, default: undefined },
    device: { type: String, default: "" },
    browser: { type: String, default: "" },
    os: { type: String, default: "" },
    country: { type: String, default: "" },
    ip: { type: String, default: "" },
    rejected: { type: Boolean, default: false, index: true },
    ts: { type: Date, required: true },
    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

eventSchema.index({ projectId: 1, ts: -1, _id: -1 });
eventSchema.index({ ts: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export type EventDoc = mongoose.InferSchemaType<typeof eventSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const EventModel =
  (mongoose.models.Event as mongoose.Model<EventDoc>) ??
  mongoose.model<EventDoc>("Event", eventSchema);
