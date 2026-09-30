"use client";

import { useState } from "react";
import { Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildIntegrationGuide, integrationKey } from "@/lib/integrationGuide";
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
  "Trace correlation: x-trace-id on same-origin wrapped fetch, merged client+server view",
  "Redaction of configured keys before anything leaves the app",
  "Repeated errors are grouped within a queued trace; separate traces and later flushes remain visible",
  "Internal rate limiter (500 logs/s by default) and hard payload caps",
  "Never logs its own transport failures; sendBeacon/keepalive flush on unload",
];

const CUSTOM_EVENT_SNIPPET =
  'window.__mgr?.("event", "signup_clicked", { plan: "pro" })';

const CONTRACT = [
  "Key kinds: mlk_ = server logs, mck_ = browser logs, mak_ = analytics only. An analytics key can never post logs.",
  "Manager derives source from the key: server keys write server logs, client keys write client logs. Never send source or projectId in an entry.",
  "Batch limit 100 entries; message ≤ 1,024 characters; stack ≤ 8,000 characters; meta ≤ 8 KB JSON; whole request body ≤ 128 KB.",
  "Client timestamps: entries older than 24 h or more than 10 min in the future are rejected (clock-skew guard).",
  "Unknown, revoked or mismatched keys always get the same generic 401 — never a hint about which key exists.",
  "429 + Retry-After when a key exceeds its rate limit; the SDK retries with backoff, raw HTTP clients should too.",
  "Manager owns source, ip, country, receivedAt, keyPrefix, projectId, fingerprint, count and _id. Node runtime fields are allowed only with a server key.",
  "The SDK rate-limits itself (500 logs/s by default) and reports dropped entries as manager_sdk_dropped_entries.",
];

function SnippetCard({ title, code, children, copy }: {
  title: string;
  code: string;
  children?: React.ReactNode;
  copy: (code: string, label: string) => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => void copy(code, title)}>
          <Copy size={14} /> Copy
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <pre className="max-h-96 overflow-auto rounded-md bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-100">{code}</pre>
        {children}
      </CardContent>
    </Card>
  );
}

