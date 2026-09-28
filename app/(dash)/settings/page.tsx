import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePrincipalFromCookieStore } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { listAuditEvents } from "@/lib/users";
import { appTimezone } from "@/lib/env";
import { SettingsPanel } from "@/components/settings/settings-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const principal = await requirePrincipalFromCookieStore().catch(() => null);
  if (principal === null) {
    redirect("/login");
  }
  if (!can(principal, "settings.manage")) {
    return (
      <p className="text-sm text-zinc-500">You do not have permission to view settings.</p>
    );
  }
  const settings = await getSettings();
  const audit = (await listAuditEvents(50)).map((event) => ({
    action: event.action,
    actor: event.actor,
    ts: event.ts,
  }));
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-zinc-500">
            Ingest kill switches, vault key rotation and the security audit trail.
          </p>
        </div>
        {can(principal, "users.manage") ? (
          <Link href="/settings/users" className="text-sm text-zinc-500 hover:underline">
            Users &amp; roles →
          </Link>
        ) : null}
      </div>
      <SettingsPanel settings={settings} audit={audit} timezone={appTimezone()} />
    </div>
  );
}
