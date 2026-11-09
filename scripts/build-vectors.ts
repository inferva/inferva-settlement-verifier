// Builds the golden vectors in vectors/ from a small synthetic chain. Records 1 to 5 follow the legacy fee math in
// SPEC section 6.4 and records 6 and 7 the current fee math in section 6, each with an example parameter set; they
// are test data, not live figures.
import { DEFAULT_GENESIS, recordHash, settlementPayload } from "../src/payload.js";
import { runVerify } from "../src/run.js";
import type { ChainDump, FeeParams, SettlementRecord } from "../src/types.js";

/** Example parameters for current records: the sponsor share of the fee, the treasury takes the rest. */
export const EXAMPLE_PARAMS: FeeParams = {
  fee_bps: 1000,
  sponsor_share_bps: 8000,
  epoch_seconds: 3600,
};

/** Example parameters for records settled under the legacy fee schedule (SPEC section 6.4). */
export const LEGACY_PARAMS: FeeParams = {
  fee_bps: 1000,
  sponsor_share_bps: 4000,
  epoch_seconds: 3600,
  legacy: {
    staker_share_bps: 5000,
    tier1_discount_bps: 500,
    tier2_discount_bps: 1000,
    tier3_discount_bps: 2000,
  },
};

type Input = {
  payer: string;
  provider: string;
  model: string;
  prompt: number | null;
  completion: number | null;
  tokens: number;
  pricePer1k: number;
  discountBps: number;
  priority: 0 | 1;
  /** Legacy records only: whether the legacy fee share was paid out (else it went to the treasury). */
  legacyShareLive: boolean;
  /** Settled under the legacy fee schedule (records 1 to 5) or the current one. */
  legacy: boolean;
  createdAt: number;
};

const L = LEGACY_PARAMS.legacy!;
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const T0 = 1_790_000_000_000;

const inputs: Input[] = [
  {
    payer: A,
    provider: "prv_alpha",
    model: "model-a",
    prompt: null,
    completion: null,
    tokens: 192,
    pricePer1k: 1800,
    discountBps: 0,
    priority: 0,
    legacyShareLive: false,
    legacy: true,
    createdAt: T0,
  },
  {
    payer: A,
    provider: "prv_alpha",
    model: "model-a",
    prompt: 820,
    completion: 410,
    tokens: 1230,
    pricePer1k: 1800,
    discountBps: L.tier1_discount_bps,
    priority: 0,
    legacyShareLive: true,
    legacy: true,
    createdAt: T0 + 61_000,
  },
  {
    payer: B,
    provider: "prv_beta",
    model: "model-b",
    prompt: 2048,
    completion: 1024,
    tokens: 3072,
    pricePer1k: 950,
    discountBps: L.tier2_discount_bps,
    priority: 1,
    legacyShareLive: true,
    legacy: true,
    createdAt: T0 + 3_599_999,
  },
  {
    payer: B,
    provider: "prv_beta",
    model: "model-b",
    prompt: 15,
    completion: 0,
    tokens: 15,
    pricePer1k: 950,
    discountBps: L.tier3_discount_bps,
    priority: 1,
    legacyShareLive: true,
    legacy: true,
    createdAt: T0 + 3_600_500,
  },
  {
    payer: A,
    provider: "prv_gamma",
    model: "model-c",
    prompt: 4000,
    completion: 6000,
    tokens: 10_000,
    pricePer1k: 3333,
    discountBps: 0,
    priority: 0,
    legacyShareLive: true,
    legacy: true,
    createdAt: T0 + 7_300_000,
  },
  {
    payer: B,
    provider: "prv_alpha",
    model: "model-a",
    prompt: 700,
    completion: 300,
    tokens: 1000,
    pricePer1k: 1800,
    discountBps: 0,
    priority: 0,
    legacyShareLive: false,
    legacy: false,
    createdAt: T0 + 10_800_000,
  },
  {
    payer: A,
    provider: "prv_gamma",
    model: "model-c",
    prompt: 1234,
    completion: 567,
    tokens: 1801,
    pricePer1k: 3333,
    discountBps: 0,
    priority: 0,
    legacyShareLive: false,
    legacy: false,
    createdAt: T0 + 10_860_250,
  },
];

