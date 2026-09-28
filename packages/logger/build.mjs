import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, "src");
const distDir = resolve(here, "dist");
const outFile = resolve(distDir, "logger.ts");
const outFileJs = resolve(distDir, "logger.js");

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

const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const ts = require("typescript");

function emitJavaScript(source) {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      removeComments: false,
      newLine: ts.NewLineKind.LineFeed,
    },
  });
  return result.outputText;
}

const banner = `/**
 * @manager/logger — single-file, zero-dependency logging SDK.
 *
 * GENERATED FILE. This is the whole SDK: no install, no runtime dependencies, no registry.
 * Regenerate or update it with:
 *
 *   curl -fsSL -H "x-manager-key: <project-key>" \\
 *     "https://<your-manager-host>/api/sdk/logger" -o src/lib/logger.ts
 *
 * The key is read from the x-manager-key HEADER only (never a query string). Revoking the
 * key stops future downloads and future log delivery. Re-run the command to pick up updates.
 *
 * ---------------------------------------------------------------------------
 * 1. INITIALISE ONCE (isomorphic: works in the browser and in Node)
 * ---------------------------------------------------------------------------
 *
 *   import { initLogger } from "./lib/logger";
 *
 *   const log = initLogger({
 *     endpoint: "https://<your-manager-host>",   // required
 *     appId: "my-store",                        // required, matches the Manager project
 *     apiKey: process.env.MANAGER_LOG_KEY,       // required (mlk_ server / mck_ client)
 *     environment: "production",                 // dev | staging | prod | custom
 *     release: process.env.GIT_SHA,              // optional version label
 *     captureConsole: ["warn", "error"],         // forward console.* at these levels
 *     captureGlobalErrors: true,                 // uncaught errors + unhandled rejections
 *     captureFetch: true,                        // browser: fetch/XHR status + duration
 *     redactKeys: ["password", "token", "authorization"],  // masked as *** before sending
 *     sampleRate: { debug: 0.1 },                // per-level sampling, 0..1
 *   });
 *
 * ---------------------------------------------------------------------------
 * 2. LOG
 * ---------------------------------------------------------------------------
 *
 *   log.trace("render", { component: "Cart" });
 *   log.debug("cache_hit", { key });
 *   log.info("order_created", { orderId });
 *   await log.warn("slow_response", { ms: 1800 });
 *   log.error("payment_failed", { code: "card_declined" });
 *   log.fatal("db_unreachable");
 *
 * Levels: trace | debug | info | warn | error | fatal
 *
 * Child loggers inherit bound context:
 *   const req = log.child({ requestId, userId });
 *   req.info("order_created", { orderId });
 *
 * Timers record durationMs without a tracing library:
 *   log.time("db_query");
 *   const rows = await runQuery();
 *   const ms = log.timeEnd("db_query");   // also sends the timing entry
 *
 * ---------------------------------------------------------------------------
 * 3. TRACE CORRELATION (the client -> server story in one view)
 * ---------------------------------------------------------------------------
 *
 * The SDK sends x-trace-id on wrapped fetch/XHR calls. On the server, adopt the incoming
 * trace so both sides appear together in Manager's "Together" view:
 *
 *   const trace = log.withTrace(req.headers.get("x-trace-id") ?? log.newTrace());
 *   trace.info("query_start", { sql });
 *
 * ---------------------------------------------------------------------------
 * 4. SHUTDOWN
 * ---------------------------------------------------------------------------
 *
 *   await log.flush();   // Node also flushes automatically on SIGINT/SIGTERM/beforeExit,
 *                        // and the browser flushes on pagehide/visibilitychange.
 *
 * ---------------------------------------------------------------------------
 * 5. WHAT HAPPENS UNDER THE HOOD
 * ---------------------------------------------------------------------------
 *
 * - Batching: sends after 20 entries or 5 seconds, whichever comes first.
 * - Delivery: navigator.sendBeacon on unload, fetch(keepalive) elsewhere.
 * - Retries: exponential backoff with jitter.
 * - Offline: queued (localStorage in the browser, memory in Node) and replayed on reconnect.
 * - Auto-context (browser): URL, route, referrer, UA + parsed browser/OS/device, viewport,
 *   screen, language, timezone, connection type, sessionId, pageId.
 * - Auto-context (server): hostname, pid, runtime version, RSS memory, uptime.
 * - Fingerprinting: identical errors collapse into one grouped row with a counter.
 * - Self-protection: internal rate limiter (~50 logs/s), hard payload caps, and it never logs
 *   its own transport failures.
 * - captureGlobalErrors captures window.onerror + unhandledrejection in the browser. In Node it
 *   deliberately does NOT attach process listeners unless you pass captureProcessErrors: true,
 *   because frameworks like Next.js own process error handling and extra listeners there can
 *   silently stop delivery. Log from your error boundary instead.
 * - Privacy: IP addresses, request ids and receivedAt are stamped server-side by Manager and
 *   can never be forged from the payload.
 *
 * ---------------------------------------------------------------------------
 * 6. NO SDK? PLAIN HTTP
 * ---------------------------------------------------------------------------
 *
 *   Delivery tuning (optional, usually right for a server):
 *     flushIntervalMs: 250    // batch window; lower = fresher, more requests
 *     maxLogsPerSecond: 500   // self-protection ceiling; the server enforces the real limit
 *   Both defaults are sized for server code. A burst of N lines becomes ONE request per
 *   batch window, not one per line, and anything this client had to drop is reported as a
 *   warn entry named manager_sdk_dropped_entries instead of vanishing.
 *
 * ---------------------------------------------------------------------------
 * 7. PLAIN HTTP EQUIVALENT
 * ---------------------------------------------------------------------------
 *
 *   POST https://<your-manager-host>/api/ingest/logs
 *   headers: content-type: application/json
 *            x-api-key: <project-key>
 *   body:    {"logs":[{"level":"info","message":"job_done","ts":1700000000000,
 *                     "meta":{"any":"json"}}]}
 *
 * Limits: <=100 entries per batch, message <=1 KB, meta <=8 KB JSON, body <=128 KB.
 * Entries with a ts older than 24 h or more than 10 min in the future are rejected.
 * A server key can only write source:"server" rows and a client key only source:"client";
 * analytics keys cannot post logs. Unknown or mismatched keys get a generic 401.
 *
 * Where to look in Manager: project -> Logs (filters, trace view, error grouping, live tail,
 * CSV/JSON export) and project -> Keys (mint/revoke, last used).
 */`.trim();


const output = `${banner}\n\n${types.trim()}\n\n${runtime.trim()}\n\nexport { ${publicApi.join(", ")} };\n`;

if (/^\s*(?:import|require)\b/m.test(output)) {
  throw new Error("bundled SDK must be self-contained: no imports allowed");
}

const jsOutput = emitJavaScript(output);
const typeSyntax = jsOutput.match(/^\s*(?:interface|type)\s+\w+|<[A-Za-z_$][\w$]*>\(/m);
if (typeSyntax !== null) {
  throw new Error(`logger.js still contains type syntax near: ${typeSyntax[0]}`);
}

await mkdir(distDir, { recursive: true });
await writeFile(outFile, output, "utf8");
await writeFile(outFileJs, jsOutput, "utf8");
await writeFile(
  resolve(distDir, "logger.source.ts"),
  `export const LOGGER_SDK_SOURCE = ${JSON.stringify(output)};\nexport const LOGGER_SDK_SOURCE_JS = ${JSON.stringify(jsOutput)};\n`,
  "utf8",
);

process.stdout.write(
  `wrote ${outFile} (${output.length} bytes) and ${outFileJs} (${jsOutput.length} bytes)\n`,
);
