import type { mongo } from "mongoose";
import { LOG_TTL_SECONDS } from "@/lib/logRetention";

/** Updates an existing TTL index in place; creating it alone cannot change its age. */
export async function ensureLogRetention(db: mongo.Db): Promise<void> {
  let operation = "createIndex";
  try {
    try {
      await db.collection("logs").createIndex(
        { ts: 1 },
        { expireAfterSeconds: LOG_TTL_SECONDS },
      );
    } catch (error) {
      const code = (error as { code?: number } | null)?.code;
      if (code !== 85 && code !== 86) throw error;
      operation = "collMod";
      await db.command({
        collMod: "logs",
        index: { keyPattern: { ts: 1 }, expireAfterSeconds: LOG_TTL_SECONDS },
      });
    }
  } catch (error) {
    const code = (error as { code?: number } | null)?.code;
    console.error("[logs.retention] index configuration failed", {
      operation,
      collection: "logs",
      index: "ts_1",
      expireAfterSeconds: LOG_TTL_SECONDS,
      code: typeof code === "number" ? code : "unknown",
      hint: operation === "collMod"
        ? "A database administrator can update the logs TTL index with the README collMod command."
        : "Check database connectivity and permission to create the logs TTL index.",
    });
    throw error;
  }
}
