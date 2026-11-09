# INFERVA settlement log, spec v1

Status: v1, describes the settlement log served by the INFERVA app at https://dapp.inferva.xyz as of 2026-11-09.

Every request metered through the INFERVA endpoint writes one settlement record. Each record carries the hash of
the record before it, so the log is a single hash chain that starts from a genesis value. This document specifies
the record, the hash, the chain rule, how to download the log, and the per-record arithmetic that the app's
settlement code guarantees. The reference verifier in this repository implements it.

The key words MUST, MUST NOT and SHOULD are used as in RFC 2119.

## 1. Units

All amounts are integers in micro units of USDG: 1 USDG = 1,000,000. `tokens` is a plain count. `created_at` is a
Unix timestamp in milliseconds. `epoch` is an integer epoch number (section 6.3, P5). Basis points (bps) are parts of
10,000.

## 2. Record

A record as returned by `GET /api/chain` has these fields. "Hashed" marks the fields covered by the record hash.

| Field               | Type         | Hashed | Meaning                                                                |
| ------------------- | ------------ | ------ | ---------------------------------------------------------------------- |
| `seq`               | integer      | no     | Position in the log, assigned by the database, strictly increasing     |
| `id`                | string       | yes    | Request id, unique                                                     |
| `key_id`            | string       | no     | Agent key that made the request                                        |
| `payer`             | string       | yes    | Wallet address of the key owner who paid                               |
| `provider`          | string       | yes    | Provider id that served the request                                    |
| `model`             | string       | yes    | Model id                                                               |
| `tokens`            | integer      | yes    | Tokens metered                                                         |
| `base`              | integer      | yes    | Provider cost, repaid to the capacity sponsor                          |
| `discount`          | integer      | yes    | Discount on the provider cost. `0` on current records (section 6.4)    |
| `fee`               | integer      | yes    | Protocol fee                                                           |
| `to_stakers`        | integer      | no     | Legacy fee share column. `0` on current records (section 6.4)          |
| `to_sponsor`        | integer      | no     | Fee share to the capacity sponsor                                      |
| `to_treasury`       | integer      | no     | Fee share to the treasury: the rest of the fee after `to_sponsor`      |
| `capacity_id`       | string       | yes    | Sponsored capacity position the request drew on                        |
| `priority`          | 0 or 1       | no     | Legacy flag. `0` on current records (section 6.4)                      |
| `epoch`             | integer      | yes    | Epoch the request belongs to                                           |
| `prev_hash`         | 64 hex       | (link) | Hash of the previous record, or the genesis value for the first record |
| `hash`              | 64 hex       | (out)  | This record's hash                                                     |
| `created_at`        | integer (ms) | yes    | When the request was accepted                                          |
| `prompt_tokens`     | integer/null | no     | Input tokens. `null` on records written before this column existed     |
| `completion_tokens` | integer/null | no     | Output tokens. `null` on records written before this column existed    |

The response can carry more columns (for example `latency_ms`, `stream`). They are not hashed and a verifier MUST
ignore unknown fields.

The agent pays `base - discount + fee` (`base + fee` on current records, where `discount` is 0). The sponsor of the
capacity position receives `base + to_sponsor`.

`discount`, `to_stakers` and `priority` stay in the record so that every record, old or new, has the same shape and
hashes the same way. `discount` is hashed, so it can never be dropped from the payload.

## 3. Payload

The payload of a record is these twelve values joined with a single `|` (U+007C), in exactly this order:

```
prev_hash|id|payer|provider|model|tokens|base|discount|fee|capacity_id|epoch|created_at
```

- `prev_hash` is the hash the record points at (section 5), as 64 lowercase hex characters.
- String fields are used as-is, byte for byte, with no trimming or case change.
- Integer fields are written in base 10, no sign, no leading zeros, no exponent, no separators
  (JavaScript `String(n)` for a safe integer; `0` is `0`).
- There is no escaping. The separator is not allowed to appear inside a field in practice (ids are
  `prefix_<hex>` and addresses are hex), but a verifier SHOULD NOT treat payload equality as proof that the
  individual fields are equal if a field could contain `|`.

Example (record 1 of `vectors/valid.json`):

```
0000000000000000000000000000000000000000000000000000000000000000|req_00000000000000000001|0x1111111111111111111111111111111111111111|prv_alpha|model-a|192|346|0|35|cap_000000000001|497222|1790000000000
```

