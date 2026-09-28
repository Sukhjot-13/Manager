"use client";

import { useState } from "react";
import { Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

const FEATURES = [
  "Isomorphic — one file for browser bundles and Node servers",
  "Levels trace · debug · info · warn · error · fatal",
  "Child loggers with bound context (requestId, userId, orderId)",
  "time() / timeEnd() record durationMs without a tracing library",
  "Batching: flushes at 20 entries or 5 s, exponential backoff with jitter",
  "Offline queue (localStorage in the browser, memory in Node) replayed on reconnect",
  "Auto-capture: console levels, uncaught errors, unhandled rejections, fetch/XHR outcomes",
  "Auto-context: URL, referrer, UA, viewport, language, timezone, connection, sessionId, pageId",
  "Server context: hostname, pid, runtime version, RSS, uptime",
  "Trace correlation: x-trace-id on every wrapped fetch/XHR, merged client+server view",
  "Redaction of configured keys before anything leaves the app",
  "Error fingerprinting so a hot loop collapses to one grouped row with a counter",
  "Internal rate limiter (~50 logs/s) and hard payload caps",
  "Never logs its own transport failures; sendBeacon/keepalive flush on unload",
];

const CUSTOM_EVENT_SNIPPET =
  'window.__mgr("event", "signup_clicked", { plan: "pro" })';

const CONTRACT = [
  "Key kinds: mlk_ = server logs, mck_ = browser logs, mak_ = analytics only. An analytics key can never post logs.",
  "A server key may only write source:\"server\" rows and a client key only source:\"client\" — a leaked browser key cannot forge server logs.",
  "Batch limit 100 entries; message ≤ 1 KB; meta ≤ 8 KB JSON; whole request body ≤ 128 KB.",
  "Client timestamps: entries older than 24 h or more than 10 min in the future are rejected (clock-skew guard).",
  "Unknown, revoked or mismatched keys always get the same generic 401 — never a hint about which key exists.",
  "429 + Retry-After when a key exceeds its rate limit; the SDK retries with backoff, raw HTTP clients should too.",
  "ip, country, hostname, pid, runtime, receivedAt and source are stamped by the server and are rejected if you send them.",
  "The SDK rate-limits itself (~50 logs/s) and drops what exceeds it, so a hot loop cannot flood the store.",
];

export function IntegratePanel({
  origin,
  projectSlug,
  analytics,
}: {
  origin: string;
  projectSlug: string;
  analytics: { html: string; maskedHtml: string; hasKey: boolean; scriptUrl: string };
}) {
  const { push } = useToast();
  const [apiKey, setApiKey] = useState("");

  const install = `curl -fsSL -H "x-manager-key: ${apiKey || "<project-key>"}" \\
  "${origin}/api/sdk/logger" -o src/lib/logger.ts`;

  const init = `import { initLogger } from "./lib/logger";

const log = initLogger({
  endpoint: "${origin}",
  appId: "${projectSlug}",
  apiKey: process.env.MANAGER_LOG_KEY ?? "${apiKey || "<project-key>"}",
  environment: process.env.NODE_ENV ?? "development",
  release: process.env.GIT_SHA ?? "dev",
  captureConsole: ["warn", "error"],
  captureGlobalErrors: true,
  captureFetch: typeof window !== "undefined",
  redactKeys: ["password", "token", "authorization"],
  sampleRate: { debug: 0.1 },
});

log.info("app_started", { build: "1.4.2" });
log.error("payment_failed", { code: "card_declined" });

const req = log.child({ requestId });
req.info("order_created", { orderId });

log.time("db_query");
await runQuery();
const dbMs = log.timeEnd("db_query");

// Server: adopt the browser trace so both sides show up together.
const traceId = log.withTrace(req.headers.get("x-trace-id") ?? log.newTrace());
traceId.info("query_start", { sql: "select 1" });

await log.flush();`;

  const http = `curl -X POST "${origin}/api/ingest/logs" \\
  -H "content-type: application/json" \\
  -H "x-api-key: ${apiKey || "<project-key>"}" \\
  -d '{"logs":[{"level":"info","message":"job_done","ts":1700000000000}]}'`;

  const copy = async (value: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      push(`${label} copied`, "success");
    } catch {
      push("clipboard write failed", "error");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>1 · Paste your project key</CardTitle>
          <span className="text-xs text-zinc-500">
            stored in this tab only, never persisted
          </span>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field
            label="API key"
            htmlFor="integrate-key"
            hint="Keys are shown in full once, at creation. Manager only stores a hash."
          >
            <Input
              id="integrate-key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="mlk_… or mck_…"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <p className="flex items-start gap-2 text-xs text-zinc-500">
            <KeyRound size={14} className="mt-0.5 shrink-0" />
            The download is authenticated by the <code>x-manager-key</code> header only —
            never a query string, because URLs leak into shell history, browser history
            and proxy logs. Revoking the key kills every future download and every future
            ingest.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2 · Vendor the SDK</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void copy(install, "install command")}
          >
            <Copy size={14} />
            Copy
          </Button>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-100">
            {install}
          </pre>
          <p className="mt-2 text-xs text-zinc-500">
            Zero dependencies, zero registry, TypeScript types included. Re-run the
            command to pick up SDK updates.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3 · Initialize</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void copy(init, "init snippet")}
          >
            <Copy size={14} />
            Copy
          </Button>
        </CardHeader>
        <CardContent>
          <pre className="max-h-96 overflow-auto rounded-md bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-100">
            {init}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4 · No SDK? Plain HTTP</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void copy(http, "curl example")}
          >
            <Copy size={14} />
            Copy
          </Button>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-100">
            {http}
          </pre>
          <p className="mt-2 text-xs text-zinc-500">
            A <code>server</code> key may only write <code>source:&quot;server&quot;</code>{" "}
            rows, a <code>client</code> key only <code>source:&quot;client&quot;</code>, and an{" "}
            <code>analytics</code> key can never post logs. Entries older than 24 h or more
            than 10 min in the future are rejected.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>5 · Analytics (optional)</CardTitle>
          {analytics.hasKey ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void copy(analytics.html, "tracker snippet")}
            >
              <Copy size={14} />
              Copy
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-2">
          {analytics.hasKey ? (
            <>
              <pre className="overflow-x-auto rounded-md bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-100">
                {analytics.html}
              </pre>
              <p className="text-xs text-zinc-500">
                Paste before your closing <code>&lt;/body&gt;</code> tag. It auto-tracks
                pageviews (SPA routes included), click targets, referrers and UTM params, and
                batches with <code>sendBeacon</code>. Fire your own events with{" "}
                <code>{CUSTOM_EVENT_SNIPPET}</code>. Visitor ids are anonymous,
                cookie-free and rotate daily.
              </p>
            </>
          ) : (
            <p className="text-xs text-zinc-500">
              This project has no <code>analytics</code> key yet. Create one under{" "}
              <a
                href={`/projects/${projectSlug}/keys`}
                className="underline"
              >
                API keys
              </a>{" "}
              to get the exact <code>&lt;script&gt;</code> tag with your key filled in.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contract your app must respect</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-300">
            {CONTRACT.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <span aria-hidden className="text-zinc-400">
                  ·
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What you get</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1.5 text-xs text-zinc-600 md:grid-cols-2 dark:text-zinc-300">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <span aria-hidden className="text-emerald-500">
                  ✓
                </span>
                {feature}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
