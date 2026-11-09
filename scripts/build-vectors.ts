// Builds the golden vectors in vectors/ from a small synthetic chain. The amounts follow the fee math in
// SPEC section 6 with one example parameter set; they are test data, not live figures.
import { DEFAULT_GENESIS, recordHash, settlementPayload } from "../src/payload.js";
import { runVerify } from "../src/run.js";
import type { ChainDump, FeeParams, SettlementRecord } from "../src/types.js";

export const EXAMPLE_PARAMS: FeeParams = {
  fee_bps: 1000,
  staker_share_bps: 5000,
  sponsor_share_bps: 4000,
  epoch_seconds: 3600,
  tier1_discount_bps: 500,
  tier2_discount_bps: 1000,
  tier3_discount_bps: 2000,
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
  stakersLive: boolean;
  createdAt: number;
};

const P = EXAMPLE_PARAMS;
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
    stakersLive: false,
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
    discountBps: P.tier1_discount_bps,
    priority: 0,
    stakersLive: true,
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
    discountBps: P.tier2_discount_bps,
    priority: 1,
    stakersLive: true,
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
    discountBps: P.tier3_discount_bps,
    priority: 1,
    stakersLive: true,
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
    stakersLive: true,
    createdAt: T0 + 7_300_000,
  },
];

/** quote() + the staker fallback from settlement, as written in SPEC section 6. */
function split(i: Input) {
  const base = Math.ceil((i.tokens * i.pricePer1k) / 1000);
  const discount = Math.floor((base * i.discountBps) / 10_000);
  const fee = Math.ceil((base * P.fee_bps) / 10_000);
  const stakers = Math.floor((fee * P.staker_share_bps) / 10_000);
  const sponsor = Math.floor((fee * P.sponsor_share_bps) / 10_000);
  const treasury = fee - stakers - sponsor;
  const toStakers = i.stakersLive ? stakers : 0;
  return {
    base,
    discount,
    fee,
    to_stakers: toStakers,
    to_sponsor: sponsor,
    to_treasury: treasury + (stakers - toStakers),
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
      epoch: Math.floor(i.createdAt / 1000 / P.epoch_seconds),
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

async function withExpect(name: string, description: string, dump: ChainDump) {
  const r = await runVerify(dump, name, { params: EXAMPLE_PARAMS });
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
      params: EXAMPLE_PARAMS,
      cases: valid.records.map((r) => ({
        seq: r.seq,
        prev_hash: r.prev_hash,
        payload: settlementPayload(r, r.prev_hash),
        hash: r.hash,
      })),
    },
    "valid.json": await withExpect("valid", "Five-record chain from the default genesis. Verifies end to end.", valid),
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
