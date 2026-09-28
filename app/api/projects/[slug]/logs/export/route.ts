import type { NextRequest } from "next/server";
import { authorize, errorResponse, notFound } from "@/lib/auth";
import { getProjectBySlug } from "@/lib/projects";
import { MAX_EXPORT_ROWS, queryLogs, type LogQueryFilters, type SerializedLog } from "@/lib/ingest";
import { toCsv } from "@/lib/csv";

type Context = { params: Promise<{ slug: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

export const CSV_COLUMNS = [
  "ts",
  "receivedAt",
  "level",
  "source",
  "message",
  "count",
  "fingerprint",
  "environment",
  "release",
  "appVersion",
  "route",
  "url",
  "sessionId",
  "traceId",
  "requestId",
  "durationMs",
  "keyPrefix",
  "ip",
  "country",
  "hostname",
  "pid",
  "runtimeVersion",
  "rssMb",
  "uptimeSec",
  "browser",
  "os",
  "device",
  "viewport",
  "lang",
  "tz",
  "connection",
  "ua",
  "stack",
  "meta",
] as const;

function toRow(log: SerializedLog): Record<string, unknown> {
  return {
    ...log,
    id: undefined,
    meta: log.meta === null ? "" : JSON.stringify(log.meta),
  } as Record<string, unknown>;
}

function filtersFromParams(params: URLSearchParams): LogQueryFilters {
  const levels = params
    .getAll("levels")
    .flatMap((raw) => raw.split(","))
    .map((value) => value.trim())
    .filter((value) => value !== "");
  const since = params.get("since");
  const until = params.get("until");
  return {
    source: (params.get("source") ?? "all") as "client" | "server" | "all",
    ...(levels.length > 0 ? { levels: levels as LogQueryFilters["levels"] } : {}),
    ...(params.get("environment") ? { environment: params.get("environment") as string } : {}),
    ...(params.get("release") ? { release: params.get("release") as string } : {}),
    ...(params.get("search") ? { search: params.get("search") as string } : {}),
    ...(params.get("sessionId") ? { sessionId: params.get("sessionId") as string } : {}),
    ...(params.get("traceId") ? { traceId: params.get("traceId") as string } : {}),
    ...(since ? { since: new Date(since) } : {}),
    ...(until ? { until: new Date(until) } : {}),
  };
}

function invalidDate(filters: LogQueryFilters): boolean {
  return (
    (filters.since !== undefined && Number.isNaN(filters.since.getTime())) ||
    (filters.until !== undefined && Number.isNaN(filters.until.getTime()))
  );
}

async function respond(
  request: NextRequest,
  context: Context,
  params: URLSearchParams,
  format: string,
): Promise<Response> {
  await authorize(request, "logs.export");
  const { slug } = await context.params;
  const project = await getProjectBySlug(slug);
  if (project === null) {
    throw notFound("project not found");
  }
  const filters = filtersFromParams(params);
  if (invalidDate(filters)) {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: NO_STORE },
    );
  }
  const page = await queryLogs(String(project._id), {
    ...filters,
    limit: MAX_EXPORT_ROWS,
    maxLimit: MAX_EXPORT_ROWS,
  });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, "-");
  const filename = `${project.slug}-logs-${stamp}.${format === "json" ? "json" : "csv"}`;
  const body =
    format === "json"
      ? JSON.stringify({ project: project.slug, exportedAt: new Date().toISOString(), logs: page.logs }, null, 2)
      : toCsv(CSV_COLUMNS, page.logs.map((log) => toRow(log)));
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type":
        format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      Expires: "0",
      "X-Row-Count": String(page.logs.length),
      "X-Row-Cap": String(MAX_EXPORT_ROWS),
    },
  });
}

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    const format = request.nextUrl.searchParams.get("format") === "json" ? "json" : "csv";
    return await respond(request, context, request.nextUrl.searchParams, format);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    let params = new URLSearchParams(request.nextUrl.searchParams);
    let format = params.get("format") === "json" ? "json" : "csv";
    const bodyText = await request.text();
    if (bodyText.trim() !== "") {
      let body: unknown;
      try {
        body = JSON.parse(bodyText);
      } catch {
        return Response.json(
          { error: "invalid_request" },
          { status: 400, headers: NO_STORE },
        );
      }
      if (typeof body !== "object" || body === null) {
        return Response.json(
          { error: "invalid_request" },
          { status: 400, headers: NO_STORE },
        );
      }
      const record = body as Record<string, unknown>;
      if (typeof record.format === "string") {
        format = record.format === "json" ? "json" : "csv";
      }
      params = new URLSearchParams();
      const set = (key: string, value: unknown): void => {
        if (value === undefined || value === null) {
          return;
        }
        if (Array.isArray(value)) {
          for (const entry of value) {
            params.append(key, String(entry));
          }
          return;
        }
        if (typeof value === "object") {
          return;
        }
        params.set(key, String(value));
      };
      set("source", record.source);
      set("levels", record.levels);
      set("environment", record.environment);
      set("release", record.release);
      set("search", record.search);
      set("sessionId", record.sessionId);
      set("traceId", record.traceId);
      set("since", record.since);
      set("until", record.until);
    }
    return await respond(request, context, params, format);
  } catch (error) {
    return errorResponse(error);
  }
}
