import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { ensureLogRetention } from "@/lib/db/logRetention";
import { LOG_TTL_SECONDS } from "@/lib/logRetention";
import { startTestDatabase, stopTestDatabase } from "../helpers/mongo";

describe("48-hour application log retention", () => {
  beforeAll(startTestDatabase);
  afterAll(stopTestDatabase);

  it("updates the old TTL in place, preserves other indexes, and is idempotent", async () => {
    const db = mongoose.connection.db!;
    const logs = db.collection("logs");
    await logs.createIndex({ projectId: 1, ts: -1 }, { name: "project_timeline" });
    await db.command({ collMod: "logs", index: { keyPattern: { ts: 1 }, expireAfterSeconds: 30 * 86400 } });
    const record = await logs.insertOne({ ts: new Date(), message: "keep recent logs" });

    await ensureLogRetention(db);
    await ensureLogRetention(db);

    const indexes = await logs.indexes();
    expect(indexes.find((index) => index.name === "ts_1")?.expireAfterSeconds).toBe(LOG_TTL_SECONDS);
    expect(indexes.some((index) => index.name === "project_timeline")).toBe(true);
    expect(await logs.findOne({ _id: record.insertedId })).not.toBeNull();
  });

  it("creates the TTL for an empty collection", async () => {
    const db = mongoose.connection.db!;
    await db.collection("logs").drop();
    await ensureLogRetention(db);
    expect((await db.collection("logs").indexes()).find((index) => index.name === "ts_1")?.expireAfterSeconds).toBe(172800);
  });

  it("MongoDB removes expired logs and retains logs younger than two days", async () => {
    const db = mongoose.connection.db!;
    await db.admin().command({ setParameter: 1, ttlMonitorSleepSecs: 1 });
    const logs = db.collection("logs");
    const now = Date.now();
    const stale = await logs.insertOne({ ts: new Date(now - 3 * 86400000), message: "expired" });
    const recent = await logs.insertOne({ ts: new Date(now - 86400000), message: "retained" });
    await expect.poll(() => logs.findOne({ _id: stale.insertedId }), { timeout: 8000 }).toBeNull();
    expect(await logs.findOne({ _id: recent.insertedId })).not.toBeNull();
  }, 10000);

  it("surfaces migration permission failures without logging raw error values", async () => {
    const db = mongoose.connection.db!;
    await db.command({ collMod: "logs", index: { keyPattern: { ts: 1 }, expireAfterSeconds: 30 * 86400 } });
    const privateError = Object.assign(new Error("mongodb://private-user:private-password@host/db"), { code: 13 });
    const command = vi.spyOn(db, "command").mockRejectedValueOnce(privateError);
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(ensureLogRetention(db)).rejects.toBe(privateError);
      expect(logger).toHaveBeenCalledWith("[logs.retention] index configuration failed", expect.objectContaining({ operation: "collMod", code: 13 }));
      expect(JSON.stringify(logger.mock.calls)).not.toContain("private-password");
    } finally {
      command.mockRestore();
      logger.mockRestore();
      await ensureLogRetention(db);
    }
  });
});
