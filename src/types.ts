/** One settlement record as served by `/api/chain`. Amounts are integers in micro USDC (1 USDC = 1,000,000). */
export interface SettlementRecord {
  seq: number;
  id: string;
  key_id?: string;
  payer: string;
  provider: string;
  model: string;
  tokens: number;
  base: number;
  discount: number;
  fee: number;
  to_stakers: number;
  to_sponsor: number;
  to_treasury: number;
  capacity_id: string;
  priority: number;
  epoch: number;
  prev_hash: string;
  hash: string;
  created_at: number;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  [extra: string]: unknown;
}

/** The fields that go into a record's hash, in SPEC order (after `prev_hash`). */
export type HashedFields = Pick<
  SettlementRecord,
  | "id"
  | "payer"
  | "provider"
  | "model"
  | "tokens"
  | "base"
  | "discount"
  | "fee"
  | "capacity_id"
  | "epoch"
  | "created_at"
>;

/** A whole chain: the genesis value plus every record in `seq` order. Also the dump file format. */
export interface ChainDump {
  genesis: string;
  records: SettlementRecord[];
}

export interface ChainBreak {
  seq: number;
  reason: string;
}

export interface VerifyResult {
  /** Records whose link and hash were confirmed, counted from the start. */
  checked: number;
  /** Hash of the last confirmed record, or the genesis value if none were confirmed. */
  tip: string;
  /** The first record that failed, or null when the whole chain verified. */
  broken: ChainBreak | null;
}

export type Severity = "error" | "warning";

export interface Violation {
  seq: number;
  code: string;
  severity: Severity;
  message: string;
}

/** The protocol parameters the params-dependent checks need, as served by `/api/params`. */
export interface FeeParams {
  fee_bps: number;
  staker_share_bps: number;
  sponsor_share_bps: number;
  epoch_seconds: number;
  tier1_discount_bps: number;
  tier2_discount_bps: number;
  tier3_discount_bps: number;
}
