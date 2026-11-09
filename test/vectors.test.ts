import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildVectors, EXAMPLE_PARAMS } from "../scripts/build-vectors.js";
import { runVerify, verifyChain } from "../src/index.js";
import type { SettlementRecord } from "../src/types.js";

const dir = new URL("../vectors/", import.meta.url);
const load = (file: string) => JSON.parse(readFileSync(new URL(file, dir), "utf8"));

/**
 * Independent re-implementation of SPEC sections 3 and 5: a template string instead of Array.join,
 * node:crypto instead of WebCrypto. Shares no code with src/.
 */
function independentHash(r: SettlementRecord, prev: string): string {
  const payload = `${prev}|${r.id}|${r.payer}|${r.provider}|${r.model}|${r.tokens.toString(10)}|${r.base.toString(10)}|${r.discount.toString(10)}|${r.fee.toString(10)}|${r.capacity_id}|${r.epoch.toString(10)}|${r.created_at.toString(10)}`;
  return createHash("sha256").update(Buffer.from(payload, "utf8")).digest("hex");
}

function independentVerify(genesis: string, records: SettlementRecord[]) {
  let prev = genesis;
  for (const r of records) {
    if (r.prev_hash !== prev || independentHash(r, prev) !== r.hash) return false;
    prev = r.hash;
  }
  return true;
}

describe("golden vectors", () => {
  it("are reproducible from scripts/build-vectors.ts", async () => {
    const built = await buildVectors();
    for (const [file, data] of Object.entries(built)) {
      expect(load(file), file).toEqual(JSON.parse(JSON.stringify(data)));
    }
  });

  it("payload strings and hashes match the independent implementation", () => {
    const { cases } = load("payload.json");
    const { records } = load("valid.json");
    expect(cases).toHaveLength(records.length);
    for (const [i, c] of cases.entries()) {
      const r = records[i] as SettlementRecord;
      expect(c.payload.split("|")).toHaveLength(12);
      expect(createHash("sha256").update(c.payload, "utf8").digest("hex")).toBe(c.hash);
      expect(independentHash(r, c.prev_hash)).toBe(c.hash);
    }
  });

  const chainFiles = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "payload.json" && f !== "live-seq1.json");

  for (const file of chainFiles) {
    it(`${file} matches its expected result`, async () => {
      const v = load(file);
      const r = await runVerify(v, file, { params: EXAMPLE_PARAMS });
      expect({ checked: r.checked, tip: r.tip, broken: r.broken }).toEqual({
        checked: v.expect.checked,
        tip: v.expect.tip,
        broken: v.expect.broken,
      });
      expect(r.errors.map((e) => ({ seq: e.seq, code: e.code }))).toEqual(v.expect.errors);
      expect(r.warnings.map((e) => ({ seq: e.seq, code: e.code }))).toEqual(v.expect.warnings);
      // The independent implementation must agree on whether the chain holds.
      expect(independentVerify(v.genesis, v.records)).toBe(v.expect.broken === null);
    });
  }

  it("the expected break kinds are covered", () => {
    expect(load("tampered-field.json").expect.broken).toEqual({ seq: 3, reason: "hash does not match its contents" });
    expect(load("dropped-record.json").expect.broken).toEqual({ seq: 4, reason: "does not point at the previous record" });
    expect(load("reordered.json").expect.broken).toEqual({ seq: 4, reason: "does not point at the previous record" });
    expect(load("wrong-genesis.json").expect.broken).toEqual({ seq: 1, reason: "does not point at the previous record" });
    expect(load("tampered-split.json").expect.broken).toBeNull();
    expect(load("tampered-split.json").expect.errors).toEqual([{ seq: 3, code: "I2" }]);
  });

  it("the first live record, hashed by the app, verifies", async () => {
    const v = load("live-seq1.json");
    expect(independentVerify(v.genesis, v.records)).toBe(true);
    const r = await verifyChain(v.genesis, v.records);
    expect(r).toEqual({ checked: 1, tip: v.records[0].hash, broken: null });
  });
});
