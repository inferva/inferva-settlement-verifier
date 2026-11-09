import { recordHash } from "./payload.js";
import type { SettlementRecord, VerifyResult } from "./types.js";

export const REASONS = {
  malformed: "malformed record",
  link: "does not point at the previous record",
  hash: "hash does not match its contents",
  seq: "seq is not increasing",
} as const;

const HEX64 = /^[0-9a-f]{64}$/;
const STRING_FIELDS = ["id", "payer", "provider", "model", "capacity_id"] as const;
const INT_FIELDS = ["tokens", "base", "discount", "fee", "epoch", "created_at"] as const;

/** Shape problems that make a record impossible to hash as specified. Returns null when the shape is fine. */
export function shapeProblem(r: unknown): string | null {
  if (!r || typeof r !== "object") return "not an object";
  const rec = r as Record<string, unknown>;
  if (!Number.isSafeInteger(rec.seq)) return "seq is not an integer";
  for (const k of STRING_FIELDS) if (typeof rec[k] !== "string") return `${k} is not a string`;
  for (const k of INT_FIELDS) if (!Number.isSafeInteger(rec[k])) return `${k} is not an integer`;
  if (typeof rec.prev_hash !== "string" || !HEX64.test(rec.prev_hash)) return "prev_hash is not 64 lowercase hex";
  if (typeof rec.hash !== "string" || !HEX64.test(rec.hash)) return "hash is not 64 lowercase hex";
  return null;
}

/**
 * Walk the chain from `genesis` (SPEC section 5). For each record, in order:
 * shape, link to the previous hash, recomputed hash, then seq order. Stops at the first failure.
 * Never trusts a record's `hash` column for anything but the comparison.
 */
export async function verifyChain(genesis: string, records: readonly SettlementRecord[]): Promise<VerifyResult> {
  if (typeof genesis !== "string" || !HEX64.test(genesis))
    throw new Error("genesis must be 64 lowercase hex characters");
  let prev = genesis;
  let prevSeq = -Infinity;
  let checked = 0;
  for (const r of records) {
    const seq = Number.isSafeInteger(r?.seq) ? r.seq : NaN;
    const problem = shapeProblem(r);
    if (problem) return { checked, tip: prev, broken: { seq, reason: `${REASONS.malformed}: ${problem}` } };
    if (r.prev_hash !== prev) return { checked, tip: prev, broken: { seq, reason: REASONS.link } };
    const hash = await recordHash(r, prev);
    if (hash !== r.hash) return { checked, tip: prev, broken: { seq, reason: REASONS.hash } };
    if (!(seq > prevSeq)) return { checked, tip: prev, broken: { seq, reason: REASONS.seq } };
    prev = hash;
    prevSeq = seq;
    checked++;
  }
  return { checked, tip: prev, broken: null };
}
