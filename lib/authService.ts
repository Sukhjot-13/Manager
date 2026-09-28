import bcrypt from "bcryptjs";
import { connectToDatabase } from "@/lib/db/connect";
import { UserModel } from "@/lib/db/users";
import { LoginAttemptModel } from "@/lib/db/ops";
import { adminCredentials } from "@/lib/env";
import { timingSafeEqualString } from "@/lib/crypto";
import { ROLES, type RoleKey } from "@/lib/permissions";

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

export type LoginOutcome =
  | { ok: true; source: "env" | "db"; principal: { id: string; email: string; name: string; role: RoleKey; level: number } }
  | { ok: false; reason: "invalid" | "locked" | "disabled" };

function identifiersFor(email: string, ip: string): string[] {
  return [`email:${email.toLowerCase()}`, `ip:${ip}`];
}

export async function lockoutRemainingMs(identifiers: string[]): Promise<number> {
  await connectToDatabase();
  const rows = await LoginAttemptModel.find({
    identifier: { $in: identifiers },
    lockedUntil: { $gt: new Date() },
  }).lean();
  if (rows.length === 0) {
    return 0;
  }
  return Math.max(
    ...rows.map((row) => (row.lockedUntil?.getTime() ?? 0) - Date.now()),
  );
}

async function registerFailure(identifiers: string[]): Promise<void> {
  const now = new Date();
  for (const identifier of identifiers) {
    const existing = await LoginAttemptModel.findOne({ identifier }).lean();
    if (existing === null || existing === undefined) {
      await LoginAttemptModel.create({ identifier, count: 1, firstAt: now });
      continue;
    }
    const windowExpired = now.getTime() - existing.firstAt.getTime() > LOCKOUT_MS;
    const count = windowExpired ? 1 : existing.count + 1;
    await LoginAttemptModel.updateOne(
      { identifier },
      {
        $set: {
          count,
          firstAt: windowExpired ? now : existing.firstAt,
          lockedUntil: count >= MAX_LOGIN_ATTEMPTS ? new Date(now.getTime() + LOCKOUT_MS) : null,
        },
      },
    ).exec();
  }
}

export async function clearFailures(identifiers: string[]): Promise<void> {
  await LoginAttemptModel.deleteMany({ identifier: { $in: identifiers } }).exec();
}

export async function verifyPassword(
  email: string,
  password: string,
): Promise<boolean> {
  const env = adminCredentials();
  if (
    timingSafeEqualString(email.trim().toLowerCase(), env.email) &&
    timingSafeEqualString(password, env.password)
  ) {
    return true;
  }
  await connectToDatabase();
  const user = await UserModel.findOne({ email: email.trim().toLowerCase() }).lean();
  if (user === null || user === undefined || user.disabled === true) {
    return false;
  }
  return bcrypt.compare(password, user.passwordHash);
}

export async function attemptLogin(
  email: string,
  password: string,
  ip: string,
): Promise<LoginOutcome> {
  const identifiers = identifiersFor(email, ip);
  const remaining = await lockoutRemainingMs(identifiers);
  if (remaining > 0) {
    return { ok: false, reason: "locked" };
  }

  const env = adminCredentials();
  const envEmailMatch = timingSafeEqualString(
    email.trim().toLowerCase(),
    env.email,
  );
  const envPasswordMatch = timingSafeEqualString(password, env.password);
  if (envEmailMatch && envPasswordMatch) {
    await clearFailures(identifiers);
    await connectToDatabase();
    const existing = await UserModel.findOne({ email: env.email }).lean();
    const principal =
      existing === null || existing === undefined
        ? {
            id: "env-admin",
            email: env.email,
            name: "Owner",
            role: "ADMIN" as RoleKey,
            level: ROLES.ADMIN,
          }
        : {
            id: String(existing._id),
            email: existing.email,
            name: existing.name ?? "",
            role: existing.role as RoleKey,
            level: existing.accessLevel,
          };
    if (existing !== null && existing !== undefined && existing.disabled === true) {
      return { ok: false, reason: "disabled" };
    }
    if (existing === null || existing === undefined) {
      await UserModel.create({
        email: env.email,
        name: "Owner",
        passwordHash: await bcrypt.hash(env.password, 12),
        role: "ADMIN",
        accessLevel: ROLES.ADMIN,
      });
    } else {
      await UserModel.updateOne(
        { _id: existing._id },
        { $set: { lastLoginAt: new Date() } },
      ).exec();
    }
    return { ok: true, source: "env", principal };
  }

  await connectToDatabase();
  const user = await UserModel.findOne({ email: email.trim().toLowerCase() });
  const dbPasswordMatch =
    user === null ? false : await bcrypt.compare(password, user.passwordHash);
  if (user !== null && dbPasswordMatch) {
    if (user.disabled === true) {
      await registerFailure(identifiers);
      return { ok: false, reason: "disabled" };
    }
    await clearFailures(identifiers);
    await UserModel.updateOne(
      { _id: user._id },
      { $set: { lastLoginAt: new Date() } },
    ).exec();
    return {
      ok: true,
      source: "db",
      principal: {
        id: String(user._id),
        email: user.email,
        name: user.name ?? "",
        role: user.role as RoleKey,
        level: user.accessLevel,
      },
    };
  }

  await registerFailure(identifiers);
  return { ok: false, reason: "invalid" };
}