## 4. Hash

```
hash = lowercase_hex( SHA-256( UTF-8( payload ) ) )
```

The result is always 64 characters `[0-9a-f]`.

## 5. Genesis and chaining

- The log has one genesis value, a 64-hex string, served with every page of `/api/chain` as `genesis`. If the app
  has no genesis configured it uses 64 zeros: `0000000000000000000000000000000000000000000000000000000000000000`.
  The live log uses 64 zeros.
- The first record's `prev_hash` MUST equal the genesis value.
- Every later record's `prev_hash` MUST equal the `hash` of the record before it in `seq` order.
- `prev_hash` is unique across the log (a unique index in the database), so each record has at most one successor
  and the log cannot fork.
- A record is written by reading the current tip (the newest `hash`, or the genesis value when the log is empty),
  computing the new hash over it, and inserting. If another record took the same `prev_hash` first, the insert
  fails on the unique index and the writer re-reads the tip and retries.

To verify, walk the records in `seq` order from the genesis value. For each record:

1. Shape: the hashed fields have the types in section 2, `prev_hash` and `hash` are 64 lowercase hex.
   Failure reason: `malformed record: <detail>`.
2. Link: `prev_hash` equals the running tip. Failure reason: `does not point at the previous record`.
3. Content: recompute the hash from the payload with the running tip. It MUST equal `hash`.
   Failure reason: `hash does not match its contents`.
4. Order: `seq` is greater than the previous record's `seq`. Failure reason: `seq is not increasing`.
   (`seq` is not hashed; this catches an edited `seq` or a dump that is out of order but still links.)

On success the running tip becomes the recomputed hash. The verifier never uses a stored `hash` except for the
comparison in step 3. It stops at the first failure and reports `{ checked, tip, broken: { seq, reason } }`, where
`checked` is the number of records confirmed before the failure and `tip` is the last confirmed hash (or the genesis
value). A full pass reports `broken: null` and the tip of the whole log.

`seq` values can have gaps. A verifier MUST NOT require them to be consecutive. `created_at` and `epoch` are taken
when a request is accepted, and a slower request can settle after a faster one, so neither is guaranteed to be
monotonic along the chain.

## 6. Per-record invariants

The app computes each record's amounts like this (integer arithmetic on safe integers; `ceil` and `floor` on the
exact quotient):

```
base        = ceil(tokens * price_per_1k / 1000)          // price_per_1k: the provider's effective price, not recorded
discount    = 0
fee         = ceil(base * fee_bps / 10000)
to_sponsor  = floor(fee * sponsor_share_bps / 10000)
to_treasury = fee - to_sponsor
to_stakers  = 0
priority    = 0
tokens      = prompt_tokens + completion_tokens
epoch       = floor(created_at / 1000 / epoch_seconds)
```

So the fee rounds up, the sponsor share rounds down, and the treasury takes the remainder of the fee. Records
settled under the earlier fee schedule follow section 6.4.

The split fields, `priority`, `prompt_tokens` and `completion_tokens` are not part of the hash. The checks in this
section are consistency checks. They are not tamper evidence for those fields.

### 6.1 Always (severity: error)

These hold for every record whatever the parameters were.

- **I1** `tokens`, `base`, `discount`, `fee`, `to_stakers`, `to_sponsor`, `to_treasury`, `epoch`, `created_at` are
  non-negative integers. (`to_treasury >= 0` because governance keeps `sponsor_share_bps <= 10000`.)
- **I2** `to_stakers + to_sponsor + to_treasury = fee`, exactly. (`to_stakers` is 0 on current records and stays in
  the sum so older records still balance.)
- **I3** `priority` is `0` or `1`.
- **I4** When both `prompt_tokens` and `completion_tokens` are non-null, `prompt_tokens + completion_tokens = tokens`.

### 6.2 Within the v1 governance bounds (severity: warning)

v1 governance only accepts `fee_bps` from 1 to 5000 (and, under the earlier fee schedule, discounts from 0 to 5000
bps). Parameters set outside governance are not covered, so these are reported as warnings.

