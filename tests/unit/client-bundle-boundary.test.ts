import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

/**
 * Guards the client/server boundary.
 *
 * A "use client" component may not reach mongoose, directly or through another module. It
 * is not enough for the import to look innocent: importing a *constant* from a file that
 * also builds a mongoose model bundles mongoose into the browser, Next.js substitutes an
 * empty stub for it, and the page dies at module evaluation before rendering anything. That
 * is exactly how the Projects page shipped broken — the crash was a TypeError about a
 * mongoose model property, thrown from a chunk that only wanted a list of status strings.
 */

const ROOT = resolve(process.cwd());
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

/** Resolves an @/lib/... style specifier to a file on disk. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith("@/")) return null;
  const base = join(ROOT, specifier.slice(2));
  for (const candidate of [
    base,
    ...EXTENSIONS.map((ext) => `${base}${ext}`),
    ...EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

/**
 * Value imports only.
 *
 * `import type { X } from "@/lib/analytics"` is erased by TypeScript and never reaches the
 * bundle, so following it would report half a dozen false alarms and train everyone to ignore
 * this test. What matters is a *value* import — a constant or function — because that is what
 * pulls the module in.
 */
function importsOf(file: string): string[] {
  const specifiers: string[] = [];
  const source = read(file);
  const patterns = [
    /import\s+[^;]*?from\s+["']([^"']+)["']/g,
    /export\s+[^;]*?from\s+["']([^"']+)["']/g,
    /import\s+["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      // Drop type-only statements: they contribute nothing to the bundle.
      if (/^\s*(import|export)\s+type\b/.test(match[0])) continue;
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

function touchesMongoose(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  if (/\bfrom\s+["']mongoose["']/.test(read(file))) return [file];
  const chain: string[] = [];
  for (const specifier of importsOf(file)) {
    const resolved = resolveSpecifier(file, specifier);
    if (resolved === null) continue;
    chain.push(...touchesMongoose(resolved, seen));
  }
  return chain;
}

const clientFiles = walk(join(ROOT, "components")).filter((file) =>
  /^\s*["']use client["']/.test(read(file)),
);

describe("client bundle boundary", () => {
  it("finds the client components it is meant to be checking", () => {
    expect(clientFiles.length).toBeGreaterThan(5);
  });

  it("keeps mongoose out of every client component", () => {
    const offenders: string[] = [];
    for (const file of clientFiles) {
      for (const via of touchesMongoose(file)) {
        offenders.push(`${file.replace(`${ROOT}/`, "")} -> ${via.replace(`${ROOT}/`, "")}`);
      }
    }
    expect(
      offenders,
      `these client components reach mongoose, so the browser bundle crashes at module evaluation:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps the shared project vocabulary free of any import", () => {
    // A constants module that imports anything server-side is how this bug started.
    expect(importsOf(join(ROOT, "lib", "projectTypes.ts"))).toEqual([]);
  });
});
