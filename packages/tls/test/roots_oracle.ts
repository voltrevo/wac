#!/usr/bin/env -S deno run -A
// The trust store `host/connect.ts` builds, as an oracle for the one `src/roots.wac` builds.
//
// **This file is the reference, not the test.** Same role `packages/tls/test/oracle.mjs` plays for
// openssl and `packages/crypto/test/oracle.mjs` for node's digests. It is not part of the TypeScript
// that `issues/system/0161` is moving — `pemBundle` here is imported rather than reimplemented, so
// what the wac side is measured against is exactly the function that has been building this store for
// every TLS test in the package.
//
// **Deno rather than node, and not by preference.** `oracle.mjs` next door is node, which is right
// for `node:crypto`; this one has to import a `.ts` module, so it is Deno. Reimplementing `pemBundle`
// in `.mjs` to keep the two in one file would have made the oracle a second opinion instead of the
// reference, which is the whole thing this test is for.
//
// **Run with `-A`, and the reason is `connect.ts` rather than this file.** Importing it runs a
// top-level `wacBind`, which reads the environment and compiles a wac module, so a narrower grant
// fails at import with `Object.getEnv` before a single line of input is read. `pemBundle` itself
// touches nothing — the cost is the price of importing the reference instead of copying it.
//
// The usual direction: the test computes and this reports only what it disagrees with.
//
//   roots <bundle-path> <our-der-hex> <our-offsets-csv>
//
// Our DER crosses whole — a couple of hundred kilobytes, once — so that a disagreement can name the
// byte it happens at, which a checksum could not. That is the diagnostic the host-side version gave
// and it is worth a large line to keep.
//
// `FAIL …` per disagreement, `DONE <n>` last. See `packages/wactest/src/oracle.wac`.

import { pemBundle } from "../host/connect.ts";

function readAll(): Uint8Array {
  const chunks: Uint8Array[] = [];
  const buf = new Uint8Array(1 << 20);
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

function bytesOf(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const lines = new TextDecoder().decode(readAll()).split("\n").filter((l) => l.length > 0);
const out: string[] = [];
const say = (s: string) => {
  if (out.length < 20) out.push(`FAIL ${s}`);
};

for (const line of lines) {
  const [op, ...rest] = line.split(" ");
  try {
    if (op === "roots") {
      const [path, derHex, offsetsCsv] = rest;
      const want = pemBundle(Deno.readTextFileSync(path));
      const ours = bytesOf(derHex ?? "");
      const theirOffsets = Array.from(want.offsets);
      const ourOffsets = (offsetsCsv ?? "").split(",").filter((s) => s.length > 0).map(Number);

      if (ourOffsets.length !== theirOffsets.length) {
        say(`we found ${ourOffsets.length / 2} certificates, the reference found ${
          theirOffsets.length / 2
        }`);
      } else {
        for (let i = 0; i < theirOffsets.length; i++) {
          if (ourOffsets[i] !== theirOffsets[i]) {
            say(`offset ${i} is ${ourOffsets[i]}, the reference says ${theirOffsets[i]}`);
            break;
          }
        }
      }

      if (ours.length !== want.der.length) {
        say(`our DER is ${ours.length} bytes, the reference's is ${want.der.length}`);
      } else {
        for (let i = 0; i < want.der.length; i++) {
          if (ours[i] !== want.der[i]) {
            say(`DER differs at byte ${i}: ${ours[i]} against ${want.der[i]}`);
            break;
          }
        }
      }
    } else {
      say(`unknown op ${JSON.stringify(op)}`);
    }
  } catch (e) {
    say(`${op}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

for (const l of out) console.log(l);
console.log(`DONE ${lines.length}`);
