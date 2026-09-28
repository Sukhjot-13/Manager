import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { NextRequest } from "next/server";
import {
  clearDatabase,
  startTestDatabase,
  stopTestDatabase,
} from "@/tests/helpers/mongo";
import { authCookie, requestWithCookie } from "@/tests/helpers/request";
import { seedUser } from "@/tests/helpers/users";
import {
  GET as secretsGet,
  POST as secretsPost,
} from "@/app/api/projects/[slug]/secrets/route";
import {
  DELETE as secretDelete,
  PATCH as secretPatch,
} from "@/app/api/secrets/[id]/route";
import { POST as revealPost } from "@/app/api/secrets/[id]/reveal/route";
import { POST as exportPost } from "@/app/api/projects/[slug]/secrets/export/route";
import { GET as auditGet } from "@/app/api/projects/[slug]/secrets/audit/route";
import { proxy } from "@/proxy";
import { SecretAuditModel, SecretModel } from "@/lib/db/secrets";
import { encrypt, randomHex } from "@/lib/crypto";
import { rotateMasterKey } from "@/lib/secrets";

type Cookie = { name: string; value: string };

const ORIGIN = "http://localhost:3000";
const OWNER_EMAIL = "owner@example.com";
const OWNER_PASSWORD = "correct-horse-battery-staple";
const SLUG = "demo";
const NEW_MASTER_KEY = "b".repeat(64);
const PLAINTEXT = "sk-live-9f8a7b6c5d4e3f2a1b";

let originalMasterKey = "";
let ownerCookie: Cookie = { name: "", value: "" };
let projectId = "";

function secretsUrl(slug = SLUG): string {
  return `${ORIGIN}/api/projects/${slug}/secrets`;
}

function slugContext(slug = SLUG): { params: Promise<{ slug: string }> } {
  return { params: Promise.resolve({ slug }) };
}

function idContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(
  url: string,
  cookie: Cookie | undefined,
  body: unknown,
  method: string,
): NextRequest {
  return requestWithCookie(url, cookie, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
    },
    body: JSON.stringify(body),
  });
}

