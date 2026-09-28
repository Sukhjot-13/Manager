import { beforeAll, describe, expect, it } from "vitest";
import { decrypt, encrypt, maskValue, randomHex } from "@/lib/crypto";
import {
  ROLES,
  can,
  getEffectivePermissions,
  type PermissionKey,
  type Principal,
} from "@/lib/permissions";
import { parseEnvFile } from "@/lib/secrets";

const MASTER_KEY = "a".repeat(64);

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    id: "507f1f77bcf86cd799439011",
    email: "dev@example.com",
    role: "DEVELOPER",
    accessLevel: ROLES.DEVELOPER,
    ...overrides,
  };
}

beforeAll(() => {
  process.env.ENV_MASTER_KEY = MASTER_KEY;
});

describe("parseEnvFile", () => {
  it("parses plain KEY=value lines in order", () => {
    const parsed = parseEnvFile("A=1\nB=two\nC=three");
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries).toEqual([
      { key: "A", value: "1" },
      { key: "B", value: "two" },
      { key: "C", value: "three" },
    ]);
  });

  it("ignores blank lines and comment lines", () => {
    const parsed = parseEnvFile(
      ["# a comment", "", "   ", "   # indented comment", "KEEP=yes", ""].join("\n"),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries).toEqual([{ key: "KEEP", value: "yes" }]);
  });

  it("strips the export prefix", () => {
    const parsed = parseEnvFile("export FOO=bar\nexport\tBAZ=qux");
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries).toEqual([
      { key: "FOO", value: "bar" },
      { key: "BAZ", value: "qux" },
    ]);
  });

  it("strips surrounding single and double quotes", () => {
    const parsed = parseEnvFile(
      ['DOUBLE="hello world"', "SINGLE='raw $value'", 'INNER="say "hi" now"'].join(
        "\n",
      ),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries).toEqual([
      { key: "DOUBLE", value: "hello world" },
      { key: "SINGLE", value: "raw $value" },
      { key: "INNER", value: 'say "hi" now' },
    ]);
  });

  it("keeps everything after the first equals sign", () => {
    const parsed = parseEnvFile("URL=postgres://u:p@h:5432/db?sslmode=require");
    expect(parsed.entries).toEqual([
      { key: "URL", value: "postgres://u:p@h:5432/db?sslmode=require" },
    ]);
  });

  it("handles CRLF line endings", () => {
    const parsed = parseEnvFile("A=1\r\nB=2\r\n");
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries).toEqual([
      { key: "A", value: "1" },
      { key: "B", value: "2" },
    ]);
  });

  it("reports lines without a separator", () => {
    const parsed = parseEnvFile("GOOD=1\nBROKEN\nALSO_GOOD=2");
    expect(parsed.entries).toEqual([
      { key: "GOOD", value: "1" },
      { key: "ALSO_GOOD", value: "2" },
    ]);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toContain("line 2");
  });

  it("rejects invalid key names and empty values", () => {
    const parsed = parseEnvFile("9BAD=1\nhas-dash=2\nEMPTY=");
    expect(parsed.entries).toEqual([]);
    expect(parsed.errors).toHaveLength(3);
  });

  it("keeps the first occurrence of a duplicated key and reports the rest", () => {
    const parsed = parseEnvFile("DUP=first\nDUP=second");
    expect(parsed.entries).toEqual([{ key: "DUP", value: "first" }]);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toContain("duplicate");
  });

  it("returns empty results for an empty document", () => {
    expect(parseEnvFile("")).toEqual({ entries: [], errors: [] });
  });
});

