"use client";

import type { ComponentProps } from "react";
import { createPortal } from "react-dom";
import Link, { useLinkStatus } from "next/link";
import { LoadingNotice } from "@/components/ui/loading-notice";

function NavigationPending() {
  const { pending } = useLinkStatus();
  return pending ? createPortal(<LoadingNotice popup />, document.body) : null;
}

export function NavigationLink({ children, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link {...props}>
      {children}
      <NavigationPending />
    </Link>
  );
}
