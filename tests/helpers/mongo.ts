import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { connectToDatabase, disconnectFromDatabase } from "@/lib/db/connect";

let server: MongoMemoryServer | null = null;
let uri: string | null = null;

export const TEST_ENV: Record<string, string> = {
  AUTH_SECRET: "test-auth-secret-that-is-at-least-32-characters-long",
  ENV_MASTER_KEY: "a".repeat(64),
  VISITOR_PEPPER: "test-visitor-pepper",
  ADMIN_EMAIL: "owner@example.com",
  ADMIN_PASSWORD: "correct-horse-battery-staple",
};

export async function startTestDatabase(): Promise<string> {
  if (server === null) {
    server = await MongoMemoryServer.create();
    uri = server.getUri("manager_test");
  }
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] = value;
  }
  process.env.MONGODB_URI = uri ?? "";
  await connectToDatabase();
  return uri ?? "";
}

export async function stopTestDatabase(): Promise<void> {
  await disconnectFromDatabase();
  if (server !== null) {
    await server.stop();
    server = null;
    uri = null;
  }
}

export async function clearDatabase(): Promise<void> {
  const collections = await mongoose.connection.db?.collections();
  if (collections === undefined) {
    return;
  }
  await Promise.all(
    collections.map((collection) => collection.deleteMany({})),
  );
}

export function objectId(): string {
  return new mongoose.Types.ObjectId().toString();
}
