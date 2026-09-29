/**
 * @manager/logger — single-file, zero-dependency logging SDK.
 *
 * GENERATED FILE. This is the whole SDK: no install, no runtime dependencies, no registry.
 * Regenerate or update it with:
 *
 *   curl -fsSL -H "x-manager-key: <project-key>" \
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
 */
const LOG_SDK_VERSION = "0.1.0";
const LOG_SDK_PATH = "/api/ingest/logs";
const TRACE_HEADER = "x-trace-id";
const LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"];
const ERROR_LEVELS = ["error", "fatal"];
const ALWAYS_KEPT = ["error", "fatal"];
const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH_SIZE = 20;
/**
 * Self-protection ceiling, per client process.
 *
 * This is a runaway guard, not the real limit: the ingest endpoint enforces the
 * authoritative per-key rate limit, and repeated errors collapse by fingerprint. A 50/s
 * cap silently threw away most of a busy server's output, so the default is generous and
 * anything dropped is reported (see reportDrops) rather than vanishing.
 */
const MAX_LOGS_PER_SECOND = 500;
const DROP_REPORT_EVERY = 250;
const MAX_QUEUE_SIZE = 200;
const MAX_MESSAGE_CHARS = 1024;
const MAX_STACK_CHARS = 8000;
const MAX_META_BYTES = 8192;
const MAX_BODY_BYTES = 96 * 1024;
const MAX_RETRIES = 4;
const MAX_FLUSH_ROUNDS = 12;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30000;
const OFFLINE_STORAGE_KEY = "manager.logger.queue";
const OFFLINE_QUEUE_MAX = 100;
const GROUP_WINDOW_MS = 60000;
const MAX_GROUPS = 200;
const REDACTED = "***";
const MAX_DEPTH = 8;
const MAX_COLLECTION = 50;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const FIELD_CAPS = {
    sessionId: 80,
    pageId: 80,
    traceId: 80,
    requestId: 80,
    url: 500,
    route: 200,
    referrer: 500,
    ua: 500,
    viewport: 40,
    lang: 40,
    tz: 60,
    connection: 40,
    appVersion: 60,
    environment: 40,
    release: 80,
    hostname: 120,
    runtimeVersion: 60,
};
const DEFAULT_REDACT_KEYS = [
    "password",
    "passwd",
    "token",
    "authorization",
    "secret",
    "apikey",
    "api_key",
    "credential",
    "cookie",
];
const live = new Set();
let memoryQueue = [];
let globalsInstalled = false;
let transportDepth = 0;
function isBrowser() {
    return typeof window !== "undefined" && typeof document !== "undefined";
}
function trim(value, max) {
    return value.length <= max ? value : value.slice(0, max);
}
function stripControl(value) {
    return value.replace(CONTROL_CHARS, "");
}
function stringify(value) {
    if (typeof value === "string") {
        return value;
    }
    if (value instanceof Error) {
        return `${value.name}: ${value.message}`;
    }
    try {
        const json = JSON.stringify(value);
        return json === undefined ? String(value) : json;
    }
    catch {
        return String(value);
    }
}
function randomToken(prefix) {
    const cryptoRef = globalThis.crypto;
    if (typeof cryptoRef?.randomUUID === "function") {
        return `${prefix}_${cryptoRef.randomUUID()}`;
    }
    if (typeof cryptoRef?.getRandomValues === "function") {
        const bytes = cryptoRef.getRandomValues(new Uint8Array(8));
        let out = "";
        for (const byte of bytes) {
            out += byte.toString(16).padStart(2, "0");
        }
        return `${prefix}_${out}`;
    }
    return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
function escapePattern(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function redactString(value, redactKeys) {
    let output = value;
    for (const needle of redactKeys) {
        if (needle === "") {
            continue;
        }
        const pattern = new RegExp(`(${escapePattern(needle)})(\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^\\s,;)]+)`, "gi");
        output = output.replace(pattern, `$1$2${REDACTED}`);
    }
    return output;
}
function redactValue(value, redactKeys, depth = 0) {
    if (depth > MAX_DEPTH) {
        return "[depth]";
    }
    if (typeof value === "string") {
        return trim(redactString(value, redactKeys), MAX_MESSAGE_CHARS);
    }
    if (value === null || typeof value !== "object") {
        return value;
    }
    if (value instanceof Error) {
        return { name: value.name, message: redactString(value.message, redactKeys) };
    }
    if (Array.isArray(value)) {
        return value
            .slice(0, MAX_COLLECTION)
            .map((entry) => redactValue(entry, redactKeys, depth + 1));
    }
    const output = {};
    for (const [key, entry] of Object.entries(value).slice(0, MAX_COLLECTION)) {
        const sensitive = redactKeys.some((needle) => key.toLowerCase().includes(needle.toLowerCase()));
        output[key] = sensitive ? REDACTED : redactValue(entry, redactKeys, depth + 1);
    }
    return output;
}
function fingerprint(message, stack) {
    const frame = stack.split("\n").map((line) => line.trim()).find((line) => line !== "") ?? "";
    const input = `${message}::${frame}`;
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let index = 0; index < input.length; index += 1) {
        const code = input.charCodeAt(index);
        h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
        h2 = Math.imul(h2 + code + index, 0x85ebca6b) >>> 0;
    }
    return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}
function stackOf(value) {
    if (typeof value === "object" && value !== null && "stack" in value && typeof value.stack === "string") {
        return value.stack;
    }
    return "";
}
function timeZone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    }
    catch {
        return "";
    }
}
function clientContext() {
    const nav = navigator;
    const width = typeof window.innerWidth === "number" ? window.innerWidth : 0;
    const height = typeof window.innerHeight === "number" ? window.innerHeight : 0;
    const screenWidth = nav.screen?.width ?? 0;
    const screenHeight = nav.screen?.height ?? 0;
    const context = {
        url: trim(window.location.href, FIELD_CAPS.url),
        referrer: trim(document.referrer, FIELD_CAPS.referrer),
        ua: trim(navigator.userAgent, FIELD_CAPS.ua),
        viewport: trim(`${width}x${height}@${screenWidth}x${screenHeight}`, FIELD_CAPS.viewport),
        lang: trim(navigator.language, FIELD_CAPS.lang),
        tz: trim(timeZone(), FIELD_CAPS.tz),
        route: trim(window.location.pathname, FIELD_CAPS.route),
    };
    const effectiveType = nav.connection?.effectiveType;
    if (typeof effectiveType === "string" && effectiveType !== "") {
        context.connection = trim(effectiveType, FIELD_CAPS.connection);
    }
    return context;
}
function serverContext() {
    const proc = globalThis.process;
    if (proc === undefined) {
        return {};
    }
    const context = {};
    if (typeof proc.hostname === "string") {
        context.hostname = trim(proc.hostname, FIELD_CAPS.hostname);
    }
    if (typeof proc.pid === "number") {
        context.pid = proc.pid;
    }
    if (typeof proc.version === "string") {
        context.runtimeVersion = trim(proc.version, FIELD_CAPS.runtimeVersion);
    }
    try {
        const rss = proc.memoryUsage?.().rss;
        if (typeof rss === "number") {
            context.rssMb = Math.round(rss / 1048576);
        }
    }
    catch {
        void 0;
    }
    try {
        const uptime = proc.uptime?.();
        if (typeof uptime === "number") {
            context.uptimeSec = Math.round(uptime);
        }
    }
    catch {
        void 0;
    }
    return context;
}
function baseContext() {
    return isBrowser() ? clientContext() : serverContext();
}
function withinCaps(entry) {
    if (entry.message.length > MAX_MESSAGE_CHARS) {
        return false;
    }
    if (typeof entry.stack === "string" && entry.stack.length > MAX_STACK_CHARS) {
        return false;
    }
    if (entry.meta !== undefined) {
        let serialized;
        try {
            serialized = JSON.stringify(entry.meta) ?? "";
        }
        catch {
            return false;
        }
        if (serialized.length > MAX_META_BYTES) {
            return false;
        }
    }
    const record = entry;
    for (const [field, cap] of Object.entries(FIELD_CAPS)) {
        const value = record[field];
        if (typeof value === "string" && value.length > cap) {
            return false;
        }
    }
    return true;
}
function buildEntry(state, bindings, level, message, meta, stack, durationMs) {
    const entry = {
        level,
        message: trim(stripControl(redactString(stringify(message), state.config.redactKeys)), MAX_MESSAGE_CHARS),
        ts: Date.now(),
        sessionId: state.sessionId,
        pageId: state.pageId,
        traceId: state.trace.value,
        environment: state.config.environment,
        release: state.config.release,
        appVersion: state.config.appVersion,
    };
    for (const [key, value] of Object.entries(baseContext())) {
        entry[key] = value;
    }
    if (bindings.requestId !== undefined) {
        entry.requestId = trim(stringify(bindings.requestId), FIELD_CAPS.requestId);
    }
    if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
        entry.durationMs = Math.max(0, Math.round(durationMs));
    }
    if (stack !== "") {
        entry.stack = trim(stripControl(redactString(stack, state.config.redactKeys)), MAX_STACK_CHARS);
    }
    if (meta !== undefined) {
        const merged = typeof meta === "object" && meta !== null && !Array.isArray(meta)
            ? { ...bindings, ...meta }
            : { bindings, value: meta };
        entry.meta = redactValue(merged, state.config.redactKeys);
    }
    else if (Object.keys(bindings).length > 0) {
        entry.meta = redactValue(bindings, state.config.redactKeys);
    }
    return entry;
}
function takeTokens(state) {
    const now = Date.now();
    const elapsed = Math.max(0, now - state.lastRefill);
    const refillPerMs = state.config.maxLogsPerSecond / 1000;
    state.tokens = Math.min(state.config.maxLogsPerSecond, state.tokens + elapsed * refillPerMs);
    state.lastRefill = now;
    if (state.tokens < 1) {
        state.dropped += 1;
        reportDrops(state, "rate_limited");
        return false;
    }
    state.tokens -= 1;
    return true;
}
/**
 * Surfaces silently-discarded entries as a single warn-level entry, so a client that
 * outran its own ceiling is visible in the log viewer instead of quietly losing data.
 * Reports at most once per DROP_REPORT_EVERY drops and never recurses.
 */
