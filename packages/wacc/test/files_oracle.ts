#!/usr/bin/env -S deno run --allow-read
// The TypeScript import walk, as an oracle for `src/files.wac`.
//
// **This file is the reference, not the test.** `harness/wacFiles.ts` has walked the import graph for
// every build this repository has ever done, which makes it a legitimate oracle here — it is not the
// compiler under test. The wac copy exists so that a wac program can be the compiler's command line
// without TypeScript in the path (`design/lang/0003` step 4), and the two have to agree about what a
// program is *made of* or they will compile different programs from the same entry.
//
// **Paths cross, not sources.** The corpus is every `.wac` file in the tree, and shipping their text
// would be megabytes through a pipe to answer a question about a few specifiers per file. This reads
// each file itself, which is safe precisely because the file is the input rather than the answer: it
// cannot agree with a mistake it did not make.
//
// The usual direction: the test walks and this reports what it disagrees with.
//
//   imports <path> <ours>      `ours` is the specifiers joined with `|`, empty for none
//
// `FAIL …` per disagreement, `DONE <n>` last. See `packages/wactest/src/oracle.wac`.

import { importPaths } from "../../../harness/wacFiles.ts";

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

const lines = new TextDecoder().decode(readAll()).split("\n").filter((l) => l.length > 0);
const out: string[] = [];
const say = (s: string) => {
  if (out.length < 20) out.push(`FAIL ${s}`);
};

for (const line of lines) {
  const sp = line.indexOf(" ");
  const op = sp < 0 ? line : line.slice(0, sp);
  const rest = sp < 0 ? "" : line.slice(sp + 1);
  try {
    if (op === "imports") {
      // The path may not contain a space — no file in this tree does — and the answer may, so the
      // split is on the first space only.
      const gap = rest.indexOf(" ");
      const path = gap < 0 ? rest : rest.slice(0, gap);
      const ours = gap < 0 ? "" : rest.slice(gap + 1);
      const want = importPaths(Deno.readTextFileSync(path)).join("|");
      if (ours !== want) {
        say(`${path}: wac says [${ours.split("|").filter((s) => s !== "").join(", ")}], ` +
          `TypeScript says [${want.split("|").filter((s) => s !== "").join(", ")}]`);
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
