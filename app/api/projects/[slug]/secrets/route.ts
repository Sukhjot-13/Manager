import type { NextRequest } from "next/server";
import { z } from "zod";
import { authorize, errorResponse, notFound } from "@/lib/auth";
import { getProjectBySlug } from "@/lib/projects";
import { ENVIRONMENTS, type Environment } from "@/lib/db/secrets";
import {
  importEnvFile,
  listSecrets,
  logSecretAction,
  upsertSecret,
} from "@/lib/secrets";
import { clientIp } from "@/lib/visitor";
import { MAX_IMPORT_BYTES } from "@/lib/envImport";

type Context = { params: Promise<{ slug: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

const secretUpsertInputSchema = z.object({
  environment: z.enum(ENVIRONMENTS),
  key: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "key must be a valid env var name"),
  value: z.string().min(1).max(20_000),
  note: z.string().max(200).default(""),
});

const secretImportInputSchema = z.object({
  environment: z.enum(ENVIRONMENTS),
  content: z.string().min(1).max(MAX_IMPORT_BYTES).refine(
    (content) => new TextEncoder().encode(content).byteLength <= MAX_IMPORT_BYTES,
    "import payload too large",
  ),
});

function invalidRequest(issues?: number): Response {
  return Response.json(
    issues === undefined
      ? { error: "invalid_request" }
      : { error: "invalid_request", issues },
    { status: 400, headers: NO_STORE },
  );
}

function isEnvironment(value: string): value is Environment {
  return (ENVIRONMENTS as readonly string[]).includes(value);
}

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    await authorize(request, "secrets.view");
    const { slug } = await context.params;
    const project = await getProjectBySlug(slug);
    if (project === null) {
      throw notFound("project not found");
    }
    const requested = request.nextUrl.searchParams.get("environment");
    if (requested !== null && requested !== "" && !isEnvironment(requested)) {
      return invalidRequest();
    }
    const secrets = await listSecrets(
      String(project._id),
      requested === null || requested === "" ? undefined : requested,
    );
    return Response.json({ secrets }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    const principal = await authorize(request, "secrets.edit");
    const { slug } = await context.params;
    const project = await getProjectBySlug(slug);
    if (project === null) {
      throw notFound("project not found");
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return invalidRequest();
    }
    const record =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};
    const projectId = String(project._id);
    const ip = clientIp(request.headers);

    if (record.mode === "import") {
      const parsed = secretImportInputSchema.safeParse(record);
      if (!parsed.success) {
        return invalidRequest(parsed.error.issues.length);
      }
      const result = await importEnvFile(
        projectId,
        parsed.data.environment,
        parsed.data.content,
      );
      await logSecretAction({
        projectId,
        environment: parsed.data.environment,
        action: "import",
        actor: principal.email,
        ip,
      });
      return Response.json(result, { headers: NO_STORE });
    }

    const parsed = secretUpsertInputSchema.safeParse(record);
    if (!parsed.success) {
      return invalidRequest(parsed.error.issues.length);
    }
    const secret = await upsertSecret(projectId, parsed.data);
    await logSecretAction({
      secretId: secret.id,
      projectId,
      environment: secret.environment,
      keyName: secret.key,
      action: "update",
      actor: principal.email,
      ip,
    });
    return Response.json({ secret }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
