import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { ROLES, type RoleKey } from "@/lib/permissions";

export type SeedUserOptions = {
  email?: string;
  name?: string;
  role?: RoleKey;
  disabled?: boolean;
  overrides?: Record<string, string>;
  permissionManagement?: {
    enabled: boolean;
    minTargetRank: number;
    allowedPermissions: string[];
  };
  password?: string;
};

export async function seedUser(options: SeedUserOptions = {}): Promise<string> {
  const email = options.email ?? "owner@example.com";
  const role = options.role ?? "ADMIN";
  const created = await mongoose.connection.collection("users").insertOne({
    email,
    name: options.name ?? "Test",
    passwordHash: await bcrypt.hash(options.password ?? "correct-horse-battery-staple", 4),
    role,
    accessLevel: ROLES[role],
    disabled: options.disabled ?? false,
    ...(options.overrides === undefined ? {} : { overrides: options.overrides }),
    ...(options.permissionManagement === undefined
      ? {}
      : { permissionManagement: options.permissionManagement }),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return String(created.insertedId);
}
