import type { FeeParams, SettlementRecord, Violation } from "./types.js";

const BPS = 10_000;
const AMOUNTS = ["tokens", "base", "discount", "fee", "to_stakers", "to_sponsor", "to_treasury"] as const;

const isInt = (v: unknown): v is number => Number.isSafeInteger(v);

/**
 * Checks every record must pass whatever the protocol parameters were (SPEC section 6.1, "error"),
 * plus checks that follow from the v1 governance bounds (SPEC section 6.2, "warning").
 * The split fields (`to_*`), `priority` and the token breakdown are not part of the hash,
 * so these checks are consistency checks, not tamper evidence.
 */
export function checkRecord(r: SettlementRecord): Violation[] {
  const out: Violation[] = [];
  const err = (code: string, message: string) => out.push({ seq: r.seq, code, severity: "error", message });
  const warn = (code: string, message: string) => out.push({ seq: r.seq, code, severity: "warning", message });

  let amountsOk = true;
  for (const k of AMOUNTS) {
    const v = r[k];
    if (!isInt(v) || v < 0) {
      err("I1", `${k} must be a non-negative integer, got ${String(v)}`);
      amountsOk = false;
    }
  }
  for (const k of ["epoch", "created_at"] as const) {
    if (!isInt(r[k]) || r[k] < 0) err("I1", `${k} must be a non-negative integer, got ${String(r[k])}`);
  }
  // to_stakers is a legacy column (0 on current records); it stays in the sum so older records still balance.
  if (amountsOk && r.to_stakers + r.to_sponsor + r.to_treasury !== r.fee) {
    err("I2", `to_stakers + to_sponsor + to_treasury = ${r.to_stakers + r.to_sponsor + r.to_treasury}, fee = ${r.fee}`);
  }
  if (r.priority !== 0 && r.priority !== 1) err("I3", `priority must be 0 or 1, got ${String(r.priority)}`);
  const pt = r.prompt_tokens;
  const ct = r.completion_tokens;
  if (pt != null && ct != null && pt + ct !== r.tokens) {
    err("I4", `prompt_tokens + completion_tokens = ${pt + ct}, tokens = ${r.tokens}`);
  }

  if (amountsOk) {
    if (2 * r.discount > r.base) warn("B1", `discount ${r.discount} is more than half of base ${r.base}`);
    if (r.base > 0 && r.fee < 1) warn("B2", `fee is 0 on a non-zero base ${r.base}`);
    if (r.base === 0 && r.fee !== 0) warn("B2", `fee ${r.fee} on a zero base`);
    if (2 * r.fee > r.base + 1) warn("B3", `fee ${r.fee} is above ceil(base / 2) for base ${r.base}`);
  }
  return out;
}

const ceilDiv = (a: number, b: number) => Math.ceil(a / b);
const floorDiv = (a: number, b: number) => Math.floor(a / b);

/**
 * Exact fee math for one parameter set (SPEC section 6.3). Parameters are governable and are not
 * recorded per record, so a mismatch only means "not settled under these parameters".
 * Reported as warnings. With `p.legacy`, P3 and P4 follow the retired fee schedule (SPEC section 6.4).
 */
export function checkRecordWithParams(r: SettlementRecord, p: FeeParams): Violation[] {
  const out: Violation[] = [];
  const warn = (code: string, message: string) => out.push({ seq: r.seq, code, severity: "warning", message });
  if (![r.base, r.discount, r.fee, r.to_stakers, r.to_sponsor, r.to_treasury].every(isInt)) return out;

  const fee = ceilDiv(r.base * p.fee_bps, BPS);
  if (r.fee !== fee) warn("P1", `fee ${r.fee}, expected ceil(base * fee_bps / 10000) = ${fee}`);
  const sponsor = floorDiv(r.fee * p.sponsor_share_bps, BPS);
  if (r.to_sponsor !== sponsor) warn("P2", `to_sponsor ${r.to_sponsor}, expected ${sponsor}`);

  const legacy = p.legacy;
  if (legacy) {
    const share = floorDiv(r.fee * legacy.staker_share_bps, BPS);
    if (r.to_stakers !== share && r.to_stakers !== 0)
      warn("P3", `to_stakers ${r.to_stakers}, expected ${share} or 0 under the legacy parameters`);
    const bps =
      r.priority === 1 ? [legacy.tier2_discount_bps, legacy.tier3_discount_bps] : [0, legacy.tier1_discount_bps];
    const allowed = [...new Set(bps.map((d) => floorDiv(r.base * d, BPS)))];
    if (!allowed.includes(r.discount)) {
      warn(
        "P4",
        `discount ${r.discount} is not allowed for priority ${r.priority} under the legacy parameters (allowed ${allowed.join(", ")})`,
      );
    }
  } else {
    if (r.to_stakers !== 0)
      warn("P3", `to_stakers ${r.to_stakers}, expected 0 (the treasury takes the whole remainder)`);
    if (r.discount !== 0 || r.priority !== 0) {
      warn("P4", `discount ${r.discount} and priority ${r.priority}, expected 0 and 0`);
    }
  }
  if (isInt(r.created_at) && isInt(r.epoch)) {
    const epoch = Math.floor(r.created_at / 1000 / p.epoch_seconds);
    if (r.epoch !== epoch) warn("P5", `epoch ${r.epoch}, expected floor(created_at / 1000 / epoch_seconds) = ${epoch}`);
  }
  return out;
}

/** Run checkRecord (and checkRecordWithParams when params are given) over a list of records. */
export function checkInvariants(records: readonly SettlementRecord[], params?: FeeParams): Violation[] {
  const out: Violation[] = [];
  for (const r of records) {
    out.push(...checkRecord(r));
    if (params) out.push(...checkRecordWithParams(r, params));
  }
  return out;
}
