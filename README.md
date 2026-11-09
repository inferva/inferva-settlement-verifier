# INFERVA settlement verifier

Specification and independent verifier for the [INFERVA](https://inferva.xyz) settlement log.

Every request metered through INFERVA writes a settlement record: who paid, which provider and model, tokens,
provider cost, discount, protocol fee, the fee split, the capacity position used, the epoch and a timestamp. Each
record hashes the one before it, so the whole log is a single SHA-256 chain from a genesis value. This package lets
anyone recompute that chain without trusting the app's own hash column or its in-browser check.

- [`SPEC.md`](./SPEC.md): record fields, the exact payload, genesis, chaining rule, pagination of `/api/chain` and
  the per-record arithmetic invariants (v1).
- `verifyChain(genesis, records)`: zero runtime dependencies, WebCrypto, works in Node 18+ and browsers.
- `inferva-verify`: a CLI that pages through the live log or a saved dump.
- [`vectors/`](./vectors): golden vectors (valid chain, custom and wrong genesis, tampered field, tampered split,
  dropped record, reordered records) plus the first live record as hashed by the app.

## Quick start

```bash
pnpm install
pnpm build
node dist/cli.js                       # verify the live log at https://dapp.inferva.xyz
node dist/cli.js --params              # also check the exact fee math against the current parameters
node dist/cli.js --save chain.json     # keep a copy, verify it again later with --file
node dist/cli.js --file chain.json --json
```

```
source   https://dapp.inferva.xyz/api/chain
genesis  0000000000000000000000000000000000000000000000000000000000000000
records  1 (seq 1..1)
checked  1
tip      47eaac5d4a736c64788462012ef0554f9d7fb55a7561381d969d2ec0d6347dd4
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
Amounts are integers in micro USDC (1 USDC = 1,000,000). Full rules in [`SPEC.md`](./SPEC.md).

## What it proves, and what it doesn't

It proves that the log is one unbroken chain from its own genesis value: no hashed field of any record was edited,
and no record was removed, inserted or reordered after the fact, without every later hash changing too. Any hash you
saved earlier, a tip or a receipt from an API response (`inferva.settlement.hash`), pins every record up to it.

It does not prove:

- that the whole log was not rebuilt. Whoever runs the log could edit a record and recompute every hash after it,
  which changes the tip. Catching that needs a hash recorded somewhere else. Anchoring the tip onchain each epoch on
  Elysium is planned, not live; until it ships, the outside reference is a tip or receipts you kept.
- that the newest records, after the last hash you saved, were not dropped.
- that the fee split (`to_stakers`, `to_sponsor`, `to_treasury`), `priority` or the token breakdown are untouched.
  They are not in the hash. The verifier checks they are consistent (for example
  `to_stakers + to_sponsor + to_treasury = fee`), which is not the same as tamper evidence.
- that prices were fair, that a provider served what was billed, or that balances match the log.

## Invariants

Errors (hold for every record): non-negative integer amounts (I1), the fee split sums to the fee exactly (I2),
`priority` is 0 or 1 (I3), prompt plus completion tokens equal `tokens` when both are present (I4).

Warnings: limits that follow from the v1 governance bounds (B1 to B3), and, with `--params`, the exact rounding of
the fee, shares, discount and epoch under the current parameters (P1 to P5). Parameters are governable and not
stored per record, so a P warning on an older record can mean the parameters changed. See [`SPEC.md`](./SPEC.md)
section 6.

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
