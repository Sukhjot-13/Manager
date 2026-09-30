import { describe, expect, it } from "vitest";
import { formatVaultTimestamp, importFailureMessages } from "@/lib/vaultFeedback";

describe("vault import feedback", () => {
  it("shows configuration guidance and every per-key failure instead of generic skipped counts", () => {
    expect(importFailureMessages({ error: "vault_not_configured", message: "Restore ENV_MASTER_KEY and redeploy." })).toEqual(["Restore ENV_MASTER_KEY and redeploy."]);
    expect(importFailureMessages({ imported: 0, skipped: 2, errors: ["A: index conflict", "B: index conflict"] })).toEqual(["A: index conflict", "B: index conflict"]);
    expect(importFailureMessages({ errors: [null, 123, "", "A: write failed"] })).toEqual(["A: write failed"]);
    expect(importFailureMessages(null)).toEqual(["Import failed. Please retry."]);
  });
});

describe("vault timestamp hydration", () => {
  it("renders identically under different server/browser timezone defaults", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const server = formatVaultTimestamp("2026-09-30T18:52:45.750Z", "America/Toronto");
      process.env.TZ = "Pacific/Honolulu";
      const client = formatVaultTimestamp("2026-09-30T18:52:45.750Z", "America/Toronto");
      expect(client).toBe(server);
      expect(server).toBe("2026-09-30 14:52:45");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it("uses stable midnight output, handles null/invalid dates and falls back from invalid timezone", () => {
    expect(formatVaultTimestamp("2026-09-30T00:00:00Z")).toBe("2026-09-30 00:00:00");
    expect(formatVaultTimestamp("2026-09-30T18:52:45Z", "not/a/timezone")).toBe("2026-09-30 18:52:45");
    expect(formatVaultTimestamp(null)).toBe("—");
    expect(formatVaultTimestamp("not-a-date")).toBe("—");
  });
});
