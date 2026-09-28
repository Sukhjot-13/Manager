"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { isPermissionKey, type PermissionKey } from "@/lib/permissions";

export type Capabilities = PermissionKey[];

const CapabilityContext = createContext<Capabilities | null>(null);

export function CapabilityProvider({
  capabilities,
  children,
}: {
  capabilities: Capabilities;
  children: ReactNode;
}) {
  const value = useMemo(() => capabilities, [capabilities]);
  return (
    <CapabilityContext.Provider value={value}>
      {children}
    </CapabilityContext.Provider>
  );
}

export function useCapabilities(): Capabilities {
  return useContext(CapabilityContext) ?? [];
}

export function canClient(
  capabilities: Capabilities,
  permission: string,
): boolean {
  return isPermissionKey(permission) && capabilities.includes(permission);
}

export function hasAll(
  capabilities: Capabilities,
  permissions: string[],
): boolean {
  return permissions.every((permission) => canClient(capabilities, permission));
}

export function hasAny(
  capabilities: Capabilities,
  permissions: string[],
): boolean {
  return permissions.some((permission) => canClient(capabilities, permission));
}
