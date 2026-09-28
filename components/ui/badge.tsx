import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "violet";

const tones: Record<Tone, string> = {
  neutral:
    "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  violet:
    "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export const STATUS_TONE: Record<string, Tone> = {
  idea: "violet",
  building: "amber",
  live: "green",
  paused: "blue",
  archived: "neutral",
};

export const LEVEL_TONE: Record<string, Tone> = {
  trace: "neutral",
  debug: "neutral",
  info: "blue",
  warn: "amber",
  error: "red",
  fatal: "red",
};