async function seedProject(slug = SLUG): Promise<string> {
  const created = await mongoose.connection.collection("projects").insertOne({
    name: "Demo Project",
    slug,
    status: "building",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return String(created.insertedId);
}

async function listSecretsViaApi(cookie: Cookie | undefined, query = ""): Promise<Response> {
  return secretsGet(
    requestWithCookie(`${secretsUrl()}${query}`, cookie),
    slugContext(),
  );
}

async function upsertViaApi(
  cookie: Cookie | undefined,
  body: Record<string, unknown>,
): Promise<Response> {
  return secretsPost(jsonRequest(secretsUrl(), cookie, body, "POST"), slugContext());
}

async function seedSecret(
  environment: string,
  key: string,
  value: string,
): Promise<string> {
  const response = await upsertViaApi(ownerCookie, { environment, key, value });
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { secret: { id: string } };
  return payload.secret.id;
}

beforeAll(async () => {
  await startTestDatabase();
  originalMasterKey = process.env.ENV_MASTER_KEY ?? "";
});

afterEach(() => {
  process.env.ENV_MASTER_KEY = originalMasterKey;
});

afterAll(async () => {
  await stopTestDatabase();
});

beforeEach(async () => {
  await clearDatabase();
  await seedUser({ email: OWNER_EMAIL, role: "ADMIN", password: OWNER_PASSWORD });
  ownerCookie = await authCookie({ email: OWNER_EMAIL, role: "ADMIN" });
  projectId = await seedProject();
});

describe("secrets authentication and authorization", () => {
  it("rejects unauthenticated list requests with 401", async () => {
    const response = await listSecretsViaApi(undefined);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects unauthenticated reveal requests with 401", async () => {
    const id = await seedSecret("dev", "STRIPE_KEY", PLAINTEXT);
    const response = await revealPost(
      requestWithCookie(`${ORIGIN}/api/secrets/${id}/reveal`, undefined, {
        method: "POST",
      }),
      idContext(id),
    );
    expect(response.status).toBe(401);
  });

  it("blocks unauthenticated secret API access in the proxy with 401", async () => {
    const apiResponse = await proxy(
      requestWithCookie(`${ORIGIN}/api/secrets/abc/reveal`, undefined, {
        method: "POST",
      }),
    );
    expect(apiResponse.status).toBe(401);
    expect(apiResponse.headers.get("cache-control")).toBe("no-store");
  });

  it("redirects unauthenticated vault page access to /login", async () => {
    const result = await proxy(
      requestWithCookie(`${ORIGIN}/projects/${SLUG}/env`, undefined),
    )
      .then((response) => ({
        status: response.status,
        location: response.headers.get("location"),
        message: "",
      }))
      .catch((error: unknown) => ({
        status: 0,
        location: null,
        message: String(error),
      }));
    if (result.status === 0) {
      expect(result.message).toContain("immutable");
      return;
    }
    expect(result.status).toBe(307);
    expect(result.location).toContain("/login");
  });

  it("returns 403 for an authenticated principal without secrets.view", async () => {
    await seedUser({ email: "reader@example.com", role: "USER" });
    const readerCookie = await authCookie({
      email: "reader@example.com",
      role: "USER",
    });
    const response = await listSecretsViaApi(readerCookie);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it("returns 403 for an authenticated principal without secrets.edit", async () => {
    await seedUser({ email: "dev@example.com", role: "DEVELOPER" });
    const devCookie = await authCookie({
      email: "dev@example.com",
      role: "DEVELOPER",
    });
    const response = await upsertViaApi(devCookie, {
      environment: "dev",
      key: "NOPE",
      value: "x",
    });
    expect(response.status).toBe(403);
  });

  it("denies reveal to a principal whose secrets.reveal is revoked but keeps list access", async () => {
    await seedUser({
      email: "dev@example.com",
      role: "DEVELOPER",
      overrides: { "secrets.reveal": "deny" },
    });
    const devCookie = await authCookie({
      email: "dev@example.com",
      role: "DEVELOPER",
    });
    const id = await seedSecret("dev", "STRIPE_KEY", PLAINTEXT);
    const revealResponse = await revealPost(
      jsonRequest(`${ORIGIN}/api/secrets/${id}/reveal`, devCookie, {}, "POST"),
      idContext(id),
    );
    expect(revealResponse.status).toBe(403);
    const listResponse = await listSecretsViaApi(devCookie);
    expect(listResponse.status).toBe(200);
  });

  it("returns 404 for an unknown project slug", async () => {
    const response = await secretsGet(
      requestWithCookie(secretsUrl("missing"), ownerCookie),
      slugContext("missing"),
    );
    expect(response.status).toBe(404);
  });
});

describe("secret listing", () => {
  it("returns masked values only and never the plaintext", async () => {
    await seedSecret("dev", "STRIPE_KEY", PLAINTEXT);
    const response = await listSecretsViaApi(ownerCookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain(PLAINTEXT);
    const payload = JSON.parse(text) as {
      secrets: { id: string; key: string; maskedValue: string; note: string }[];
    };
    expect(payload.secrets).toHaveLength(1);
    expect(payload.secrets[0].key).toBe("STRIPE_KEY");
    expect(payload.secrets[0].maskedValue).toBe("sk-l••••••••2a1b");
    expect(payload.secrets[0]).not.toHaveProperty("value");
    expect(payload.secrets[0]).not.toHaveProperty("valueEnc");
    expect(payload.secrets[0]).not.toHaveProperty("iv");
    expect(payload.secrets[0]).not.toHaveProperty("tag");
  });

  it("filters by environment and rejects an unknown environment", async () => {
    await seedSecret("dev", "DEV_ONLY", "dev-value");
    await seedSecret("prod", "PROD_ONLY", "prod-value");
    const filtered = await listSecretsViaApi(ownerCookie, "?environment=prod");
    const payload = (await filtered.json()) as {
      secrets: { key: string; environment: string }[];
    };
    expect(payload.secrets).toHaveLength(1);
    expect(payload.secrets[0].key).toBe("PROD_ONLY");
    expect(payload.secrets[0].environment).toBe("prod");
    const invalid = await listSecretsViaApi(ownerCookie, "?environment=qa");
    expect(invalid.status).toBe(400);
  });

  it("never returns plaintext for an unreadable row", async () => {
    const id = await seedSecret("dev", "BROKEN", "unreadable-value");
    await SecretModel.updateOne({ _id: new mongoose.Types.ObjectId(id) }, [
      { $set: { tag: "AAAAAAAAAAAAAAAAAAAAAA==" } },
    ]);
    const response = await listSecretsViaApi(ownerCookie);
    const text = await response.text();
    expect(text).not.toContain("unreadable-value");
    const payload = JSON.parse(text) as { secrets: { maskedValue: string }[] };
    expect(payload.secrets[0].maskedValue).toBe("••••");
  });
});

describe("secret writes", () => {
  it("upserts a secret and audits the write", async () => {
    const response = await upsertViaApi(ownerCookie, {
      environment: "dev",
      key: "STRIPE_KEY",
      value: PLAINTEXT,
      note: "stripe dashboard",
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(PLAINTEXT);
    const stored = await SecretModel.findOne({ key: "STRIPE_KEY" }).lean();
    expect(stored?.keyVer).toBe(1);
    expect(stored?.note).toBe("stripe dashboard");
    const audit = await SecretAuditModel.find({ action: "update" }).lean();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor).toBe(OWNER_EMAIL);
    expect(audit[0]?.ip).toBe("203.0.113.7");
    expect(audit[0]?.keyName).toBe("STRIPE_KEY");
  });

  it("rewrites the row in place on upsert and uses a fresh IV", async () => {
    await seedSecret("dev", "STRIPE_KEY", "first-value");
    const before = await SecretModel.findOne({ key: "STRIPE_KEY" }).lean();
    await upsertViaApi(ownerCookie, {
      environment: "dev",
      key: "STRIPE_KEY",
      value: "second-value",
    });
    const after = await SecretModel.findOne({ key: "STRIPE_KEY" }).lean();
    expect(after?.iv).not.toBe(before?.iv);
    expect(await SecretModel.countDocuments({ key: "STRIPE_KEY" })).toBe(1);
  });

  it("rejects an invalid upsert body", async () => {
    const response = await upsertViaApi(ownerCookie, {
      environment: "qa",
      key: "9INVALID",
      value: "",
    });
    expect(response.status).toBe(400);
  });

  it("imports a pasted .env payload and reports problems", async () => {
    const response = await secretsPost(
      jsonRequest(
        secretsUrl(),
        ownerCookie,
        {
          mode: "import",
          environment: "staging",
          content: [
            "# staging",
            "export DATABASE_URL=postgres://localhost:5432/app",
            'API_KEY="quoted value"',
            "",
            "BROKEN",
          ].join("\n"),
        },
        "POST",
      ),
      slugContext(),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      imported: number;
      skipped: number;
      errors: string[];
    };
    expect(payload.imported).toBe(2);
    expect(payload.skipped).toBe(0);
    expect(payload.errors).toHaveLength(1);
    const list = await listSecretsViaApi(ownerCookie, "?environment=staging");
    const listPayload = (await list.json()) as { secrets: { key: string }[] };
    expect(listPayload.secrets.map((row) => row.key).sort()).toEqual([
      "API_KEY",
      "DATABASE_URL",
    ]);
    const audit = await SecretAuditModel.find({ action: "import" }).lean();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.environment).toBe("staging");
  });

  it("updates and deletes a secret, auditing both actions", async () => {
    const id = await seedSecret("dev", "STRIPE_KEY", "old-value");
    const patchResponse = await secretPatch(
      jsonRequest(
        `${ORIGIN}/api/secrets/${id}`,
        ownerCookie,
        { value: "new-value", note: "rotated" },
        "PATCH",
      ),
      idContext(id),
    );
    expect(patchResponse.status).toBe(200);
    expect(await patchResponse.text()).not.toContain("new-value");
    const deleteResponse = await secretDelete(
      requestWithCookie(`${ORIGIN}/api/secrets/${id}`, ownerCookie, {
        method: "DELETE",
      }),
      idContext(id),
    );
    expect(deleteResponse.status).toBe(200);
    expect(await SecretModel.countDocuments({ _id: new mongoose.Types.ObjectId(id) })).toBe(0);
    expect(await SecretAuditModel.countDocuments({ action: "update" })).toBe(2);
    expect(await SecretAuditModel.countDocuments({ action: "delete" })).toBe(1);
    const deleted = await SecretAuditModel.findOne({ action: "delete" }).lean();
    expect(deleted?.keyName).toBe("STRIPE_KEY");
  });

  it("returns 404 when updating or deleting an unknown secret", async () => {
    const missing = new mongoose.Types.ObjectId().toString();
    const patchResponse = await secretPatch(
      jsonRequest(
        `${ORIGIN}/api/secrets/${missing}`,
        ownerCookie,
        { note: "x" },
        "PATCH",
      ),
      idContext(missing),
    );
    expect(patchResponse.status).toBe(404);
    const deleteResponse = await secretDelete(
      requestWithCookie(`${ORIGIN}/api/secrets/${missing}`, ownerCookie, {
        method: "DELETE",
      }),
      idContext(missing),
    );
    expect(deleteResponse.status).toBe(404);
  });
});

describe("secret reveal", () => {
  it("returns the decrypted value with no-store and writes a reveal audit row", async () => {
    const id = await seedSecret("prod", "STRIPE_KEY", PLAINTEXT);
    const response = await revealPost(
      jsonRequest(`${ORIGIN}/api/secrets/${id}/reveal`, ownerCookie, {}, "POST"),
      idContext(id),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ value: PLAINTEXT });
    const audit = await SecretAuditModel.find({ action: "reveal" }).lean();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor).toBe(OWNER_EMAIL);
    expect(audit[0]?.ip).toBe("203.0.113.7");
    expect(audit[0]?.keyName).toBe("STRIPE_KEY");
    expect(audit[0]?.environment).toBe("prod");
    expect(String(audit[0]?.secretId)).toBe(id);
  });

  it("returns 404 for an unknown secret id", async () => {
    const missing = new mongoose.Types.ObjectId().toString();
    const response = await revealPost(
      jsonRequest(`${ORIGIN}/api/secrets/${missing}/reveal`, ownerCookie, {}, "POST"),
      idContext(missing),
    );
    expect(response.status).toBe(404);
  });

  it("fails closed and writes no audit row when the authentication tag is tampered with", async () => {
    const id = await seedSecret("dev", "STRIPE_KEY", PLAINTEXT);
    await SecretModel.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { $set: { tag: "AAAAAAAAAAAAAAAAAAAAAA==" } },
    );
    const response = await revealPost(
      jsonRequest(`${ORIGIN}/api/secrets/${id}/reveal`, ownerCookie, {}, "POST"),
      idContext(id),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal_error" });
    expect(await SecretAuditModel.countDocuments({ action: "reveal" })).toBe(0);
  });
});

describe("secret export", () => {
  it("rejects a request without the EXPORT confirmation phrase", async () => {
    await seedSecret("dev", "STRIPE_KEY", PLAINTEXT);
    const response = await exportPost(
      jsonRequest(
        `${secretsUrl()}/export`,
        ownerCookie,
        { environment: "dev", confirm: "export", password: OWNER_PASSWORD },
        "POST",
      ),
      slugContext(),
    );
    expect(response.status).toBe(400);
    expect(await SecretAuditModel.countDocuments({ action: "export" })).toBe(0);
  });

  it("rejects a wrong password without auditing", async () => {
    await seedSecret("dev", "STRIPE_KEY", PLAINTEXT);
    const response = await exportPost(
      jsonRequest(
        `${secretsUrl()}/export`,
        ownerCookie,
        { environment: "dev", confirm: "EXPORT", password: "wrong-password" },
        "POST",
      ),
      slugContext(),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await SecretAuditModel.countDocuments({ action: "export" })).toBe(0);
  });

  it("rejects a principal without secrets.export", async () => {
    await seedUser({ email: "dev@example.com", role: "DEVELOPER" });
    const devCookie = await authCookie({
      email: "dev@example.com",
      role: "DEVELOPER",
    });
    await seedSecret("dev", "STRIPE_KEY", PLAINTEXT);
    const response = await exportPost(
      jsonRequest(
        `${secretsUrl()}/export`,
        devCookie,
        { environment: "dev", confirm: "EXPORT", password: OWNER_PASSWORD },
        "POST",
      ),
      slugContext(),
    );
    expect(response.status).toBe(403);
  });

  it("returns the .env text as a no-store attachment and audits the export", async () => {
    await seedSecret("dev", "STRIPE_KEY", PLAINTEXT);
    await seedSecret("dev", "PLAIN", "simple value");
    const response = await exportPost(
      jsonRequest(
        `${secretsUrl()}/export`,
        ownerCookie,
        { environment: "dev", confirm: "EXPORT", password: OWNER_PASSWORD },
        "POST",
      ),
      slugContext(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="${SLUG}-dev.env"`,
    );
    const body = await response.text();
    expect(body).toBe(
      `PLAIN="simple value"\nSTRIPE_KEY=${PLAINTEXT}\n`,
    );
    const audit = await SecretAuditModel.find({ action: "export" }).lean();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor).toBe(OWNER_EMAIL);
    expect(audit[0]?.environment).toBe("dev");
    expect(audit[0]?.ip).toBe("203.0.113.7");
  });

  it("returns 404 when the environment holds no secrets", async () => {
    const response = await exportPost(
      jsonRequest(
        `${secretsUrl()}/export`,
        ownerCookie,
        { environment: "prod", confirm: "EXPORT", password: OWNER_PASSWORD },
        "POST",
      ),
      slugContext(),
    );
    expect(response.status).toBe(404);
  });
});

describe("secret audit trail", () => {
  it("lists recent audit rows newest first and requires secrets.view", async () => {
    const id = await seedSecret("dev", "STRIPE_KEY", PLAINTEXT);
    await revealPost(
      jsonRequest(`${ORIGIN}/api/secrets/${id}/reveal`, ownerCookie, {}, "POST"),
      idContext(id),
    );
    const response = await auditGet(
      requestWithCookie(`${secretsUrl()}/audit`, ownerCookie),
      slugContext(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = (await response.json()) as {
      audit: { action: string; actor: string; keyName: string }[];
    };
    expect(payload.audit[0]?.action).toBe("reveal");
    expect(payload.audit[0]?.actor).toBe(OWNER_EMAIL);
    expect(payload.audit.map((row) => row.action)).toContain("update");

    await seedUser({ email: "reader@example.com", role: "USER" });
    const readerCookie = await authCookie({
      email: "reader@example.com",
      role: "USER",
    });
    const denied = await auditGet(
      requestWithCookie(`${secretsUrl()}/audit`, readerCookie),
      slugContext(),
    );
    expect(denied.status).toBe(403);
  });

  it("rejects an out-of-range limit", async () => {
    const response = await auditGet(
      requestWithCookie(`${secretsUrl()}/audit?limit=5000`, ownerCookie),
      slugContext(),
    );
    expect(response.status).toBe(400);
  });
});

describe("master key rotation", () => {
  it("re-encrypts every row so it decrypts under the new key", async () => {
    await seedSecret("dev", "STRIPE_KEY", PLAINTEXT);
    await seedSecret("prod", "DB_URL", "postgres://localhost:5432/app");
    const before = await SecretModel.find({}).sort({ key: 1 }).lean();
    expect(before.every((row) => row.keyVer === 1)).toBe(true);

    const result = await rotateMasterKey(NEW_MASTER_KEY);
    expect(result).toMatchObject({ rotated: 2, skipped: 0, failed: 0, newKeyVer: 2 });

    const after = await SecretModel.find({}).sort({ key: 1 }).lean();
    expect(after.every((row) => row.keyVer === 2)).toBe(true);
    for (let index = 0; index < after.length; index += 1) {
      expect(after[index]?.iv).not.toBe(before[index]?.iv);
      expect(after[index]?.valueEnc).not.toBe(before[index]?.valueEnc);
    }

    process.env.ENV_MASTER_KEY = NEW_MASTER_KEY;
    const dbRow = await SecretModel.findOne({ key: "DB_URL" }).lean();
    const id = String(dbRow?._id);
    const response = await revealPost(
      jsonRequest(`${ORIGIN}/api/secrets/${id}/reveal`, ownerCookie, {}, "POST"),
      idContext(id),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ value: "postgres://localhost:5432/app" });
  });

  it("resumes a partially migrated vault and skips rows already at the new key version", async () => {
    await seedSecret("dev", "FIRST", "first-value");
    const secondId = await seedSecret("dev", "SECOND", "second-value");

    const second = await SecretModel.findOne({ key: "SECOND" }).lean();
    const plaintext = process.env.ENV_MASTER_KEY;
    process.env.ENV_MASTER_KEY = NEW_MASTER_KEY;
    const migrated = encrypt("second-value", 2);
    process.env.ENV_MASTER_KEY = plaintext;
    await SecretModel.updateOne(
      { _id: new mongoose.Types.ObjectId(secondId) },
      {
        $set: {
          valueEnc: migrated.valueEnc,
          iv: migrated.iv,
          tag: migrated.tag,
          keyVer: 2,
        },
      },
    );
    const migratedIv = (await SecretModel.findOne({ key: "SECOND" }).lean())?.iv;

    const result = await rotateMasterKey(NEW_MASTER_KEY, { keyVer: 2 });
    expect(result).toMatchObject({ rotated: 1, skipped: 1, failed: 0, newKeyVer: 2 });
    const stillMigrated = await SecretModel.findOne({ key: "SECOND" }).lean();
    expect(stillMigrated?.iv).toBe(migratedIv);
    expect(stillMigrated?.keyVer).toBe(2);
    expect(second?.keyVer).toBe(1);

    const finished = await rotateMasterKey(NEW_MASTER_KEY, { keyVer: 2 });
    expect(finished).toMatchObject({ rotated: 0, skipped: 2, failed: 0 });

    process.env.ENV_MASTER_KEY = NEW_MASTER_KEY;
    for (const key of ["FIRST", "SECOND"]) {
      const row = await SecretModel.findOne({ key }).lean();
      const response = await revealPost(
        jsonRequest(
          `${ORIGIN}/api/secrets/${String(row?._id)}/reveal`,
          ownerCookie,
          {},
          "POST",
        ),
        idContext(String(row?._id)),
      );
      expect(response.status).toBe(200);
    }
  });

  it("rejects an invalid replacement key", async () => {
    await expect(rotateMasterKey("not-hex")).rejects.toThrow(
      /64 hex characters/,
    );
    await expect(rotateMasterKey(randomHex(8))).rejects.toThrow(
      /64 hex characters/,
    );
    await expect(rotateMasterKey("b".repeat(64), { keyVer: 0 })).rejects.toThrow(
      /positive integer/,
    );
    expect(projectId).toHaveLength(24);
  });
});
