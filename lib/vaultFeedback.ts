export function importFailureMessages(payload: unknown, fallback = "Import failed. Please retry."): string[] {
  if (payload === null || typeof payload !== "object") return [fallback];
  const record = payload as { message?: unknown; errors?: unknown };
  const errors = Array.isArray(record.errors)
    ? record.errors.filter((error): error is string => typeof error === "string" && error.length > 0) : [];
  if (errors.length) return errors;
  return typeof record.message === "string" && record.message ? [record.message] : [fallback];
}

export function formatVaultTimestamp(value: string | null, timeZone = "UTC"): string {
  if (value === null) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  let formatter: Intl.DateTimeFormat;
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  };
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { ...options, timeZone });
  } catch {
    formatter = new Intl.DateTimeFormat("en-CA", { ...options, timeZone: "UTC" });
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
