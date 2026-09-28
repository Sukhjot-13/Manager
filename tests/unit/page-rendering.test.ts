import { describe, expect, it } from "vitest";
import * as home from "@/app/page";

describe("home route render mode", () => {
  it("renders per request so the CSP nonce can be injected", () => {
    expect(home.dynamic).toBe("force-dynamic");
  });
});
