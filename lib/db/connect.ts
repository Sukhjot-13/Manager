import mongoose from "mongoose";
import { ensureLogRetention } from "@/lib/db/logRetention";

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

const globalForMongoose = globalThis as unknown as {
  __managerMongoose?: MongooseCache;
};

const cache: MongooseCache =
  globalForMongoose.__managerMongoose ?? { conn: null, promise: null };

globalForMongoose.__managerMongoose = cache;

export async function connectToDatabase(
  uri?: string,
  options: { serverSelectionTimeoutMS?: number } = {},
): Promise<typeof mongoose> {
  const connectionString = uri ?? process.env.MONGODB_URI;
  if (connectionString === undefined || connectionString.trim() === "") {
    throw new Error("Missing required environment variable: MONGODB_URI");
  }
  if (cache.conn !== null) {
    return cache.conn;
  }
  cache.promise ??= mongoose
    .connect(connectionString, {
      bufferCommands: false,
      maxPoolSize: 5,
      serverSelectionTimeoutMS: options.serverSelectionTimeoutMS ?? 5000,
    })
    .then(async (m) => {
      if (m.connection.db === undefined) throw new Error("Database not connected");
      await ensureLogRetention(m.connection.db);
      return m;
    })
    .catch((error: unknown) => {
      cache.promise = null;
      throw error;
    });
  cache.conn = await cache.promise;
  return cache.conn;
}

export function mongooseInstance(): typeof mongoose {
  if (cache.conn === null) {
    throw new Error("Database not connected");
  }
  return cache.conn;
}

export function isDatabaseConnected(): boolean {
  return cache.conn !== null && cache.conn.connection.readyState === 1;
}

export async function disconnectFromDatabase(): Promise<void> {
  if (cache.conn !== null) {
    await cache.conn.disconnect();
  }
  cache.conn = null;
  cache.promise = null;
}
