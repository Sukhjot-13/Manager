export const dynamic = "force-dynamic";

const PHASES = [
  { id: "P0", name: "Skeleton", state: "in progress" },
  { id: "P1", name: "Projects Hub", state: "planned" },
  { id: "P2", name: "Secrets Vault", state: "planned" },
  { id: "P3", name: "Logger", state: "planned" },
  { id: "P4", name: "Analytics", state: "planned" },
  { id: "P5", name: "Polish", state: "planned" },
] as const;

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="w-full max-w-2xl">
        <p className="font-mono text-sm uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Manager
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Personal Project Control Center
        </h1>
        <p className="mt-4 text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          One hub for every project: registry, centralized logs, an encrypted
          secrets vault, GitHub links, and analytics.
        </p>

        <h2 className="mt-10 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Build status
        </h2>
        <ul className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {PHASES.map((phase) => (
            <li
              key={phase.id}
              className="flex items-center justify-between px-4 py-3 text-sm"
            >
              <span className="text-zinc-900 dark:text-zinc-100">
                <span className="font-mono text-zinc-500 dark:text-zinc-400">
                  {phase.id}
                </span>{" "}
                {phase.name}
              </span>
              <span
                className={
                  phase.state === "in progress"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-zinc-500 dark:text-zinc-400"
                }
              >
                {phase.state}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">
          Health check: <code>GET /api/ping</code> →{" "}
          <code>{'{"ok":true}'}</code>
        </p>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Full specification in <code>docs/plan.md</code>.
        </p>
      </div>
    </main>
  );
}