describe("secret value crypto", () => {
  it("round-trips a value through encrypt and decrypt", () => {
    const payload = encrypt("sk-live-abcdef0123456789", 1);
    expect(decrypt(payload)).toBe("sk-live-abcdef0123456789");
    expect(payload.keyVer).toBe(1);
  });

  it("uses a fresh 12-byte IV for every write", () => {
    const first = encrypt("same-plaintext", 1);
    const second = encrypt("same-plaintext", 1);
    expect(Buffer.from(first.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(second.iv, "base64")).toHaveLength(12);
    expect(first.iv).not.toBe(second.iv);
    expect(first.valueEnc).not.toBe(second.valueEnc);
    expect(first.tag).not.toBe(second.tag);
  });

  it("fails decryption when the authentication tag is tampered with", () => {
    const payload = encrypt("value-under-test", 1);
    const tag = Buffer.from(payload.tag, "base64");
    tag[0] = (tag[0] ?? 0) ^ 0xff;
    expect(() =>
      decrypt({ ...payload, tag: tag.toString("base64") }),
    ).toThrow();
  });

  it("fails decryption when the ciphertext is tampered with", () => {
    const payload = encrypt("value-under-test", 1);
    const value = Buffer.from(payload.valueEnc, "base64");
    value[0] = (value[0] ?? 0) ^ 0xff;
    expect(() =>
      decrypt({ ...payload, valueEnc: value.toString("base64") }),
    ).toThrow();
  });

  it("fails decryption under a different master key", () => {
    const payload = encrypt("value-under-test", 1);
    process.env.ENV_MASTER_KEY = randomHex(32);
    try {
      expect(() => decrypt(payload)).toThrow();
    } finally {
      process.env.ENV_MASTER_KEY = MASTER_KEY;
    }
  });
});

describe("maskValue", () => {
  it("keeps only the first and last four characters of a long value", () => {
    expect(maskValue("sk-live-0123456789abcdef")).toBe("sk-l••••••••cdef");
  });

  it("fully masks short and empty values", () => {
    expect(maskValue("")).toBe("••••");
    expect(maskValue("12345678")).toBe("••••");
    expect(maskValue("123456789")).toBe("1234••••••••6789");
  });

  it("never leaks the middle of a long value", () => {
    const secret = "super-secret-middle-part-value";
    expect(maskValue(secret)).not.toContain("middle");
  });
});

describe("secrets permission map", () => {
  const secretsPermissions: PermissionKey[] = [
    "secrets.view",
    "secrets.reveal",
    "secrets.edit",
    "secrets.export",
  ];

  it("gives root admin every secrets permission including the protected export", () => {
    const admin = principal({ role: "ADMIN", accessLevel: ROLES.ADMIN });
    for (const permission of secretsPermissions) {
      expect(can(admin, permission)).toBe(true);
    }
  });

  it("lets a developer list and reveal but not edit or export", () => {
    const dev = principal();
    expect(can(dev, "secrets.view")).toBe(true);
    expect(can(dev, "secrets.reveal")).toBe(true);
    expect(can(dev, "secrets.edit")).toBe(false);
    expect(can(dev, "secrets.export")).toBe(false);
  });

  it("denies every secrets permission to a plain user", () => {
    const user = principal({ role: "USER", accessLevel: ROLES.USER });
    for (const permission of secretsPermissions) {
      expect(can(user, permission)).toBe(false);
    }
  });

  it("keeps a system-protected permission out of reach of an allow override", () => {
    const user = principal({
      role: "USER",
      accessLevel: ROLES.USER,
      overrides: { "secrets.export": "allow" },
    });
    expect(can(user, "secrets.export")).toBe(false);
  });

  it("honours an explicit deny override over the role grant", () => {
    const dev = principal({ overrides: { "secrets.reveal": "deny" } });
    expect(can(dev, "secrets.reveal")).toBe(false);
    expect(can(dev, "secrets.view")).toBe(true);
  });

  it("honours an allow override for a non-protected permission", () => {
    const user = principal({
      role: "USER",
      accessLevel: ROLES.USER,
      overrides: { "secrets.view": "allow" },
    });
    expect(can(user, "secrets.view")).toBe(true);
    expect(can(user, "secrets.reveal")).toBe(false);
  });

  it("fails closed for unknown permissions, malformed roles and disabled principals", () => {
    expect(can(principal(), "secrets.nope")).toBe(false);
    expect(can(principal({ role: "ROOT" as never }), "secrets.view")).toBe(false);
    expect(can(principal({ disabled: true }), "secrets.view")).toBe(false);
    expect(can(null, "secrets.view")).toBe(false);
  });

  it("reports effective capabilities without the protected export for a developer", () => {
    const effective = getEffectivePermissions(principal());
    expect(effective).toContain("secrets.view");
    expect(effective).toContain("secrets.reveal");
    expect(effective).not.toContain("secrets.export");
    expect(effective).not.toContain("secrets.edit");
  });

  it("reports every permission for root admin", () => {
    const effective = getEffectivePermissions(
      principal({ role: "ADMIN", accessLevel: ROLES.ADMIN }),
    );
    for (const permission of secretsPermissions) {
      expect(effective).toContain(permission);
    }
  });
});
