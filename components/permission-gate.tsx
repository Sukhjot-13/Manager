"use client";

import type { ReactNode } from "react";
import {
  canClient,
  hasAll,
  hasAny,
  useCapabilities,
} from "@/components/capabilities";

type GateProps = {
  children: ReactNode;
  permission?: string;
  allOf?: string[];
  anyOf?: string[];
  fallback?: ReactNode;
  mode?: "hide" | "disable";
};

export function PermissionGate({
  children,
  permission,
  allOf,
  anyOf,
  fallback = null,
  mode = "hide",
}: GateProps) {
  const capabilities = useCapabilities();
  const checks: boolean[] = [];
  if (permission !== undefined) {
    checks.push(canClient(capabilities, permission));
  }
  if (allOf !== undefined) {
    checks.push(hasAll(capabilities, allOf));
  }
  if (anyOf !== undefined) {
    checks.push(hasAny(capabilities, anyOf));
  }
  const allowed = checks.length > 0 && checks.every(Boolean);
  if (allowed) {
    return <>{children}</>;
  }
  if (mode === "disable" && typeof children === "object" && children !== null) {
    return <fieldset disabled>{children}</fieldset>;
  }
  return <>{fallback}</>;
}
