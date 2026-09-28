"use client";

import { useEffect, useState } from "react";

type State = "checking" | "ok" | "down";

export function AppPing() {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch("/api/ping", { cache: "no-store" });
        const body = (await response.json()) as { ok?: boolean };
        if (!cancelled) {
          setState(response.ok && body.ok === true ? "ok" : "down");
        }
      } catch {
        if (!cancelled) {
          setState("down");
        }
      }
    };
    void check();
    const timer = setInterval(() => void check(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const label =
    state === "ok" ? "API healthy" : state === "down" ? "API unreachable" : "checking API…";

  return (
    <span
      className={
        state === "down"
          ? "inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400"
          : "inline-flex items-center gap-1.5 text-xs text-zinc-500"
      }
    >
      <span
        className={
          state === "ok"
            ? "h-2 w-2 rounded-full bg-emerald-500"
            : state === "down"
              ? "h-2 w-2 rounded-full bg-red-500"
              : "h-2 w-2 rounded-full bg-zinc-400"
        }
        aria-hidden
      />
      {label}
    </span>
  );
}
