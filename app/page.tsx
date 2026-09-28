import Link from "next/link";
import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPrincipalFromCookieStore } from "@/lib/auth";

export const metadata: Metadata = { title: "Manager" };

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    name: "Projects hub",
    body: "Every project with its status, links, tags, notes and GitHub stats in one registry.",
  },
  {
    name: "Encrypted secrets vault",
    body: "AES-256-GCM per project and environment, masked by default, 30-second reveal, audited.",
  },
  {
    name: "Centralized logging",
    body: "Drop-in isomorphic SDK, key-scoped ingest, trace correlation, error grouping, live tail.",
  },
  {
    name: "Analytics",
    body: "One script tag per site: pageviews, clicks, referrers, devices and countries.",
  },
];

export default async function Home() {
  const principal = await getPrincipalFromCookieStore().catch(() => null);
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-20">
      <div className="w-full max-w-2xl">
        <p className="font-mono text-sm uppercase tracking-widest text-zinc-500">
          Manager
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Personal Project Control Center
        </h1>
        <p className="mt-4 text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          One hub for every project: registry, centralized logs, an encrypted secrets vault,
          GitHub links, and analytics.
        </p>

        {principal === null ? (
          <div className="mt-6">
            <Link href="/login">
              <Button>
                <Lock size={14} />
                Sign in
              </Button>
            </Link>
            <p className="mt-2 text-xs text-zinc-500">
              Health check: <code>GET /api/ping</code> → <code>{'{"ok":true}'}</code>
            </p>
          </div>
        ) : (
          <div className="mt-6">
            <Link href="/dashboard">
              <Button>Open dashboard →</Button>
            </Link>
          </div>
        )}

        <ul className="mt-10 grid gap-3 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <li
              key={feature.name}
              className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <h2 className="text-sm font-semibold">{feature.name}</h2>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{feature.body}</p>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-sm text-zinc-500">
          Specification in <code>docs/plan.md</code> · architecture in{" "}
          <code>docs/architecture.md</code>
        </p>
      </div>
    </main>
  );
}
