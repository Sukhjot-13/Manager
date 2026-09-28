const REQUIRED_MESSAGE = "Missing required environment variable";

function read(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${REQUIRED_MESSAGE}: ${name}`);
  }
  return value.trim();
}

function readOptional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

export type ServerEnv = {
  MONGODB_URI: string;
  AUTH_SECRET: string;
  ADMIN_EMAIL: string;
  ADMIN_PASSWORD: string;
  ENV_MASTER_KEY: string;
  VISITOR_PEPPER: string;
  GITHUB_TOKEN?: string;
  APP_TZ: string;
};

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached !== null) {
    return cached;
  }
  const githubToken = process.env.GITHUB_TOKEN?.trim();
  cached = {
    MONGODB_URI: read("MONGODB_URI"),
    AUTH_SECRET: read("AUTH_SECRET"),
    ADMIN_EMAIL: read("ADMIN_EMAIL").toLowerCase(),
    ADMIN_PASSWORD: read("ADMIN_PASSWORD"),
    ENV_MASTER_KEY: read("ENV_MASTER_KEY"),
    VISITOR_PEPPER: read("VISITOR_PEPPER"),
    ...(githubToken === undefined || githubToken === "" ? {} : { GITHUB_TOKEN: githubToken }),
    APP_TZ: readOptional("APP_TZ", "UTC"),
  };
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}

export function authSecret(): Uint8Array {
  const secret = serverEnv().AUTH_SECRET;
  if (secret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export function visitorPepper(): string {
  return serverEnv().VISITOR_PEPPER;
}

export function adminCredentials(): { email: string; password: string } {
  return { email: serverEnv().ADMIN_EMAIL, password: serverEnv().ADMIN_PASSWORD };
}

export function appTimezone(): string {
  return serverEnv().APP_TZ;
}
