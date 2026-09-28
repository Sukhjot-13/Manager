"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  FolderGit2,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/permission-gate";
import { cn } from "@/lib/cn";

const items = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
  { href: "/projects", label: "Projects", icon: FolderGit2, permission: "projects.view" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, permission: "analytics.view" },
  { href: "/settings/keys", label: "API Keys", icon: KeyRound, permission: "keys.view" },
  { href: "/settings", label: "Settings", icon: Settings, permission: "settings.manage" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => (
        <PermissionGate
          key={item.href}
          permission={item.permission}
          fallback={
            <PermissionGate
              permission="permissions.manage"
              fallback={
                item.href === "/settings" ? (
                  <NavLink
                    href={item.href}
                    active={pathname.startsWith(item.href)}
                    icon={<ShieldCheck size={15} />}
                    label={item.label}
                  />
                ) : null
              }
            >
              <NavLink
                href={item.href}
                active={pathname.startsWith(item.href)}
                icon={<item.icon size={15} />}
                label={item.label}
              />
            </PermissionGate>
          }
        >
          <NavLink
            href={item.href}
            active={pathname.startsWith(item.href)}
            icon={<item.icon size={15} />}
            label={item.label}
          />
        </PermissionGate>
      ))}
      <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <Button variant="ghost" size="sm" onClick={logout} className="w-full justify-start">
          <LogOut size={15} />
          Sign out
        </Button>
      </div>
    </nav>
  );
}

function NavLink({
  href,
  active,
  icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
      )}
    >
      {icon}
      {label}
    </Link>
  );
}

export function TopBar({ title }: { title: string }) {
  return (
    <div className="mb-6 flex items-center gap-2 text-sm text-zinc-500">
      <Activity size={14} />
      <span>{title}</span>
    </div>
  );
}