export function IntegratePanel({ origin, projectSlug }: {
  origin: string;
  projectSlug: string;
}) {
  const { push } = useToast();
  const [serverKey, setServerKey] = useState("");
  const [clientKey, setClientKey] = useState("");
  const [analyticsKey, setAnalyticsKey] = useState("");
  const guide = buildIntegrationGuide({ origin, projectSlug, serverKey, clientKey, analyticsKey });
  const fields = [
    { kind: "server" as const, label: "Server log key", prefix: "mlk_", value: serverKey, set: setServerKey },
    { kind: "client" as const, label: "Browser log key", prefix: "mck_", value: clientKey, set: setClientKey },
    { kind: "analytics" as const, label: "Analytics key", prefix: "mak_", value: analyticsKey, set: setAnalyticsKey },
  ];

  async function copy(value: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      push(`${label} copied`, "success");
    } catch {
      push("clipboard write failed", "error");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>1 · Paste your project keys</CardTitle>
          <span className="text-xs text-zinc-500">stored in this tab only, never persisted</span>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-zinc-500">
            Create keys under <a className="underline" href={`/projects/${projectSlug}/keys`}>API keys</a> and copy them at creation. Manager stores a hash and cannot reveal them again. Leave unused channels blank; the examples will show placeholders.
          </p>
          {fields.map((field) => {
            const invalid = field.value.trim() !== "" && !integrationKey(field.value, field.kind);
            return (
              <Field key={field.kind} label={field.label} htmlFor={`integrate-${field.kind}-key`} hint={field.kind === "server" ? "Private: server environment only." : "Intentionally public: browser configuration only."}>
                <Input
                  id={`integrate-${field.kind}-key`}
                  value={field.value}
                  onChange={(event) => field.set(event.target.value)}
                  placeholder={`${field.prefix}…`}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={invalid}
                  aria-describedby={invalid ? `integrate-${field.kind}-error` : undefined}
                />
                {invalid ? <p id={`integrate-${field.kind}-error`} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">Use a {field.prefix} key for this channel. The invalid key is excluded from examples.</p> : null}
              </Field>
            );
          })}
          <p className="flex items-start gap-2 text-xs text-zinc-500">
            <KeyRound size={14} className="mt-0.5 shrink-0" />
            Use keys from this Manager project. The key selects the destination project and log source; appId is SDK context, not authorization. Keep the server key out of NEXT_PUBLIC_ variables, HTML and browser code.
          </p>
        </CardContent>
      </Card>

      <SnippetCard title="2 · Vendor the SDK" code={guide.install} copy={copy}>
        <p className="text-xs text-zinc-500">Choose the JavaScript or TypeScript download. Both are complete, zero-dependency files. A server or client log key authenticates the x-manager-key header; an analytics key cannot download the SDK. Re-download from the updated Manager deployment and rebuild your app after SDK fixes.</p>
      </SnippetCard>

      <SnippetCard title="3 · Configure your app environment" code={guide.config} copy={copy}>
        <p className="text-xs text-zinc-500">Put this in the consuming app’s .env.local or deployment environment. Omit unused channels. The endpoint is Manager’s origin, not your app’s URL or /api/ingest/logs. Restart development after changes; rebuild/redeploy after changing public variables. Next.js needs literal NEXT_PUBLIC_ reads as shown below.</p>
      </SnippetCard>

      <SnippetCard title="4 · Server logs and request completion" code={guide.serverModule} copy={copy}>
        <p className="text-xs text-zinc-500">Next.js App Router, Node runtime. Reuse the cached logger and wrap every exported route method, including auth, webhooks, PDFs and early-return paths. Each request gets its own trace child. Keep shared root context unchanged. Missing optional Manager configuration leaves the app working.</p>
        <p className="text-xs text-zinc-500">Log caught exceptions with <code>{'log?.error("operation_failed", { error })'}</code> to preserve their stacks. Log methods enqueue and return void; awaiting log.error() does not flush. The after callback keeps delivery alive after the response. For plain Node jobs, use await log.flush() in finally before exit.</p>
        <p className="text-xs text-zinc-500">Examples use JavaScript. For TypeScript, use .ts, extensionless SDK imports, typed globals and handler parameters.</p>
      </SnippetCard>
      <SnippetCard title="Wrap a route" code={guide.route} copy={copy} />

      <SnippetCard title="5 · Browser logs and analytics" code={guide.provider} copy={copy}>
        <p className="text-xs text-zinc-500">Import ManagerProvider into your root layout and render &lt;ManagerProvider /&gt; once. The window cache avoids duplicate capture under Strict Mode and hot reload. For TypeScript, use .tsx, extensionless SDK imports and typed window globals.</p>
        <p className="text-xs text-zinc-500">Browser warnings/errors, uncaught errors, rejected promises and fetch outcomes use the public mck_ key. Analytics uses its own mak_ key and works without client logging. Same-origin wrapped fetch carries x-trace-id; the server helper adopts it for a combined journey. Allow Manager’s origin in script-src and connect-src when your app uses CSP.</p>
      </SnippetCard>

      <SnippetCard title="6 · Analytics for static sites" code={guide.analytics.hasKey ? guide.analytics.html : guide.analytics.html.replace('mak_••••••••', 'mak_REPLACE_ME')} copy={copy}>
        {!guide.analytics.hasKey ? <p className="text-xs text-zinc-500">Paste your existing analytics key above to fill this tag, or create an analytics key under API keys. Manager cannot retrieve a key’s original value.</p> : null}
        <p className="text-xs text-zinc-500">Paste before &lt;/body&gt; for a static site; the Next.js provider already installs this tracker. It tracks SPA pageviews, click targets, referrers and UTM params, and batches with sendBeacon. Custom events: <code>{CUSTOM_EVENT_SNIPPET}</code>. Visitor IDs are anonymous, cookie-free and rotate daily.</p>
      </SnippetCard>

      <SnippetCard title="7 · No SDK? Plain HTTP logs" code={guide.http} copy={copy}>
        <p className="text-xs text-zinc-500">Check accepted and rejected counts, not just HTTP 200. Omitting ts uses Manager’s current time. Manager derives source and project from the key: do not send either in entries. For analytics HTTP clients, use /api/ingest/events with a mak_ key and an events array.</p>
      </SnippetCard>

      <Card>
        <CardHeader><CardTitle>Verify the integration</CardTitle></CardHeader>
        <CardContent>
          <ol className="list-inside list-decimal space-y-2 text-xs text-zinc-600 dark:text-zinc-300">
            <li>Send a unique server info message and browser warning; confirm the intended project and source.</li>
            <li>Exercise a synthetic thrown server error, browser error and rejected promise; confirm full exception stacks.</li>
            <li>Fetch your test route from the same-origin browser; confirm server/client rows share a trace and the journey is chronological.</li>
            <li>Use fake password/token metadata to check redaction. Repeated errors should remain visible after another flush and separate traces stay separate.</li>
            <li>Configure only analytics and confirm a pageview plus a custom event. Wrong-kind, unknown and revoked keys should return 401.</li>
            <li>Unset optional Manager configuration and confirm the app still works. Remove diagnostic routes after checking.</li>
          </ol>
          <p className="mt-3 text-xs text-zinc-500">Missing browser logs: check public env reads, mck_ key, rebuild and CSP. Missing server logs: check the cached logger and request-completion callback. Missing analytics: check mak_, /t.js and ingest toggles. For 429, honor Retry-After and reduce volume. Flush attempts delivery; it does not acknowledge durable storage.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Contract your app must respect</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-300">
            {CONTRACT.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>What you get</CardTitle></CardHeader>
        <CardContent>
          <ul className="grid gap-1.5 text-xs text-zinc-600 md:grid-cols-2 dark:text-zinc-300">
            {FEATURES.map((feature) => <li key={feature}>{feature}</li>)}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
