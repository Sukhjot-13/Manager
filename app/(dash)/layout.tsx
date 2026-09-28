import { redirect } from "next/navigation";
import { Nav } from "@/components/nav";
import { CapabilityProvider } from "@/components/capabilities";
import { ToastProvider } from "@/components/ui/toast";
import { capabilitiesFor, requirePrincipalFromCookieStore } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const principal = await requirePrincipalFromCookieStore().catch(() => null);
  if (principal === null) {
    redirect("/login");
  }
  return (
    <CapabilityProvider capabilities={capabilitiesFor(principal)}>
      <ToastProvider>
        <div className="flex min-h-screen">
          <aside className="hidden w-56 shrink-0 border-r border-zinc-200 p-4 md:block dark:border-zinc-800">
            <p className="mb-6 px-3 font-mono text-xs uppercase tracking-widest text-zinc-500">
              Manager
            </p>
            <Nav />
            <p className="mt-6 px-3 text-xs text-zinc-500">
              {principal.email}
              <span className="mt-0.5 block text-zinc-400">{principal.role}</span>
            </p>
          </aside>
          <div className="min-w-0 flex-1 px-4 py-6 md:px-8">
            <div className="mb-4 md:hidden">
              <Nav />
            </div>
            <main>{children}</main>
          </div>
        </div>
      </ToastProvider>
    </CapabilityProvider>
  );
}
