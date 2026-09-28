import { Suspense } from "react";
import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";
import { LoginForm } from "./login-form";
import { checkReadiness, setupHint } from "@/lib/readiness";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const readiness = await checkReadiness();
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">
          Manager
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 mb-6 text-sm text-zinc-600 dark:text-zinc-400">
          Personal project control center.
        </p>
        {readiness.setup === "ready" &&
        (readiness.database.kind === "local" || readiness.database.kind === "memory_server") ? (
          <p className="mb-4 rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
            Running on a <strong>local database</strong> ({readiness.database.host}). Data lives
            in <code>.data/mongo</code> on this machine and is not shared with any deployment.
            Create a MongoDB Atlas cluster before testing in production.
          </p>
        ) : null}
        {readiness.setup === "ready" ? (
          <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
            <LoginForm />
          </Suspense>
        ) : (
          <div
            role="alert"
            className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            <p className="flex items-center gap-2 font-medium">
              <TriangleAlert size={15} />
              Setup required
            </p>
            <p className="mt-2 leading-5">{setupHint(readiness)}</p>
            {readiness.env.missing.length > 0 ? (
              <ul className="mt-2 list-inside list-disc font-mono text-xs">
                {readiness.env.missing.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 text-xs opacity-80">
              See <code>README.md</code> § Setup. No credentials are sent anywhere until this
              is fixed.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
