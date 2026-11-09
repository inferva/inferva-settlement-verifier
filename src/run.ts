import { checkInvariants } from "./invariants.js";
import { verifyChain } from "./verify.js";
import type { ChainDump, FeeParams, VerifyResult, Violation } from "./types.js";

export interface RunOptions {
  params?: FeeParams;
}

export interface RunReport extends VerifyResult {
  source: string;
  genesis: string;
  records: number;
  firstSeq: number | null;
  lastSeq: number | null;
  errors: Violation[];
  warnings: Violation[];
  /** True when the chain verified end to end and no record has an error-level violation. */
  ok: boolean;
}

/** Verify a dump end to end: the hash chain plus every per-record invariant. */
export async function runVerify(dump: ChainDump, source: string, opts: RunOptions = {}): Promise<RunReport> {
  const result = await verifyChain(dump.genesis, dump.records);
  const violations = checkInvariants(dump.records, opts.params);
  const errors = violations.filter((v) => v.severity === "error");
  const warnings = violations.filter((v) => v.severity === "warning");
  return {
    source,
    genesis: dump.genesis,
    records: dump.records.length,
    firstSeq: dump.records[0]?.seq ?? null,
    lastSeq: dump.records.at(-1)?.seq ?? null,
    ...result,
    errors,
    warnings,
    ok: result.broken === null && errors.length === 0,
  };
}
