# INFERVA settlement verifier

Specification and independent verifier for the [INFERVA](https://inferva.xyz) settlement log.

Every request metered through INFERVA writes a settlement record: who paid, which provider and model, tokens,
provider cost, protocol fee, the fee split between the capacity sponsor and the treasury, the capacity position
used, the epoch and a timestamp. Each
record hashes the one before it, so the whole log is a single SHA-256 chain from a genesis value. This package lets
anyone recompute that chain without trusting the app's own hash column or its in-browser check.

- [`SPEC.md`](./SPEC.md): record fields, the exact payload, genesis, chaining rule, pagination of `/api/chain` and
  the per-record arithmetic invariants (v1).
- `verifyChain(genesis, records)`: zero runtime dependencies, WebCrypto, works in Node 18+ and browsers.
- `inferva-verify`: a CLI that pages through the live log or a saved dump.
- [`vectors/`](./vectors): golden vectors (valid chain, custom and wrong genesis, tampered field, tampered split,
  dropped record, reordered records) plus the first live record as hashed by the app. The valid chain mixes records
  in the earlier record format (non-zero `discount`) with current ones, so both are covered.

## Quick start

```bash
pnpm install
pnpm build
node dist/cli.js                       # verify the live log at https://dapp.inferva.xyz
node dist/cli.js --params              # also check the exact fee math against the parameters the app serves now
node dist/cli.js --save chain.json     # keep a copy, verify it again later with --file
node dist/cli.js --file chain.json --json
```

```
source   https://dapp.inferva.xyz/api/chain
genesis  0000000000000000000000000000000000000000000000000000000000000000
records  2 (seq 1..2)
checked  2
tip      cd6bb091ecaefe1a347c6922f1b2b58f81c20966d2e3c7fa3459caeb20ac84a1
chain    OK
errors   0
warnings 0
result   VERIFIED
```

Exit code `0` means the chain and every invariant hold, `1` means the chain is broken or a record fails an
invariant, `2` means a usage or network error. Save the `tip` you see: next time, if that hash is still in the log,
nothing before it was changed.

Options: `--base-url <url>` (default `https://dapp.inferva.xyz`), `--file <dump.json>`, `--save <dump.json>`,
`--params`, `--page-size <1..200>`, `--json`.

## Library

```ts
import { fetchChain, verifyChain, checkInvariants } from "@inferva/settlement-verifier";

const { genesis, records } = await fetchChain("https://dapp.inferva.xyz");
const { checked, tip, broken } = await verifyChain(genesis, records);
// broken: null, or { seq, reason } for the first record that fails
const violations = checkInvariants(records); // [{ seq, code, severity, message }]
```

Also exported: `settlementPayload`, `sha256Hex`, `recordHash`, `checkRecord`, `checkRecordWithParams`,
`fetchParams`, `parseDump`, `runVerify` and the types.

## How a record is hashed

```
hash = sha256_hex( prev_hash|id|payer|provider|model|tokens|base|discount|fee|capacity_id|epoch|created_at )
```

`prev_hash` is the previous record's hash, or the genesis value (64 zeros on the live log) for the first record.
Amounts are integers in micro USDG (1 USDG = 1,000,000). Full rules in [`SPEC.md`](./SPEC.md).

`discount` is part of the hash, so it stays in the payload. It is 0 on current records; records written under the
earlier fee schedule can carry a non-zero value and still verify exactly as before. The same goes for the unhashed
legacy columns `to_stakers` and `priority`, which are 0 on current records.

## What it proves, and what it doesn't

It proves that the log is one unbroken chain from its own genesis value: no hashed field of any record was edited,
and no record was removed, inserted or reordered after the fact, without every later hash changing too. Any hash you
saved earlier, a tip or a receipt from an API response (`inferva.settlement.hash`), pins every record up to it.

It does not prove:

- that the whole log was not rebuilt. Whoever runs the log could edit a record and recompute every hash after it,
  which changes the tip. Catching that needs a hash recorded somewhere else. Anchoring the tip onchain each epoch on
  Robinhood Chain is planned, not live; until it ships, the outside reference is a tip or receipts you kept.
- that the newest records, after the last hash you saved, were not dropped.
- that the fee split (`to_sponsor`, `to_treasury`, and the legacy `to_stakers`), `priority` or the token breakdown
  are untouched. They are not in the hash. The verifier checks they are consistent (for example
  `to_stakers + to_sponsor + to_treasury = fee`, with `to_stakers` 0 on current records), which is not the same as
  tamper evidence.
- that prices were fair, that a provider served what was billed, or that balances match the log.

## Invariants

Errors (hold for every record): non-negative integer amounts (I1), the fee split sums to the fee exactly (I2),
`priority` is 0 or 1 (I3), prompt plus completion tokens equal `tokens` when both are present (I4).

Warnings: limits that follow from the v1 governance bounds (B1 to B3), and, with `--params`, the exact rounding of
the fee and epoch under the parameters the app serves now (P1 to P5): `to_sponsor = floor(fee * sponsor_share_bps /
10000)`, the treasury takes the remainder, and `discount`, `to_stakers` and `priority` are 0. If the served
parameters still include the earlier fee schedule's parameters, records settled under it are checked against them
instead (SPEC section 6.4). Parameters are governable and not stored per record, so a P warning on an older record
can mean the parameters changed. See [`SPEC.md`](./SPEC.md) section 6.

## Development

```bash
pnpm test        # vitest: vectors, an independent re-implementation of the payload, units, CLI
pnpm vectors     # regenerate vectors/ (the test fails if they drift from the generator)
INFERVA_LIVE=1 pnpm test   # also verify the live log (read-only)
pnpm typecheck && pnpm build
```

## Links

- Website: https://inferva.xyz
- Docs: https://docs.inferva.xyz
- Settlement log in the app: https://dapp.inferva.xyz/settlement
- GitHub: https://github.com/inferva

## License

MIT, see [LICENSE](./LICENSE).
