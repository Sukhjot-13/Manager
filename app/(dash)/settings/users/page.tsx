import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePrincipalFromCookieStore } from "@/lib/auth";
import { can, isRootAdmin } from "@/lib/permissions";
import { listUsers } from "@/lib/users";
import { UsersPanel } from "@/components/settings/users-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users & roles" };

export default async function UsersPage() {
  const principal = await requirePrincipalFromCookieStore().catch(() => null);
  if (principal === null) {
    redirect("/login");
  }
  if (!can(principal, "users.manage")) {
    return (
      <p className="text-sm text-zinc-500">
        You do not have permission to manage users.
      </p>
    );
  }
  const users = await listUsers();
  return (
    <div>
      <Link
        href="/settings"
        className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        ← Settings
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold tracking-tight">Users &amp; roles</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Roles, per-user permission overrides and delegated permission managers.
      </p>
      <UsersPanel users={users} isRootAdmin={isRootAdmin(principal)} />
    </div>
  );
}
