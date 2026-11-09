import type { HashedFields } from "./types.js";

/** The genesis value the live log uses when no other genesis is configured: 64 zeros. */
export const DEFAULT_GENESIS = "0".repeat(64);

/**
 * Canonical string a record hashes (SPEC section 3):
 * prev_hash|id|payer|provider|model|tokens|base|discount|fee|capacity_id|epoch|created_at
 */
export function settlementPayload(r: HashedFields, prevHash: string): string {
  return [
    prevHash,
    r.id,
    r.payer,
    r.provider,
    r.model,
    r.tokens,
    r.base,
    r.discount,
    r.fee,
    r.capacity_id,
    r.epoch,
    r.created_at,
  ].join("|");
}

let subtle: SubtleCrypto | undefined;

async function getSubtle(): Promise<SubtleCrypto> {
  if (subtle) return subtle;
  const global = (globalThis as { crypto?: Crypto }).crypto;
  if (global?.subtle) return (subtle = global.subtle);
  // Node 18 without the global: fall back to node:crypto's WebCrypto. The specifier is a variable so
  // browser bundlers do not try to resolve it.
  const specifier = "node:crypto";
  const mod = (await import(/* @vite-ignore */ specifier)) as { webcrypto: Crypto };
  return (subtle = mod.webcrypto.subtle);
}

/** SHA-256 of the UTF-8 bytes of `text`, as 64 lowercase hex characters. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await (await getSubtle()).digest("SHA-256", new TextEncoder().encode(text));
  let out = "";
  for (const b of new Uint8Array(digest)) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Hash of one record given the hash it points at. */
export function recordHash(r: HashedFields, prevHash: string): Promise<string> {
  return sha256Hex(settlementPayload(r, prevHash));
}
