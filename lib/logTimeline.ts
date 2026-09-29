import type { SerializedLog } from "@/lib/ingest";

/** Display a client/server journey in time order without changing paginated API rows. */
export function chronologicalLogs(rows: SerializedLog[]): SerializedLog[] {
  return [...rows].sort((left, right) => {
    const time = Date.parse(left.ts) - Date.parse(right.ts);
    return time || left.id.localeCompare(right.id);
  });
}
