#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DEFAULT_BASE_URL, fetchChain, fetchParams, parseDump } from "./fetch.js";
import { runVerify, type RunReport } from "./run.js";
import type { Violation } from "./types.js";

const HELP = `inferva-verify: recompute the INFERVA settlement log hash chain (SPEC v1)

Usage:
  inferva-verify [--base-url <url>] [--file <dump.json>] [--save <dump.json>] [--params] [--json]

Options:
  --base-url <url>   App to read /api/chain from (default ${DEFAULT_BASE_URL})
  --file <path>      Verify a saved dump ({ genesis, records }) instead of the live log
  --save <path>      Also write the fetched chain to this file as a dump
  --params           Also check the exact fee math against the current /api/params (advisory)
  --page-size <n>    Records per request, 1..200 (default 200)
  --json             Print the report as JSON
  -h, --help         Show this help

Exit codes: 0 chain and invariants hold, 1 chain broken or an invariant error, 2 usage or network error.`;

function line(v: Violation) {
  return `  seq ${v.seq} [${v.code}] ${v.message}`;
}

function printText(r: RunReport) {
  const out: string[] = [];
  out.push(`source   ${r.source}`);
  out.push(`genesis  ${r.genesis}`);
  out.push(`records  ${r.records}${r.records ? ` (seq ${r.firstSeq}..${r.lastSeq})` : ""}`);
  out.push(`checked  ${r.checked}`);
  out.push(`tip      ${r.tip}`);
  out.push(r.broken ? `chain    BROKEN at seq ${r.broken.seq}: ${r.broken.reason}` : "chain    OK");
  out.push(`errors   ${r.errors.length}`);
  for (const v of r.errors) out.push(line(v));
  out.push(`warnings ${r.warnings.length}`);
  for (const v of r.warnings) out.push(line(v));
  out.push(r.ok ? "result   VERIFIED" : "result   FAILED");
  console.log(out.join("\n"));
}

export async function main(argv: string[]): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        "base-url": { type: "string", default: DEFAULT_BASE_URL },
        file: { type: "string" },
        save: { type: "string" },
        params: { type: "boolean", default: false },
        "page-size": { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
    }));
  } catch (e) {
    console.error(`${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const baseUrl = values["base-url"]!;
  try {
    const pageSize = values["page-size"] ? Number(values["page-size"]) : undefined;
    const dump = values.file
      ? parseDump(await readFile(values.file, "utf8"))
      : await fetchChain(baseUrl, {
          pageSize,
          onPage: (n) => {
            if (!values.json) process.stderr.write(`\rfetched ${n} records`);
          },
        });
    if (!values.file && !values.json) process.stderr.write("\n");
    if (values.save) await writeFile(values.save, JSON.stringify(dump, null, 2) + "\n");
    const params = values.params ? await fetchParams(baseUrl) : undefined;
    const report = await runVerify(dump, values.file ?? `${baseUrl}/api/chain`, { params });
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else printText(report);
    return report.ok ? 0 : 1;
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 2;
  }
}

const invoked = process.argv[1] ?? "";
if (/(?:^|[\\/])(?:cli\.(?:js|ts)|inferva-verify)$/.test(invoked)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
