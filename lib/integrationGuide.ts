import { getEmbedSnippet } from "@/lib/tracker";

// Browser-safe generated examples, following README's consuming-app setup.
export function integrationKey(value: string, kind: "server" | "client" | "analytics"): string {
  const prefix = { server: "mlk", client: "mck", analytics: "mak" }[kind];
  const key = value.trim();
  return new RegExp(`^${prefix}_[A-Za-z0-9_-]+$`).test(key) ? key : "";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildIntegrationGuide({
  origin, projectSlug, serverKey = "", clientKey = "", analyticsKey = "",
}: {
  origin: string;
  projectSlug: string;
  serverKey?: string;
  clientKey?: string;
  analyticsKey?: string;
}) {
  const endpoint = origin.replace(/\/+$/, "");
  const server = integrationKey(serverKey, "server");
  const client = integrationKey(clientKey, "client");
  const analytics = integrationKey(analyticsKey, "analytics");
  const downloadKey = server || client || "YOUR_LOG_KEY";
  const install = `mkdir -p src/lib/manager
# JavaScript apps (choose this):
curl -fsSL -H ${shellQuote(`x-manager-key: ${downloadKey}`)} \\
  ${shellQuote(`${endpoint}/api/sdk/logger?format=js`)} -o src/lib/manager/sdk.js
# TypeScript apps (choose this instead):
curl -fsSL -H ${shellQuote(`x-manager-key: ${downloadKey}`)} \\
  ${shellQuote(`${endpoint}/api/sdk/logger`)} -o src/lib/manager/sdk.ts`;

  const config = `# Server configuration — never expose this key in browser code
MANAGER_ENDPOINT=${JSON.stringify(endpoint)}
MANAGER_APP_ID=${JSON.stringify(projectSlug)}
MANAGER_LOG_KEY=${server || "mlk_REPLACE_ME"}

# Browser configuration — these two keys are intentionally public
NEXT_PUBLIC_MANAGER_ENDPOINT=${JSON.stringify(endpoint)}
NEXT_PUBLIC_MANAGER_APP_ID=${JSON.stringify(projectSlug)}
NEXT_PUBLIC_MANAGER_CLIENT_KEY=${client || "mck_REPLACE_ME"}
NEXT_PUBLIC_MANAGER_ANALYTICS_KEY=${analytics || "mak_REPLACE_ME"}`;

  const serverModule = `// src/lib/manager/server.js — import only from server code
import { after } from "next/server";
import { initLogger, traceIdFromHeaders } from "./sdk.js";

export function getManagerLogger() {
  const endpoint = process.env.MANAGER_ENDPOINT;
  const appId = process.env.MANAGER_APP_ID;
  const apiKey = process.env.MANAGER_LOG_KEY;
  if (!endpoint || !appId || !apiKey) return null;
  return (globalThis.__managerServerLogger ??= initLogger({
    endpoint, appId, apiKey,
    environment: process.env.NODE_ENV,
    captureConsole: null,
    captureGlobalErrors: false,
    captureProcessErrors: false,
    captureFetch: false,
    flushIntervalMs: 250,
    redactKeys: ["password", "token", "authorization"],
  }));
}

export function withManagerLogs(handler) {
  return async (request, context) => {
    const root = getManagerLogger();
    const traceId = traceIdFromHeaders(request.headers) || crypto.randomUUID();
    const requestLog = root?.withTrace(traceId);
    try {
      return await handler(request, context, requestLog);
    } catch (error) {
      requestLog?.error("Unhandled route error", { error });
      throw error;
    } finally {
      if (root) after(() => root.flush());
    }
  };
}`;

  const route = `// src/app/api/example/route.js
import { withManagerLogs } from "@/lib/manager/server";

export const GET = withManagerLogs(async (request, context, log) => {
  log?.info("example_requested", { route: "/api/example" });
  return Response.json({ ok: true });
});`;

  const provider = `// src/lib/manager/ManagerProvider.jsx — mount once in the root layout
"use client";

import { useEffect } from "react";
import { initLogger } from "./sdk.js";

const endpoint = process.env.NEXT_PUBLIC_MANAGER_ENDPOINT;
const appId = process.env.NEXT_PUBLIC_MANAGER_APP_ID;
const clientKey = process.env.NEXT_PUBLIC_MANAGER_CLIENT_KEY;
const analyticsKey = process.env.NEXT_PUBLIC_MANAGER_ANALYTICS_KEY;

export default function ManagerProvider() {
  useEffect(() => {
    if (endpoint && appId && clientKey && !window.__managerClientLogger) {
      window.__managerClientLogger = initLogger({
        endpoint, appId, apiKey: clientKey,
        captureConsole: ["warn", "error"],
        captureGlobalErrors: true,
        captureFetch: true,
        redactKeys: ["password", "token", "authorization"],
      });
    }
    // Analytics works independently of the client log key.
    if (endpoint && appId && analyticsKey && !document.getElementById("manager-tracker")) {
      const script = document.createElement("script");
      script.id = "manager-tracker";
      script.async = true;
      script.src = endpoint.replace(/\\/+$/, "") + "/t.js?v=1";
      script.dataset.app = appId;
      script.dataset.key = analyticsKey;
      document.head.appendChild(script);
    }
  }, []);
  return null;
}`;

  const http = `curl -i -X POST ${shellQuote(`${endpoint}/api/ingest/logs`)} \\
  -H 'content-type: application/json' \\
  -H ${shellQuote(`x-api-key: ${server || "YOUR_SERVER_LOG_KEY"}`)} \\
  -d '{"logs":[{"level":"info","message":"integration_probe"}]}'`;

  return {
    install, config, serverModule, route, provider, http,
    analytics: getEmbedSnippet({ origin: endpoint, slug: projectSlug, key: analytics }),
  };
}
