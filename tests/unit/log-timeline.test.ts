import { describe, expect, it } from "vitest";
import { chronologicalLogs } from "@/lib/logTimeline";
import type { SerializedLog } from "@/lib/ingest";

describe("combined log timeline", () => {
  it("orders mixed client/server events chronologically with deterministic timestamp ties", () => {
    const rows = [
      { id: "c", ts: "2026-09-29T20:00:02.000Z", source: "client" },
      { id: "b", ts: "2026-09-29T20:00:01.000Z", source: "server" },
      { id: "a", ts: "2026-09-29T20:00:01.000Z", source: "client" },
    ] as SerializedLog[];
    const timeline = chronologicalLogs(rows);
    expect(timeline.map(row => row.id)).toEqual(["a", "b", "c"]);
    expect(timeline.slice(1).map((row, index) => Date.parse(row.ts) - Date.parse(timeline[index].ts))).toEqual([0, 1000]);
    expect(rows.map(row => row.id)).toEqual(["c", "b", "a"]);
  });
  it("accepts empty and single-entry journeys", () => {
    expect(chronologicalLogs([])).toEqual([]);
    const rows = [{ id: "a", ts: "2026-09-29T20:00:01.000Z" }] as SerializedLog[];
    expect(chronologicalLogs(rows)).toEqual(rows);
  });
});
