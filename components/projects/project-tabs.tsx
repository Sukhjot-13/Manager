"use client";

import { NavigationLink as Link } from "@/components/ui/navigation-link";
import { usePathname } from "next/navigation";
import { can, type Principal } from "@/lib/permissions";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "", label: "Overview", permission: "projects.view" },
  { href: "/logs", label: "Logs", permission: "logs.view" },
  { href: "/analytics", label: "Analytics", permission: "analytics.view" },
  { href: "/env", label: "Env vault", permission: "secrets.view" },
  { href: "/keys", label: "API keys", permission: "keys.view" },
  { href: "/integrate", label: "Integrate", permission: "keys.view" },
] as const;

export function ProjectTabs({
  slug,
  principal,
}: {
  slug: string;
  principal: Principal;
}) {
  const pathname = usePathname();
  const base = `/projects/${slug}`;
  return (
    <nav className="mt-4 flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
      {TABS.map((tab) => {
        if (!can(principal, tab.permission)) {
          return null;
        }
        const href = `${base}${tab.href}`;
        const active =
          tab.href === ""
            ? pathname === base
            : pathname.startsWith(href);
        return (
          <Link
            key={tab.href}
            href={href}
            className={cn(
              "-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
