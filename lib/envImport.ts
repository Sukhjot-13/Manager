// Shared by the browser preview and vault service; keep this module server-free.
export const MAX_IMPORT_BYTES = 200_000;
export type EnvEntry = { key: string; value: string };
export type ParsedEnvFile = { entries: EnvEntry[]; errors: string[] };

export function parseEnvFile(content: string): ParsedEnvFile {
  const entries: EnvEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  if (new TextEncoder().encode(content).byteLength > MAX_IMPORT_BYTES) {
    return { entries, errors: ["Contents exceed the 200 KB import limit."] };
  }
  if (content.includes("\0")) {
    return { entries, errors: ["Contents must be a text .env file."] };
  }
  const lines = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index].trimStart().replace(/^export\s+/, "");
    if (!line.trim() || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) {
      errors.push(`line ${lineNumber}: expected KEY=value`);
      continue;
    }
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.length > 200) {
      errors.push(`line ${lineNumber}: invalid key name`);
      continue;
    }
    let raw = line.slice(separator + 1).trimStart();
    const quote = raw[0];
    let value = "";
    if (quote === '"' || quote === "'" || quote === "`") {
      let position = 1;
      let closed = false;
      while (true) {
        if (position >= raw.length) {
          if (index + 1 >= lines.length) break;
          raw += `\n${lines[++index]}`;
          continue;
        }
        const character = raw[position++];
        if (character === quote) {
          closed = true;
          break;
        }
        if (quote === '"' && character === "\\") {
          const next = raw[position];
          if (next === "n" || next === "r" || next === '"' || next === "\\") {
            value += next === "n" ? "\n" : next === "r" ? "\r" : next;
            position += 1;
            continue;
          }
        }
        value += character;
      }
      if (!closed) {
        errors.push(`line ${lineNumber}: unterminated quoted value for ${key}`);
        continue;
      }
      const trailing = raw.slice(position).trim();
      if (trailing && !trailing.startsWith("#")) {
        errors.push(`line ${lineNumber}: unexpected text after quoted value for ${key}`);
        continue;
      }
    } else {
      value = raw.split("#", 1)[0].trim();
    }
    if (!value) {
      errors.push(`line ${lineNumber}: empty value for ${key}`);
    } else if (value.length > 20_000) {
      errors.push(`line ${lineNumber}: value for ${key} exceeds 20,000 characters`);
    } else if (seen.has(key)) {
      errors.push(`line ${lineNumber}: duplicate key ${key} skipped`);
    } else {
      seen.add(key);
      entries.push({ key, value });
    }
  }
  return { entries, errors };
}

export async function readEnvImportFile(files: readonly File[]): Promise<string> {
  if (files.length !== 1 || !/\.env$/i.test(files[0].name)) {
    throw new Error("Choose or drop one .env file only.");
  }
  const file = files[0];
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error("The .env file exceeds the 200 KB import limit.");
  }
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    if (content.includes("\0")) throw new Error("binary content");
    return content;
  } catch {
    throw new Error("Could not read the file. Choose a UTF-8 text .env file.");
  }
}
