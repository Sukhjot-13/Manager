import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export function LoadingNotice({
  message = "Loading page…",
  popup = false,
}: {
  message?: string;
  popup?: boolean;
}) {
  return (
    <span
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "flex items-center justify-center gap-2 text-sm text-zinc-600 dark:text-zinc-300",
        popup
          ? "pointer-events-none fixed bottom-4 right-4 z-40 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          : "min-h-32 rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900",
      )}
    >
      <Loader2 size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
      {message}
    </span>
  );
}
