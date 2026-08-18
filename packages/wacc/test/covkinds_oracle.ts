#!/usr/bin/env -S deno run --allow-read
// The reference compiler's coverage points, as an oracle for wacc's.
//
// **This file is the reference, not the test.** `issues/lang/0112` asked for a check that the two
// compilers instrument the same *constructs*, and the reference is the side that has always been
// right about which ones exist — so what it emits is the answer wacc is measured against.
//
// `wacCompile(files, entry, { coverage: true })` hands back `compiled.coverage` directly, so this
// does not go near `harness/wacCoverage.ts`'s `instrument`: that writes glue, imports the module and
// allocates counters, none of which is needed to ask how many points there are. It also means no temp
// directory — the sources cross as hex and the file map is built here.
//
// **A count rather than a set of kinds**, which is the whole reason this oracle exists. A kind-set
// comparison cannot see the failure `0112` recorded: wacc emitted no point for a `do` body, and any
// `while` in the same file supplies the `loop` kind, so the sets matched while a construct went
// unmeasured. `else` and `entry` counts differ between the compilers on purpose, so only the kinds
// where a difference is a defect are asked about.
//
// The usual direction: the test counts and this reports what it disagrees with.
//
//   covkinds <lib-hex> <entry-hex> <kind> <ours>
//
// `FAIL …` per disagreement, `DONE <n>` last. See `packages/wactest/src/oracle.wac`.

import { wacCompile } from "wac/wacCompile.ts";

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

function textOf(h: string): string {
  const bytes = new Uint8Array((h ?? "").length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

const lines = new TextDecoder().decode(readAll()).split("\n").filter((l) => l.length > 0);
const out: string[] = [];
const say = (s: string) => {
  if (out.length < 20) out.push(`FAIL ${s}`);
};

for (const line of lines) {
  const [op, ...rest] = line.split(" ");
  try {
    if (op === "covkinds") {
      const [libHex, entryHex, kind, oursText] = rest;
      const files = new Map([
        ["/lib.wac", textOf(libHex)],
        ["/entry.wac", textOf(entryHex)],
      ]);
      const r = wacCompile(files, "/entry.wac", { coverage: true });
      if (!r.ok) {
        say(`the reference refused the fixture: ${r.diagnostics.map((d) =>
          `${d.file}:${d.line}:${d.col} ${d.message}`).join("; ")}`);
        continue;
      }
      const points = r.compiled.coverage ?? [];
      const theirs = points.filter((p: { kind: string }) => p.kind === kind).length;
      const ours = Number(oursText);
      if (ours !== theirs) {
        const shown = points.map((p: { file: string; line: number; col: number; kind: string }) =>
          `${p.file}:${p.line}:${p.col} ${p.kind}`).join(", ");
        say(
          `wacc emits ${ours} ${kind} point(s) and the reference ${theirs} — a construct one of ` +
            `them measures and the other does not. reference: ${shown}`,
        );
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
