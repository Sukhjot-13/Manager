import crypto from "node:crypto";

function topFrame(stack: string): string {
  if (stack === "") {
    return "";
  }
  const line = stack.split("\n").find((candidate) => candidate.trim() !== "");
  return line?.trim() ?? "";
}

export function normalizeMessage(message: string): string {
  return message
    .replace(/0x[0-9a-f]+/gi, "0xX")
    .replace(/\b\d{2,}\b/g, "N")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "UUID")
    .trim();
}

export function fingerprint(message: string, stack = ""): string {
  return crypto
    .createHash("sha256")
    .update(`${normalizeMessage(message)}::${topFrame(stack)}`)
    .digest("hex")
    .slice(0, 16);
}

const REDACTED = "***";

export function redactValue(
  key: string,
  value: unknown,
  redactKeys: readonly string[],
): unknown {
  if (
    typeof key === "string" &&
    redactKeys.some((needle) => key.toLowerCase().includes(needle.toLowerCase()))
  ) {
    return REDACTED;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue("", entry, redactKeys));
  }
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      output[entryKey] = redactValue(entryKey, entryValue, redactKeys);
    }
    return output;
  }
  return value;
}

export function redactMeta(
  meta: unknown,
  redactKeys: readonly string[],
): unknown {
  return redactValue("", meta, redactKeys);
}

export function stripControlChars(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export function capString(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
