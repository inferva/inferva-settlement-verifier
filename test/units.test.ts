import { describe, expect, it } from "vitest";
import {
  checkRecord,
  checkRecordWithParams,
  DEFAULT_GENESIS,
  fetchChain,
  fetchParams,
  parseDump,
  settlementPayload,
  sha256Hex,
  verifyChain,
} from "../src/index.js";
import { main } from "../src/cli.js";
import { buildChain, EXAMPLE_PARAMS, LEGACY_PARAMS } from "../scripts/build-vectors.js";
import type { SettlementRecord } from "../src/types.js";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const codes = (r: SettlementRecord) => checkRecord(r).map((v) => v.code);
const pcodes = (r: SettlementRecord) => checkRecordWithParams(r, EXAMPLE_PARAMS).map((v) => v.code);
const lcodes = (r: SettlementRecord) => checkRecordWithParams(r, LEGACY_PARAMS).map((v) => v.code);

describe("payload and hash", () => {
  it("joins the twelve fields with | in SPEC order", () => {
    const p = settlementPayload(
      {
        id: "i",
        payer: "p",
        provider: "v",
        model: "m",
        tokens: 1,
        base: 2,
        discount: 3,
        fee: 4,
        capacity_id: "c",
        epoch: 5,
        created_at: 6,
      },
      "h",
    );
    expect(p).toBe("h|i|p|v|m|1|2|3|4|c|5|6");
  });

  it("sha256Hex matches the known digest of the empty string and of 'abc'", async () => {
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("verifyChain", () => {
  it("returns the genesis as tip for an empty chain", async () => {
    expect(await verifyChain(DEFAULT_GENESIS, [])).toEqual({ checked: 0, tip: DEFAULT_GENESIS, broken: null });
  });

  it("rejects a malformed genesis", async () => {
    await expect(verifyChain("xyz", [])).rejects.toThrow(/genesis/);
  });

  it("flags a record with a string amount as malformed", async () => {
    const { genesis, records } = await buildChain();
    (records[1] as unknown as Record<string, unknown>).base = "1";
    const r = await verifyChain(genesis, records);
    expect(r.checked).toBe(1);
    expect(r.broken).toEqual({ seq: 2, reason: "malformed record: base is not an integer" });
  });

  it("flags an edited seq even though seq is not hashed", async () => {
    const { genesis, records } = await buildChain();
    records[2]!.seq = 1;
    expect((await verifyChain(genesis, records)).broken).toEqual({ seq: 1, reason: "seq is not increasing" });
  });

  it("does not trust the stored hash: a rewritten hash breaks the next link", async () => {
    const { genesis, records } = await buildChain();
    records[1]!.hash = "f".repeat(64);
    expect((await verifyChain(genesis, records)).broken).toEqual({
      seq: 2,
      reason: "hash does not match its contents",
    });
  });
});

describe("invariants", () => {
  it("a generated chain passes every check under the parameters it was settled with", async () => {
    const { records } = await buildChain();
    for (const r of records) expect(codes(r)).toEqual([]);
    for (const r of records.slice(0, 5)) expect(lcodes(r)).toEqual([]);
    for (const r of records.slice(5)) {
      expect(pcodes(r)).toEqual([]);
      // Current records also fit the legacy discount and share rules (both allow 0); only the sponsor share differs.
      expect(lcodes(r)).toEqual(["P2"]);
    }
  });

  it("I1..I4 and B1..B3", async () => {
    const base = (await buildChain()).records[2]!;
    const m = (patch: Partial<SettlementRecord>) => ({ ...base, ...patch }) as SettlementRecord;
    expect(codes(m({ to_sponsor: -1, to_treasury: base.to_treasury + base.to_sponsor + 1 }))).toContain("I1");
    expect(codes(m({ fee: 1.5 }))).toContain("I1");
    expect(codes(m({ to_stakers: base.to_stakers + 1 }))).toEqual(["I2"]);
    expect(codes(m({ priority: 2 }))).toEqual(["I3"]);
    expect(codes(m({ prompt_tokens: 1, completion_tokens: 1 }))).toEqual(["I4"]);
    expect(codes(m({ prompt_tokens: null, completion_tokens: null }))).toEqual([]);
    expect(codes(m({ discount: Math.floor(base.base / 2) + 1 }))).toEqual(["B1"]);
    expect(codes(m({ base: 10, discount: 0, fee: 0, to_stakers: 0, to_sponsor: 0, to_treasury: 0 }))).toEqual(["B2"]);
    expect(codes(m({ base: 0, discount: 0, fee: 1, to_stakers: 0, to_sponsor: 0, to_treasury: 1 }))).toEqual([
      "B2",
      "B3",
    ]);
    expect(codes(m({ base: 3, discount: 0, fee: 2, to_stakers: 1, to_sponsor: 0, to_treasury: 1 }))).toEqual([]);
    expect(codes(m({ base: 3, discount: 0, fee: 3, to_stakers: 1, to_sponsor: 1, to_treasury: 1 }))).toEqual(["B3"]);
  });

  it("P1..P5 against the current parameters", async () => {
    const base = (await buildChain()).records[5]!;
    const m = (patch: Partial<SettlementRecord>) => ({ ...base, ...patch }) as SettlementRecord;
    expect(base.to_stakers).toBe(0);
    expect(base.to_treasury).toBe(base.fee - base.to_sponsor);
    expect(pcodes(m({ fee: base.fee + 1, to_treasury: base.to_treasury + 1 }))).toContain("P1");
    expect(pcodes(m({ to_sponsor: base.to_sponsor - 1, to_treasury: base.to_treasury + 1 }))).toEqual(["P2"]);
    expect(pcodes(m({ to_stakers: 1, to_treasury: base.to_treasury - 1 }))).toEqual(["P3"]);
    expect(pcodes(m({ discount: 1 }))).toEqual(["P4"]);
    expect(pcodes(m({ priority: 1 }))).toEqual(["P4"]);
    expect(pcodes(m({ epoch: base.epoch + 1 }))).toEqual(["P5"]);
  });

  it("P3 and P4 follow the legacy rules when legacy parameters are given", async () => {
    const records = (await buildChain()).records;
    const base = records[2]!;
    const m = (patch: Partial<SettlementRecord>) => ({ ...base, ...patch }) as SettlementRecord;
    expect(lcodes(m({ to_stakers: 0, to_treasury: base.to_treasury + base.to_stakers }))).toEqual([]);
    expect(lcodes(m({ to_stakers: base.to_stakers - 1, to_treasury: base.to_treasury + 1 }))).toEqual(["P3"]);
    expect(lcodes(m({ priority: 0 }))).toEqual(["P4"]);
    // Legacy records checked against the current parameters are reported, not rejected.
    expect(pcodes(base)).toEqual(["P2", "P3", "P4"]);
    expect(codes(base)).toEqual([]);
  });
});

type Page = { genesis: string; records: SettlementRecord[] };

function mockFetch(pages: (after: number, limit: number) => Page | number) {
  const calls: string[] = [];
  const f = async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    const res = pages(Number(u.searchParams.get("after")), Number(u.searchParams.get("limit")));
    if (typeof res === "number") return { ok: false, status: res, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => res };
  };
  return { f, calls };
}

describe("fetchChain", () => {
  it("pages with after=<last seq> until a short page", async () => {
    const chain = await buildChain();
    const { f, calls } = mockFetch((after, limit) => ({
      genesis: chain.genesis,
      records: chain.records.filter((r) => r.seq > after).slice(0, limit),
    }));
    const dump = await fetchChain("https://example.invalid/", { fetch: f, pageSize: 2 });
    expect(dump).toEqual(chain);
    expect(calls).toEqual([
      "https://example.invalid/api/chain?after=0&limit=2",
      "https://example.invalid/api/chain?after=2&limit=2",
      "https://example.invalid/api/chain?after=4&limit=2",
      "https://example.invalid/api/chain?after=6&limit=2",
    ]);
  });

  it("fails when the genesis changes between pages", async () => {
    const chain = await buildChain();
    const { f } = mockFetch((after) => ({
      genesis: after ? "ab".repeat(32) : chain.genesis,
      records: chain.records.filter((r) => r.seq > after).slice(0, 2),
    }));
    await expect(fetchChain("https://example.invalid", { fetch: f, pageSize: 2 })).rejects.toThrow(/genesis changed/);
  });

  it("fails when a page does not move past after", async () => {
    const chain = await buildChain();
    const { f } = mockFetch(() => ({ genesis: chain.genesis, records: chain.records.slice(0, 2) }));
    await expect(fetchChain("https://example.invalid", { fetch: f, pageSize: 2 })).rejects.toThrow(/returned seq 1/);
  });

  it("surfaces HTTP errors", async () => {
    const { f } = mockFetch(() => 503);
    await expect(fetchChain("https://example.invalid", { fetch: f })).rejects.toThrow(/HTTP 503/);
  });

  it("fetchParams picks the fee parameters", async () => {
    const f = async () => ({ ok: true, status: 200, json: async () => ({ params: { ...EXAMPLE_PARAMS, other: 1 } }) });
    expect(await fetchParams("https://example.invalid", { fetch: f })).toEqual(EXAMPLE_PARAMS);
  });

  it("fetchParams keeps the legacy parameters when the server still serves them", async () => {
    const { legacy, ...rest } = LEGACY_PARAMS;
    const f = async () => ({ ok: true, status: 200, json: async () => ({ params: { ...rest, ...legacy, other: 1 } }) });
    expect(await fetchParams("https://example.invalid", { fetch: f })).toEqual(LEGACY_PARAMS);
  });

  it("fetchParams fails when a required parameter is missing", async () => {
    const f = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ params: { fee_bps: 1000, epoch_seconds: 3600 } }),
    });
    await expect(fetchParams("https://example.invalid", { fetch: f })).rejects.toThrow(/sponsor_share_bps/);
  });
});

describe("dump and CLI", () => {
  it("parseDump rejects other shapes", () => {
    expect(() => parseDump("[]")).toThrow(/genesis/);
  });

  it("verifies a dump file and exits 0, or 1 when tampered", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inferva-verify-"));
    const chain = await buildChain();
    const good = join(dir, "good.json");
    writeFileSync(good, JSON.stringify(chain));
    const bad = join(dir, "bad.json");
    chain.records[0]!.model = "other";
    writeFileSync(bad, JSON.stringify(chain));
    const log = console.log;
    const lines: string[] = [];
    console.log = (s: string) => lines.push(s);
    try {
      expect(await main(["--file", good, "--json"])).toBe(0);
      expect(JSON.parse(lines[0]!).checked).toBe(7);
      expect(await main(["--file", bad])).toBe(1);
      expect(lines[1]).toMatch(/BROKEN at seq 1: hash does not match its contents/);
    } finally {
      console.log = log;
    }
    expect(JSON.parse(readFileSync(good, "utf8")).records).toHaveLength(7);
  });

  it("exits 2 on an unknown flag", async () => {
    const err = console.error;
    console.error = () => {};
    try {
      expect(await main(["--nope"])).toBe(2);
    } finally {
      console.error = err;
    }
  });
});