/** The fee math from SPEC section 6 (current records) or section 6.4 (legacy records). */
function split(i: Input) {
  const P = i.legacy ? LEGACY_PARAMS : EXAMPLE_PARAMS;
  const base = Math.ceil((i.tokens * i.pricePer1k) / 1000);
  const discount = i.legacy ? Math.floor((base * i.discountBps) / 10_000) : 0;
  const fee = Math.ceil((base * P.fee_bps) / 10_000);
  const sponsor = Math.floor((fee * P.sponsor_share_bps) / 10_000);
  if (!i.legacy) return { base, discount, fee, to_stakers: 0, to_sponsor: sponsor, to_treasury: fee - sponsor };
  const share = Math.floor((fee * L.staker_share_bps) / 10_000);
  const paid = i.legacyShareLive ? share : 0;
  return {
    base,
    discount,
    fee,
    to_stakers: paid,
    to_sponsor: sponsor,
    to_treasury: fee - share - sponsor + (share - paid),
  };
}

export async function buildChain(genesis = DEFAULT_GENESIS): Promise<ChainDump> {
  const records: SettlementRecord[] = [];
  let prev = genesis;
  for (const [n, i] of inputs.entries()) {
    const seq = n + 1;
    const fields = {
      id: `req_${String(seq).padStart(20, "0")}`,
      payer: i.payer,
      provider: i.provider,
      model: i.model,
      tokens: i.tokens,
      ...split(i),
      capacity_id: `cap_${String(seq % 2).padStart(12, "0")}`,
      epoch: Math.floor(i.createdAt / 1000 / EXAMPLE_PARAMS.epoch_seconds),
      created_at: i.createdAt,
    };
    const hash = await recordHash(fields, prev);
    records.push({
      seq,
      key_id: `key_${String(seq).padStart(12, "0")}`,
      ...fields,
      priority: i.priority,
      prev_hash: prev,
      hash,
      prompt_tokens: i.prompt,
      completion_tokens: i.completion,
    });
    prev = hash;
  }
  return { genesis, records };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Expected results cover the chain and the parameter-free invariants (SPEC sections 5, 6.1 and 6.2). */
async function withExpect(name: string, description: string, dump: ChainDump) {
  const r = await runVerify(dump, name);
  return {
    name,
    description,
    genesis: dump.genesis,
    records: dump.records,
    expect: {
      checked: r.checked,
      tip: r.tip,
      broken: r.broken,
      errors: r.errors.map((v) => ({ seq: v.seq, code: v.code })),
      warnings: r.warnings.map((v) => ({ seq: v.seq, code: v.code })),
    },
  };
}

export async function buildVectors() {
  const valid = await buildChain();

  const tampered = clone(valid);
  tampered.records[2]!.base += 1;

  const split = clone(valid);
  split.records[2]!.to_treasury += 1;

  const dropped = clone(valid);
  dropped.records.splice(2, 1);

  const reordered = clone(valid);
  [reordered.records[2], reordered.records[3]] = [reordered.records[3]!, reordered.records[2]!];

  const custom = await buildChain("ab".repeat(32));
  const wrongGenesis = { genesis: DEFAULT_GENESIS, records: clone(custom.records) };

  return {
    "payload.json": {
      description: "Canonical payload string and SHA-256 hex for every record of valid.json (SPEC sections 3 and 5).",
      params: { "1-5": LEGACY_PARAMS, "6-7": EXAMPLE_PARAMS },
      cases: valid.records.map((r) => ({
        seq: r.seq,
        prev_hash: r.prev_hash,
        payload: settlementPayload(r, r.prev_hash),
        hash: r.hash,
      })),
    },
    "valid.json": await withExpect(
      "valid",
      "Seven-record chain from the default genesis: five legacy records, then two current ones. Verifies end to end.",
      valid,
    ),
    "custom-genesis.json": await withExpect(
      "custom-genesis",
      "Same inputs chained from a non-zero genesis. Verifies; every hash differs from valid.json.",
      custom,
    ),
    "wrong-genesis.json": await withExpect(
      "wrong-genesis",
      "Records from custom-genesis.json checked against the default genesis. Breaks at the first record.",
      wrongGenesis,
    ),
    "tampered-field.json": await withExpect(
      "tampered-field",
      "valid.json with base of seq 3 raised by 1 after the fact. Breaks at seq 3 (hash).",
      tampered,
    ),
    "tampered-split.json": await withExpect(
      "tampered-split",
      "valid.json with to_treasury of seq 3 raised by 1. The split is not hashed, so the chain verifies but invariant I2 fails.",
      split,
    ),
    "dropped-record.json": await withExpect(
      "dropped-record",
      "valid.json with seq 3 removed. Breaks at seq 4 (link).",
      dropped,
    ),
    "reordered.json": await withExpect(
      "reordered",
      "valid.json with seq 3 and seq 4 swapped. Breaks at seq 4 (link).",
      reordered,
    ),
  };
}
