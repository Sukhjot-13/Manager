import crypto from "node:crypto";

const IV_BYTES = 12;
const ALGORITHM = "aes-256-gcm";

export class VaultConfigurationError extends Error {
  constructor(reason: "missing" | "invalid") {
    super(reason === "missing"
      ? "Manager's ENV_MASTER_KEY is missing. Restore the existing vault key in the production environment and redeploy."
      : "Manager's ENV_MASTER_KEY must contain exactly 64 hexadecimal characters. Restore the existing vault key in the production environment and redeploy.");
    this.name = "VaultConfigurationError";
  }
}

export type EncryptedValue = {
  valueEnc: string;
  iv: string;
  tag: string;
  keyVer: number;
};

export function vaultKeyStatus(): "ready" | "missing" | "invalid" {
  const value = process.env.ENV_MASTER_KEY?.trim() ?? "";
  if (!value) return "missing";
  return /^[0-9a-fA-F]{64}$/.test(value) ? "ready" : "invalid";
}

function masterKeyBytes(): Buffer {
  const status = vaultKeyStatus();
  if (status !== "ready") throw new VaultConfigurationError(status);
  return Buffer.from(process.env.ENV_MASTER_KEY!.trim(), "hex");
}

export function encrypt(plaintext: string, keyVer = 1): EncryptedValue {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKeyBytes(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    valueEnc: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVer,
  };
}

export function decrypt(payload: EncryptedValue): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    masterKeyBytes(),
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.valueEnc, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskValue(value: string): string {
  if (value.length === 0) {
    return "••••";
  }
  if (value.length <= 8) {
    return "••••";
  }
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}

export function reencryptWithNewKey(
  payload: EncryptedValue,
  newKeyHex: string,
  newKeyVer: number,
): EncryptedValue {
  const previous = process.env.ENV_MASTER_KEY;
  const plaintext = decrypt(payload);
  process.env.ENV_MASTER_KEY = newKeyHex;
  try {
    return encrypt(plaintext, newKeyVer);
  } finally {
    if (previous === undefined) {
      delete process.env.ENV_MASTER_KEY;
    } else {
      process.env.ENV_MASTER_KEY = previous;
    }
  }
}

export function decryptWithKey(
  payload: EncryptedValue,
  keyHex: string,
): string {
  const previous = process.env.ENV_MASTER_KEY;
  process.env.ENV_MASTER_KEY = keyHex;
  try {
    return decrypt(payload);
  } finally {
    if (previous === undefined) {
      delete process.env.ENV_MASTER_KEY;
    } else {
      process.env.ENV_MASTER_KEY = previous;
    }
  }
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function randomHex(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}
