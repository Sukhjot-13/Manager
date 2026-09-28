import type { NextRequest } from "next/server";
import { authorize, errorResponse, notFound } from "@/lib/auth";
import { getProjectBySlug } from "@/lib/projects";
import {
  countLogs,
  decodeCursor,
  groupLogs,
  queryLogs,
  type LogQueryFilters,
} from "@/lib/ingest";
import { logQuerySchema } from "@/lib/validation";

type Context = { params: Promise<{ slug: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

function collectLevels(params: URLSearchParams): string[] {
  const values: string[] = [];
  for (const raw of params.getAll("levels")) {
    for (const part of raw.split(",")) {
      const trimmed = part.trim();
      if (trimmed !== "") {
        values.push(trimmed);
      }
    }
  }
  return values;
}

function parseFilters(request: NextRequest): {
  filters: LogQueryFilters;
  group: boolean;
  limit: number;
} {
  const params = request.nextUrl.searchParams;
  const levels = collectLevels(params);
  const fingerprint = params.get("fingerprint");
  const parsed = logQuerySchema.safeParse({
    levels: levels.length > 0 ? levels : undefined,
    source: params.get("source") ?? undefined,
    environment: params.get("environment") ?? undefined,
    release: params.get("release") ?? undefined,
    search: params.get("search") ?? undefined,
    sessionId: params.get("sessionId") ?? undefined,
    traceId: params.get("traceId") ?? undefined,
    since: params.get("since") ?? undefined,
    until: params.get("until") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
    limit: params.get("limit") ?? undefined,
    group: params.get("group") === "1" || params.get("group") === "true",
  });
  if (!parsed.success) {
    throw new FilterError(parsed.error.issues.length);
  }
  const data = parsed.data;
  if (data.cursor !== undefined && decodeCursor(data.cursor) === null) {
    throw new FilterError(1);
  }
  const filters: LogQueryFilters = {
    source: data.source,
    ...(data.levels === undefined ? {} : { levels: data.levels }),
    ...(data.environment === undefined ? {} : { environment: data.environment }),
    ...(data.release === undefined ? {} : { release: data.release }),
    ...(data.search === undefined ? {} : { search: data.search }),
    ...(data.sessionId === undefined ? {} : { sessionId: data.sessionId }),
    ...(data.traceId === undefined ? {} : { traceId: data.traceId }),
    ...(data.since === undefined ? {} : { since: data.since }),
    ...(data.until === undefined ? {} : { until: data.until }),

    ...(fingerprint === null || fingerprint === "" ? {} : { fingerprint }),
  };
  return { filters, group: data.group, limit: data.limit };
}
class FilterError extends Error {
  readonly issues: number;
  constructor(issues: number) {
    super("invalid filter");
    this.issues = issues;
  }
}

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    await authorize(request, "logs.view");
    const { slug } = await context.params;
    const project = await getProjectBySlug(slug);
    if (project === null) {
      throw notFound("project not found");
    }
    let selection: ReturnType<typeof parseFilters>;
    try {
      selection = parseFilters(request);
    } catch (error) {
      if (error instanceof FilterError) {
        return Response.json(
          { error: "invalid_request", issues: error.issues },
          { status: 400, headers: NO_STORE },
        );
      }
      throw error;
    }
    const projectId = String(project._id);
    const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
    if (selection.group) {
      const groups = await groupLogs(projectId, {
        ...selection.filters,
        limit: selection.limit,
      });
      return Response.json({ groups }, { headers: NO_STORE });
    }
    const [page, total] = await Promise.all([
      queryLogs(projectId, {
        ...selection.filters,
        limit: selection.limit,
        ...(cursor === null || cursor === undefined ? {} : { cursor }),
      }),
      countLogs(projectId, selection.filters),
    ]);
    return Response.json({ ...page, total }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