- **B1** `2 * discount <= base` (the discount is at most half the provider cost; trivially true when it is 0).
- **B2** `fee >= 1` when `base >= 1`, and `fee = 0` when `base = 0` (the fee rounds up and `fee_bps >= 1`).
- **B3** `2 * fee <= base + 1` (the fee is at most `ceil(base / 2)`).

### 6.3 Under a known parameter set (severity: warning)

The parameters are governable and are not stored on the record, so these checks only say whether a record was
settled under a given parameter set (for example the current `GET /api/params`). A mismatch on an older record can
simply mean the parameters changed since.

- **P1** `fee = ceil(base * fee_bps / 10000)`.
- **P2** `to_sponsor = floor(fee * sponsor_share_bps / 10000)`.
- **P3** `to_stakers = 0` (so `to_treasury = fee - to_sponsor`).
- **P4** `discount = 0` and `priority = 0`.
- **P5** `epoch = floor(created_at / 1000 / epoch_seconds)`.

When the parameter set also carries the legacy parameters of section 6.4, P3 and P4 follow that section instead.

### 6.4 Records settled under the earlier fee schedule

Records written before the fee schedule was simplified can carry a non-zero `discount`, `to_stakers` or
`priority`. They hash exactly like current records and verify the same way. Their amounts were computed with four
more parameters, `staker_share_bps`, `tier1_discount_bps`, `tier2_discount_bps` and `tier3_discount_bps`, that a
parameter set from that time also carries:

```
discount    = floor(base * d / 10000)                      // d: 0, tier1_discount_bps, tier2_discount_bps or tier3_discount_bps
share       = floor(fee * staker_share_bps / 10000)
to_stakers  = share, or 0 when the share was not paid out
to_treasury = fee - to_sponsor - to_stakers
priority    = 1 when d was tier2_discount_bps or tier3_discount_bps, else 0
```

Under such a parameter set:

- **P3** `to_stakers` is `floor(fee * staker_share_bps / 10000)` or `0`.
- **P4** `discount = floor(base * d / 10000)` where `d` is `0` or `tier1_discount_bps` when `priority = 0`, and
  `tier2_discount_bps` or `tier3_discount_bps` when `priority = 1`.

A current record (discount, `to_stakers` and `priority` all 0) also passes these two checks.

## 7. Downloading the log

```
GET /api/chain?after=<seq>&limit=<n>
-> { "genesis": "<64 hex>", "records": [ <record>, ... ] }
```

- Returns records with `seq > after`, ordered by `seq` ascending.
- `after` defaults to 0. `limit` is clamped to 1..200 and defaults to 200.
- To read the whole log: start with `after=0`, set `after` to the last `seq` of each page, and stop at the first page
  with fewer than `limit` records.
- `genesis` is the same on every page. A client SHOULD fail if it changes between pages, or if a page returns a
  `seq` that is not greater than `after`.

`GET /api/requests?limit=<n>` returns the newest records first (`limit` 1..200, default 50) with the provider's
display name joined as `provider_name`. It is for display. Use `/api/chain` to verify.

Every completion response from the endpoint also returns `inferva.settlement.hash` and `inferva.settlement.prev_hash`
for its own record, so an agent can keep receipts and check later that they are in the log.

## 8. What verification shows

A full pass shows that the log, as downloaded, is one unbroken chain from its genesis value: no hashed field of a
record was changed, and no record was removed, inserted or moved, without every later hash changing too. Any tip
or receipt hash you saved earlier therefore pins everything up to it: if that hash is still in the log, nothing
before it was edited.

It does not show:

- that the log was not rewritten as a whole. Whoever controls the log can edit a record and recompute every hash
  after it. That changes the tip, so it is caught only by comparing against a hash recorded somewhere else: a tip you
  saved, receipts you hold, or (planned, not live) the tip anchored onchain each epoch on Robinhood Chain.
- that the newest records, after the last hash you saved, were not dropped.
- that the fields not in the hash (section 2) are untouched. Section 6 only checks that they are consistent.
- that the amounts were fair, that the provider served what was billed, or that balances match the log.

## 9. Changes

- v1 (2026-11-09): first version.
- v1, revised 2026-11-09: amounts are in USDG. The fee is split between the capacity sponsor and the treasury;
  `discount`, `to_stakers` and `priority` are 0 on current records and keep their place in the record and, for
  `discount`, in the payload. The earlier fee schedule moved to section 6.4. The payload and hash are unchanged.
