import type { ChainDump, FeeParams, SettlementRecord } from "./types.js";

export const DEFAULT_BASE_URL = "https://dapp.inferva.xyz";
/** The server clamps `limit` to 1..200. */
export const MAX_PAGE_SIZE = 200;

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface FetchOptions {
  fetch?: FetchLike;
  pageSize?: number;
  /** Called after each page with the number of records collected so far. */
  onPage?: (total: number) => void;
}

const trim = (url: string) => url.replace(/\/+$/, "");

async function getJson(f: FetchLike, url: string): Promise<unknown> {
  const res = await f(url);
  if (!res.ok) throw new Error(`GET ${url} failed with HTTP ${res.status}`);
  return res.json();
}

/**
 * Page through `GET /api/chain?after=<seq>&limit=<n>` (SPEC section 4) until a short page.
 * Fails if the genesis value changes between pages or a page does not move past `after`.
 */
export async function fetchChain(baseUrl = DEFAULT_BASE_URL, opts: FetchOptions = {}): Promise<ChainDump> {
  const f = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const pageSize = Math.min(Math.max(Math.trunc(opts.pageSize ?? MAX_PAGE_SIZE), 1), MAX_PAGE_SIZE);
  let genesis: string | undefined;
  const records: SettlementRecord[] = [];
  let after = 0;
  for (;;) {
    const page = (await getJson(
      f,
      `${trim(baseUrl)}/api/chain?after=${after}&limit=${pageSize}`,
    )) as Partial<ChainDump>;
    if (typeof page?.genesis !== "string" || !Array.isArray(page.records))
      throw new Error("unexpected /api/chain response");
    if (genesis === undefined) genesis = page.genesis;
    else if (page.genesis !== genesis) throw new Error("genesis changed between pages");
    for (const r of page.records) {
      if (!(Number.isSafeInteger(r?.seq) && r.seq > after))
        throw new Error(`page after=${after} returned seq ${String(r?.seq)}`);
      records.push(r);
      after = r.seq;
    }
    opts.onPage?.(records.length);
    if (page.records.length < pageSize) return { genesis, records };
  }
}

/** Current parameters from `GET /api/params`. Only meaningful for records settled under them. */
export async function fetchParams(
  baseUrl = DEFAULT_BASE_URL,
  opts: Pick<FetchOptions, "fetch"> = {},
): Promise<FeeParams> {
  const f = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const body = (await getJson(f, `${trim(baseUrl)}/api/params`)) as { params?: Record<string, unknown> };
  const p = body?.params ?? {};
  const keys = [
    "fee_bps",
    "staker_share_bps",
    "sponsor_share_bps",
    "epoch_seconds",
    "tier1_discount_bps",
    "tier2_discount_bps",
    "tier3_discount_bps",
  ] as const;
  const out = {} as FeeParams;
  for (const k of keys) {
    if (!Number.isSafeInteger(p[k])) throw new Error(`/api/params is missing ${k}`);
    out[k] = p[k] as number;
  }
  return out;
}

/** Parse a saved dump. Accepts `{ genesis, records }` (what `--save` writes) or a single `/api/chain` page. */
export function parseDump(text: string): ChainDump {
  const data = JSON.parse(text) as Partial<ChainDump>;
  if (typeof data?.genesis !== "string" || !Array.isArray(data.records)) {
    throw new Error("dump must be a JSON object with a genesis string and a records array");
  }
  return { genesis: data.genesis, records: data.records };
}