function reportDrops(state, reason) {
    if (transportDepth > 0) {
        return;
    }
    if (state.dropped < DROP_REPORT_EVERY) {
        return;
    }
    if (state.reportedDrops >= state.dropped) {
        return;
    }
    const since = state.dropped - state.reportedDrops;
    state.reportedDrops = state.dropped;
    const entry = buildEntry(state, rootBindings(state), "warn", "manager_sdk_dropped_entries", { dropped: since, totalDropped: state.dropped, reason }, "", undefined);
    transportDepth += 1;
    try {
        state.queue.push(entry);
        void flush(state, {});
    }
    catch {
        /* never throw from the drop reporter */
    }
    finally {
        transportDepth -= 1;
    }
}
function shouldSample(state, level) {
    if (ALWAYS_KEPT.includes(level)) {
        return true;
    }
    const rate = state.config.sampleRate[level] ?? 1;
    if (rate >= 1) {
        return true;
    }
    if (rate <= 0) {
        state.dropped += 1;
        return false;
    }
    if (Math.random() < rate) {
        return true;
    }
    state.dropped += 1;
    return false;
}
function storage() {
    if (!isBrowser()) {
        return null;
    }
    try {
        return window.localStorage;
    }
    catch {
        return null;
    }
}
function readOffline() {
    const store = storage();
    if (store === null) {
        return memoryQueue.slice(0, OFFLINE_QUEUE_MAX);
    }
    try {
        const raw = store.getItem(OFFLINE_STORAGE_KEY);
        if (raw === null || raw === "") {
            return [];
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.slice(0, OFFLINE_QUEUE_MAX) : [];
    }
    catch {
        return [];
    }
}
function writeOffline(entries) {
    const capped = entries.slice(-OFFLINE_QUEUE_MAX);
    const store = storage();
    if (store === null) {
        memoryQueue = capped;
        return;
    }
    try {
        if (capped.length === 0) {
            store.removeItem(OFFLINE_STORAGE_KEY);
            return;
        }
        store.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(capped));
    }
    catch {
        void 0;
    }
}
function resolveFetch() {
    const candidate = globalThis.fetch;
    if (typeof candidate !== "function") {
        return null;
    }
    return candidate;
}
function statusOf(response) {
    if (typeof response === "object" && response !== null) {
        const record = response;
        if (typeof record.status === "number") {
            return record.status;
        }
    }
    return 0;
}
function splitBySize(entries, maxBytes) {
    const chunks = [];
    let current = [];
    let size = 0;
    for (const entry of entries) {
        let entrySize = 0;
        try {
            entrySize = JSON.stringify(entry).length + 1;
        }
        catch {
            entrySize = MAX_MESSAGE_CHARS;
        }
        if (current.length > 0 && size + entrySize > maxBytes) {
            chunks.push(current);
            current = [];
            size = 0;
        }
        current.push(entry);
        size += entrySize;
    }
    if (current.length > 0) {
        chunks.push(current);
    }
    return chunks;
}
async function post(state, batch, keepalive) {
    const fetchImpl = resolveFetch();
    if (fetchImpl === null) {
        return 0;
    }
    let pending;
    transportDepth += 1;
    try {
        pending = fetchImpl(state.config.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": state.config.apiKey,
                [TRACE_HEADER]: state.trace.value,
            },
            body: JSON.stringify({ logs: batch }),
            keepalive,
            credentials: "omit",
            mode: "cors",
        });
    }
    finally {
        transportDepth -= 1;
    }
    // Suppress interception only while invoking our transport, not while its network
    // request is pending: unrelated console errors and app fetches must still be captured.
    return statusOf(await pending);
}
function beacon(state, batch) {
    if (!isBrowser() || typeof Blob !== "function") {
        return false;
    }
    const nav = navigator;
    if (typeof nav.sendBeacon !== "function") {
        return false;
    }
    try {
        return nav.sendBeacon(state.config.url, new Blob([JSON.stringify({ logs: batch })], {
            type: "application/json",
        }));
    }
    catch {
        return false;
    }
}
function storeOffline(state, batch) {
    writeOffline(readOffline().concat(batch).slice(-OFFLINE_QUEUE_MAX));
    state.offline = true;
}
async function deliver(state, batch, final) {
    for (const chunk of splitBySize(batch, MAX_BODY_BYTES)) {
        let status = 0;
        try {
            status = await post(state, chunk, final);
        }
        catch {
            storeOffline(state, chunk);
            continue;
        }
        if (status === 0 || status === 429 || status >= 500) {
            storeOffline(state, chunk);
            continue;
        }
        if (status >= 400) {
            state.dropped += chunk.length;
        }
    }
}
function unref(timer) {
    const handle = timer;
    if (typeof handle.unref === "function") {
        handle.unref();
    }
}
function clearRetry(state) {
    if (state.retryTimer !== null) {
        clearTimeout(state.retryTimer);
        state.retryTimer = null;
    }
}
function clearFlush(state) {
    if (state.flushTimer !== null) {
        clearTimeout(state.flushTimer);
        state.flushTimer = null;
    }
}
function scheduleFlush(state) {
    if (state.flushTimer !== null || state.closed) {
        return;
    }
    state.flushTimer = setTimeout(() => {
        state.flushTimer = null;
        void flush(state, {});
    }, state.config.flushIntervalMs);
    unref(state.flushTimer);
}
function scheduleRetry(state) {
    if (state.attempt >= MAX_RETRIES || state.closed) {
        return;
    }
    clearRetry(state);
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** state.attempt);
    const delay = Math.round(base * (0.5 + Math.random()));
    state.attempt += 1;
    state.retryTimer = setTimeout(() => {
        state.retryTimer = null;
        void flush(state, { final: true });
    }, delay);
    unref(state.retryTimer);
}
async function runFlush(state, options) {
    clearFlush(state);
    const pending = readOffline();
    if (pending.length > 0) {
        writeOffline([]);
        state.queue = pending.concat(state.queue);
    }
    const batches = [];
    while (state.queue.length > 0) {
        batches.push(state.queue.splice(0, state.config.maxBatchSize));
    }
    for (const batch of batches) {
        await deliver(state, batch, options.final === true);
    }
    const failed = readOffline();
    if (failed.length > 0) {
        state.offline = true;
        if (state.queue.length > 0) {
            state.queue = state.queue.slice(-state.config.maxQueueSize);
        }
        if (options.beacon !== true) {
            scheduleRetry(state);
        }
        return false;
    }
    state.offline = false;
    state.attempt = 0;
    clearRetry(state);
    if (state.queue.length > 0) {
        scheduleFlush(state);
    }
    return true;
}
async function flush(state, options) {
    for (let round = 0; round < MAX_FLUSH_ROUNDS; round += 1) {
        if (state.closed) {
            return;
        }
        const inflight = state.current;
        if (inflight !== null) {
            await inflight;
            continue;
        }
        if (state.queue.length === 0 && readOffline().length === 0) {
            return;
        }
        state.flushing = true;
        let delivered = false;
        const run = runFlush(state, options).then((ok) => {
            delivered = ok;
            return undefined;
        });
        state.current = run
            .catch(() => undefined)
            .then(() => {
            state.flushing = false;
            state.current = null;
        });
        await state.current;
        if (!delivered) {
            return;
        }
    }
}
function collapseRepeat(state, entry) {
    if (!ERROR_LEVELS.includes(entry.level)) {
        return false;
    }
    const key = `${entry.traceId}:${fingerprint(entry.message, entry.stack ?? "")}`;
    const existing = state.groups.get(key);
    const now = Date.now();
    if (existing !== undefined && state.queue.includes(existing.entry) && now - existing.at <= GROUP_WINDOW_MS) {
        const meta = typeof existing.entry.meta === "object" && existing.entry.meta !== null
            ? existing.entry.meta
            : {};
        const seen = typeof meta.count === "number" ? meta.count : 1;
        meta.count = seen + 1;
        meta.lastSeenAt = entry.ts;
        existing.entry.meta = meta;
        existing.at = now;
        return true;
    }
    state.groups.set(key, { entry, at: now });
    if (state.groups.size > MAX_GROUPS) {
        const oldest = state.groups.keys().next();
        if (oldest.done !== true) {
            state.groups.delete(oldest.value);
        }
    }
    return false;
}
function enqueue(state, entry) {
    if (state.closed) {
        return;
    }
    if (!withinCaps(entry)) {
        state.dropped += 1;
        return;
    }
    if (collapseRepeat(state, entry)) {
        return;
    }
    state.queue.push(entry);
    if (state.queue.length > state.config.maxQueueSize) {
        state.queue = state.queue.slice(-state.config.maxQueueSize);
        state.dropped += 1;
        reportDrops(state, "queue_overflow");
    }
    if (state.queue.length >= state.config.maxBatchSize) {
        void flush(state, {});
        return;
    }
    scheduleFlush(state);
}
function rootBindings(state) {
    return { appId: state.config.appId };
}
function makeMethod(state, bindings, trace, level) {
    return (message, meta, durationMs) => {
        if (state.closed) {
            return;
        }
        if (!shouldSample(state, level) || !takeTokens(state)) {
            return;
        }
        const error = typeof meta === "object" && meta !== null && !Array.isArray(meta)
            ? meta.error
            : undefined;
        const stack = ERROR_LEVELS.includes(level) ? stackOf(error) || stackOf(bindings.error) : "";
        enqueue(state, buildEntry({ ...state, trace }, bindings, level, message, meta, stack, durationMs));
    };
}
function createLogger(state, bindings, trace) {
    const emitInfo = makeMethod(state, bindings, trace, "info");
    const logger = {
        trace: makeMethod(state, bindings, trace, "trace"),
        debug: makeMethod(state, bindings, trace, "debug"),
        info: emitInfo,
        warn: makeMethod(state, bindings, trace, "warn"),
        error: makeMethod(state, bindings, trace, "error"),
        fatal: makeMethod(state, bindings, trace, "fatal"),
        child(childBindings) {
            const extra = typeof childBindings === "object" && childBindings !== null && !Array.isArray(childBindings)
                ? childBindings
                : { value: childBindings };
            return createLogger(state, { ...bindings, ...extra }, trace);
        },
        time(label) {
            state.timers.set(label, Date.now());
        },
        timeEnd(label, meta) {
            const started = state.timers.get(label);
            if (started === undefined) {
                return null;
            }
            state.timers.delete(label);
            const durationMs = Date.now() - started;
            const payload = typeof meta === "object" && meta !== null && !Array.isArray(meta)
                ? { ...meta, label }
                : { label, value: meta ?? null };
            emitInfo(label, payload, durationMs);
            return durationMs;
        },
        async flush(options) {
            await flush(state, options ?? {});
        },
        setContext(patch) {
            if (typeof patch === "object" && patch !== null && !Array.isArray(patch)) {
                Object.assign(bindings, patch);
            }
        },
        withTrace(traceId) {
            return createLogger(state, bindings, { value: trim(traceId, FIELD_CAPS.traceId) });
        },
        newTrace() {
            state.trace.value = randomToken("t");
            return state.trace.value;
        },
        traceId() {
            return state.trace.value;
        },
        sessionId() {
            return state.sessionId;
        },
        droppedCount() {
            return state.dropped;
        },
    };
    return logger;
}
function installConsole(state) {
    const levels = state.config.consoleLevels;
    if (levels === null || !isBrowser()) {
        return;
    }
    const target = window.console;
    for (const level of levels) {
        const original = target[level];
        if (typeof original !== "function") {
            continue;
        }
        target[level] = (...args) => {
            try {
                original.apply(window.console, args);
            }
            catch {
                void 0;
            }
            if (transportDepth > 0) {
                return;
            }
            try {
                const [first, ...rest] = args;
                const meta = {
                    args: rest.map((entry) => redactValue(entry, state.config.redactKeys)),
                };
                const entry = buildEntry(state, rootBindings(state), level, stringify(first), meta, stackOf(first), undefined);
                enqueue(state, entry);
            }
            catch {
                void 0;
            }
        };
    }
}
function installGlobalErrors(state) {
    const report = (message, meta, stack, level) => {
        try {
            enqueue(state, buildEntry(state, rootBindings(state), level, message, meta, stack, undefined));
        }
        catch {
            void 0;
        }
    };
    if (isBrowser()) {
        window.addEventListener("error", (event) => {
            report(event.message === "" ? "uncaught_error" : event.message, { filename: event.filename, lineno: event.lineno, colno: event.colno }, stackOf(event.error), "fatal");
        });
        window.addEventListener("unhandledrejection", (event) => {
            const reason = event.reason;
            report("unhandled_rejection", { reason: redactValue(reason, state.config.redactKeys) }, stackOf(reason), "fatal");
        });
    }
    if (state.config.captureProcessErrors !== true) {
        return;
    }
    const proc = globalThis.process;
    if (proc === undefined || typeof proc.on !== "function") {
        return;
    }
    proc.on("uncaughtException", (error) => {
        report("uncaught_exception", {}, stackOf(error), "fatal");
    });
    proc.on("unhandledRejection", (reason) => {
        report("unhandled_rejection", { reason: redactValue(reason, state.config.redactKeys) }, stackOf(reason), "fatal");
    });
}
function injectTraceHeader(headers, traceId) {
    if (typeof headers !== "object" || headers === null) {
        return;
    }
    const record = headers;
    if (typeof record.set !== "function") {
        return;
    }
    try {
        record.set(TRACE_HEADER, traceId);
    }
    catch {
        void 0;
    }
}
function describeInput(input) {
    if (typeof input === "string") {
        return input;
    }
    if (typeof input === "object" && input !== null) {
        const record = input;
        if (typeof record.url === "string") {
            return record.url;
        }
        if (typeof record.href === "string") {
            return record.href;
        }
    }
    return "";
}
function sameOrigin(input) {
    try {
        return new URL(describeInput(input), window.location.href).origin === window.location.origin;
    }
    catch {
        return false;
    }
}
function installFetch(state) {
    if (!isBrowser()) {
        return;
    }
    const target = globalThis;
    const report = (level, meta) => {
        try {
            enqueue(state, buildEntry(state, rootBindings(state), level, "http_request", meta, "", undefined));
        }
        catch {
            void 0;
        }
    };
    if (typeof target.fetch === "function") {
        const original = target.fetch;
        target.fetch = (input, init) => {
            if (transportDepth > 0) {
                return original(input, init);
            }
            const started = Date.now();
            const record = { ...(typeof init === "object" && init !== null ? init : {}) };
            // Fetch accepts objects, tuples, Headers, or inherited Request headers. Clone them
            // so tracing works in every form without mutating the caller's options. Keep
            // third-party requests unchanged to avoid adding cross-origin preflights.
            if (sameOrigin(input)) {
                const inherited = typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined;
                record.headers = new Headers((record.headers ?? inherited));
                injectTraceHeader(record.headers, state.trace.value);
            }
            return original(input, record).then((response) => {
                const status = statusOf(response);
                report("info", {
                    transport: "fetch",
                    url: describeInput(input),
                    status,
                    durationMs: Date.now() - started,
                    ok: status === 0 || status < 400,
                });
                return response;
            }, (error) => {
                report("error", {
                    transport: "fetch",
                    url: describeInput(input),
                    durationMs: Date.now() - started,
                    reason: redactValue(error, state.config.redactKeys),
                });
                throw error;
            });
        };
    }
    const Xhr = target.XMLHttpRequest;
    if (typeof Xhr !== "function") {
        return;
    }
    const proto = Xhr.prototype;
    const originalOpen = proto.open;
    const originalSend = proto.send;
    const originalSetHeader = proto.setRequestHeader;
    proto.open = function patchedOpen(method, url, ...rest) {
        this.__mgrTrace = JSON.stringify({
            method,
            url: String(url),
            started: Date.now(),
        });
        originalOpen.call(this, method, url, ...rest);
    };
    proto.setRequestHeader = function patchedSetRequestHeader(name, value) {
        if (name.toLowerCase() === TRACE_HEADER) {
            return;
        }
        originalSetHeader.call(this, name, value);
    };
    proto.send = function patchedSend(...args) {
        let info = {
            method: "GET",
            url: "",
            started: Date.now(),
        };
        try {
            const raw = this.__mgrTrace;
            info = JSON.parse(raw ?? "{}");
        }
        catch {
            void 0;
        }
        try {
            originalSetHeader.call(this, TRACE_HEADER, state.trace.value);
        }
        catch {
            void 0;
        }
        this.addEventListener("loadend", () => {
            let status = 0;
            try {
                status = this.status;
            }
            catch {
                status = 0;
            }
            report("info", {
                transport: "xhr",
                method: info.method,
                url: info.url,
                status,
                durationMs: Date.now() - info.started,
                ok: status === 0 || status < 400,
            });
        });
        originalSend.apply(this, args);
    };
}
function drain(state, useBeacon) {
    const pending = state.queue.splice(0, state.queue.length);
    if (pending.length === 0) {
        return;
    }
    if (useBeacon && beacon(state, pending)) {
        return;
    }
    state.queue = pending.concat(state.queue);
    void flush(state, { beacon: useBeacon, final: true });
}
function installUnload(state) {
    if (!isBrowser()) {
        return;
    }
    const onHide = () => {
        drain(state, true);
    };
    window.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
}
function installShutdown() {
    const proc = globalThis.process;
    if (proc === undefined || typeof proc.once !== "function") {
        return;
    }
    const handler = () => {
        for (const state of [...live]) {
            drain(state, false);
        }
    };
    proc.once("beforeExit", handler);
    proc.once("SIGINT", handler);
    proc.once("SIGTERM", handler);
}
function bumpPage() {
    for (const state of live) {
        state.pageId = randomToken("pg");
    }
}
function installGlobals() {
    if (globalsInstalled) {
        return;
    }
    globalsInstalled = true;
    if (isBrowser()) {
        const historyRef = window.history;
        const originalPush = historyRef.pushState;
        const originalReplace = historyRef.replaceState;
        historyRef.pushState = function patchedPush(...args) {
            originalPush.apply(this, args);
            bumpPage();
        };
        historyRef.replaceState = function patchedReplace(...args) {
            originalReplace.apply(this, args);
            bumpPage();
        };
        window.addEventListener("popstate", bumpPage);
    }
    const target = globalThis;
    if (typeof target.addEventListener === "function") {
        target.addEventListener("online", () => {
            for (const state of live) {
                void flush(state, { final: true });
            }
        });
    }
    installShutdown();
}
function normalizeEndpoint(endpoint) {
    return endpoint.replace(/\/+$/, "");
}
function normalizeConsoleLevels(value) {
    if (value === undefined || value === null || value === false) {
        return null;
    }
    if (value === true) {
        return LEVELS;
    }
    if (!Array.isArray(value)) {
        return null;
    }
    return value.filter((level) => LEVELS.includes(level));
}
function normalizeSampleRate(value) {
    const rates = {};
    for (const level of LEVELS) {
        rates[level] = 1;
    }
    const clamp = (rate) => Math.min(1, Math.max(0, rate));
    if (typeof value === "number" && Number.isFinite(value)) {
        for (const level of LEVELS) {
            rates[level] = ALWAYS_KEPT.includes(level) ? 1 : clamp(value);
        }
        return rates;
    }
    if (typeof value === "object" && value !== null) {
        for (const [level, rate] of Object.entries(value)) {
            if (typeof rate === "number" && Number.isFinite(rate)) {
                rates[level] = clamp(rate);
            }
        }
    }
    return rates;
}
function positiveInt(value, fallback) {
    if (value === undefined || !Number.isFinite(value) || value < 1) {
        return fallback;
    }
    return Math.trunc(value);
}
function createState(options) {
    const config = {
        url: `${normalizeEndpoint(options.endpoint)}${LOG_SDK_PATH}`,
        appId: options.appId,
        apiKey: options.apiKey,
        environment: trim(options.environment ?? "development", FIELD_CAPS.environment),
        release: trim(options.release ?? "", FIELD_CAPS.release),
        appVersion: trim(options.appVersion ?? options.release ?? "", FIELD_CAPS.appVersion),
        consoleLevels: normalizeConsoleLevels(options.captureConsole),
        captureGlobalErrors: options.captureGlobalErrors === true,
        captureProcessErrors: options.captureProcessErrors === true,
        captureFetch: options.captureFetch === true,
        redactKeys: options.redactKeys === undefined || options.redactKeys.length === 0
            ? DEFAULT_REDACT_KEYS
            : options.redactKeys,
        sampleRate: normalizeSampleRate(options.sampleRate),
        flushIntervalMs: positiveInt(options.flushIntervalMs, FLUSH_INTERVAL_MS),
        maxBatchSize: positiveInt(options.maxBatchSize, MAX_BATCH_SIZE),
        maxLogsPerSecond: positiveInt(options.maxLogsPerSecond, MAX_LOGS_PER_SECOND),
        maxQueueSize: positiveInt(options.maxQueueSize, MAX_QUEUE_SIZE),
    };
    return {
        config,
        queue: [],
        sessionId: randomToken("s"),
        pageId: randomToken("pg"),
        trace: { value: randomToken("t") },
        timers: new Map(),
        groups: new Map(),
        tokens: config.maxLogsPerSecond,
        lastRefill: Date.now(),
        dropped: 0,
        reportedDrops: 0,
        attempt: 0,
        flushTimer: null,
        retryTimer: null,
        current: null,
        flushing: false,
        offline: false,
        closed: false,
    };
}
function initLogger(options) {
    const state = createState(options);
    live.add(state);
    installGlobals();
    if (state.config.consoleLevels !== null) {
        installConsole(state);
    }
    if (state.config.captureGlobalErrors) {
        installGlobalErrors(state);
    }
    if (state.config.captureFetch) {
        installFetch(state);
    }
    installUnload(state);
    if (readOffline().length > 0) {
        void flush(state, { final: true });
    }
    return createLogger(state, rootBindings(state), state.trace);
}
function traceIdFromHeaders(headers) {
    if (typeof headers !== "object" || headers === null) {
        return "";
    }
    const record = headers;
    if (typeof record.get === "function") {
        return trim(record.get(TRACE_HEADER) ?? "", FIELD_CAPS.traceId);
    }
    return "";
}
function shutdownLoggers() {
    for (const state of [...live]) {
        state.closed = true;
        clearFlush(state);
        clearRetry(state);
        live.delete(state);
    }
    memoryQueue = [];
}
export { LOG_SDK_VERSION, LOG_SDK_PATH, TRACE_HEADER, fingerprint, initLogger, traceIdFromHeaders, shutdownLoggers };
