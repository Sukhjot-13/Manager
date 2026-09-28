import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, "src");
const distDir = resolve(here, "dist");
const outFile = resolve(distDir, "logger.ts");

const TYPES_REFERENCE = /^import type \{[\s\S]*?\} from "\.\/types";\n/m;
const EXPORT_PREFIX = /^export (?=(?:type|interface|const|function|let|class)\b)/gm;

async function read(file) {
  return readFile(resolve(srcDir, file), "utf8");
}

function stripTypes(source) {
  return source.replace(EXPORT_PREFIX, "");
}

function stripRuntime(source) {
  return source.replace(TYPES_REFERENCE, "").replace(EXPORT_PREFIX, "");
}

const typesRaw = await read("types.ts");
const runtimeRaw = await read("index.ts");
const types = stripTypes(typesRaw);
const runtime = stripRuntime(runtimeRaw);

const publicApi = [
  ...new Set(
    [...runtimeRaw.matchAll(/^export (?:function|const|class) ([A-Za-z0-9_$]+)/gm)].map(
      (match) => match[1],
    ),
  ),
];
if (publicApi.length === 0) {
  throw new Error("no public API detected in packages/logger/src/index.ts");
}

const banner = [
  "/**",
  " * @manager/logger — single-file, zero-dependency logging SDK.",
  " *",
  " * Generated from packages/logger/src by packages/logger/build.mjs.",
  " * Vendored into an app with:",
  " *   curl -fsSL -H \"x-manager-key: <project-key>\" \\",
  " *     \"https://manager.example.com/api/sdk/logger\" -o src/lib/logger.ts",
  " */",
  "",
].join("\n");

const output = `${banner}\n${types.trim()}\n\n${runtime.trim()}\n\nexport { ${publicApi.join(", ")} };\n`;

if (/^\s*(?:import|require)\b/m.test(output)) {
  throw new Error("bundled SDK must be self-contained: no imports allowed");
}

await mkdir(distDir, { recursive: true });
await writeFile(outFile, output, "utf8");
await writeFile(
  resolve(distDir, "logger.source.ts"),
  `export const LOGGER_SDK_SOURCE = ${JSON.stringify(output)};\n`,
  "utf8",
);

process.stdout.write(
  `wrote ${outFile} (${output.length} bytes, ${output.split("\n").length} lines)\n`,
);
