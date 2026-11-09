import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, fetchChain, runVerify } from "../src/index.js";

// Read-only check of the live log. Opt in with INFERVA_LIVE=1 (optionally INFERVA_BASE_URL).
describe.skipIf(!process.env.INFERVA_LIVE)("live settlement log", () => {
  it("verifies end to end", async () => {
    const baseUrl = process.env.INFERVA_BASE_URL ?? DEFAULT_BASE_URL;
    const dump = await fetchChain(baseUrl);
    const report = await runVerify(dump, baseUrl);
    expect(report.broken).toBeNull();
    expect(report.errors).toEqual([]);
    expect(report.checked).toBe(dump.records.length);
  }, 120_000);
});
