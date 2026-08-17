#!/usr/bin/env -S deno run
// What the real ABI decoders do with malformed input — Foundry's `cast` and `ethers`, in one batch.
//
// **This file is the reference, not the test.** `packages/abi/test/wac/strictness_test.wac` holds a
// table of what each tool accepts, and the whole point of that table is that it is a *measurement*:
// if either tool changes its mind, the suite should say so rather than the table going quietly stale.
//
// It exists because the host-side version could not quite make that claim. Its header said "this file
// runs each malformation through `cast` and `ethers` and asserts what all three do", and the code
// only ever ran `cast` — the `ethers` column was written down and never checked. Both are checked
// here.
//
// `ethers` is `npm:ethers@6`, the same version `packages/abi/tools/vendor.ts` produced the corpus with, and it is
// resolved from Deno's cache so this needs no network.
//
// Input is lines on stdin:
//
//     castpath <pathHex>                        where `cast` is; without it the cast rows are skipped
//     cast   <typeHex> <dataHex> <verdict>      what Foundry does with these bytes
//     ethers <typeHex> <dataHex> <verdict>      what ethers does
//
// `<verdict>` is `accepts` or `refuses`. Failures go to stdout as `FAIL <reason>`; the last line is
// `DONE <count>`.

import { AbiCoder } from "npm:ethers@6";

function readAll(): Uint8Array {
  const chunks: Uint8Array[] = [];
  const buf = new Uint8Array(1 << 16);
  for (;;) {
    const n = Deno.stdin.readSync(buf);
    if (n === null || n === 0) break;
    chunks.push(buf.slice(0, n));
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const fromHex = (h: string): string => {
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
};

/**
 * Whether `ethers` reads these bytes as this type at all.
 *
 * **The result has to be touched.** `AbiCoder.decode` in ethers 6 returns a `Result` whose errors are
 * *deferred*: a dirty address comes back without throwing and throws on access, with the message
 * "deferred error during ABI decoding triggered accessing…". A verdict taken from `decode` alone
 * calls that acceptance, which is how this oracle read "accepts" for the one row the table says it
 * refuses — and would have quietly agreed with a wrong table for the same reason the host-side
 * version did, by not really asking.
 */
function ethersVerdict(type: string, data: string): "accepts" | "refuses" {
  try {
    const values = AbiCoder.defaultAbiCoder().decode([type], data);
    for (const v of values) String(v);
    return "accepts";
  } catch {
    return "refuses";
  }
}

async function castVerdict(cast: string, type: string, data: string): Promise<"accepts" | "refuses"> {
  const r = await new Deno.Command(cast, {
    args: ["abi-decode", `f()(${type})`, data],
    stdout: "piped",
    stderr: "piped",
  }).output();
  return r.success ? "accepts" : "refuses";
}

async function main(): Promise<number> {
  const lines = new TextDecoder().decode(readAll()).split("\n").filter((l) => l.length > 0);
  const out: string[] = [];
  const say = (s: string) => {
    if (out.length < 40) out.push(`FAIL ${s}`);
  };

  let cast: string | null = null;
  for (const line of lines) {
    if (line.startsWith("castpath ")) cast = fromHex(line.split(" ")[1]);
  }

  for (const line of lines) {
    const f = line.split(" ");
    if (f[0] === "castpath") continue;
    if (f[0] !== "cast" && f[0] !== "ethers") {
      say(`unknown check ${JSON.stringify(f[0])}`);
      continue;
    }
    const type = fromHex(f[1]);
    const data = fromHex(f[2]);
    const want = f[3];
    if (f[0] === "ethers") {
      const got = ethersVerdict(type, data);
      if (got !== want) {
        say(`ethers ${got} ${type} ${data}, and the table says it ${want} — re-measure the table`);
      }
    } else {
      // No `cast` is a row not measured rather than a row that passed. The caller is told, and it is
      // the caller that decides whether a missing tool is a skip or a failure — it is the side that
      // knows whether it was able to *look*.
      if (cast === null) {
        say(`cast was not located, so "${type} ${data}" is unmeasured rather than agreed`);
        continue;
      }
      const got = await castVerdict(cast, type, data);
      if (got !== want) {
        say(`cast ${got} ${type} ${data}, and the table says it ${want} — re-measure the table`);
      }
    }
  }

  for (const line of out) console.log(line);
  console.log(`DONE ${lines.length}`);
  return 0;
}

Deno.exit(await main());
