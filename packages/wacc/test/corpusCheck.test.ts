// Rung 3's checker, pointed at the **repository's own code**: 338 files nobody wrote for a test.
//
// The other two rung-3 oracles feed it programs that exist to be fed to it — a generated cross
// product in `sweep.test.ts`, the emitter's corpus in `checkSweep.test.ts`. Both are synthetic, both
// are single-file, and both are written by the same hands that wrote the checker. This one is the
// packages: a Tor relay, an SSH server, a shell, a JSON parser, the compiler itself. Real code is a
// different distribution — longer functions, deeper types, every feature at once — and it is the
// input that took rung 4 from 31 whole files to 335.
//
// **Both sides now see the imports.** They did not at first: this checker was given the one file
// with nothing resolved, which is safe — seeing less can make it miss a diagnostic and cannot make
// it invent one — and which capped recall on real code at 85%, because every diagnostic it missed
// was in a file that imports something. It is given the file's import closure now, and the names the
// file asked for are in scope. The invariant is unchanged and is the only one this package treats as
// absolute: the reference compiles this cleanly, so we say nothing about it.

import { wacCompile } from "wac/wacCompile.ts";
import { wacBind } from "../../../harness/wacBind.ts";
import { loadCorpus } from "./corpus.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const dumpTypeErrors = mod.dumpTypeErrors as (src: Uint8Array) => Int32Array;
const dumpTypeErrorsFiles = mod.dumpTypeErrorsFiles as
  (paths: string[], sources: string[], entry: string) => Int32Array;
const enc = new TextEncoder();

/** A file and what it imports, transitively — the map a check of it needs. */
function closureOf(entry: string, all: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const at = queue.pop()!;
    if (out.has(at)) continue;
    const src = all.get(at);
    if (src === undefined) continue;
    out.set(at, src);
    const dir = at.slice(0, at.lastIndexOf("/"));
    for (const m of src.matchAll(/from\s+"([^"]+)"/g)) {
      const parts = (dir + "/" + m[1]).split("/");
      const norm: string[] = [];
      for (const part of parts) {
        if (part === "." || part === "") continue;
        if (part === "..") norm.pop();
        else norm.push(part);
      }
      queue.push("/" + norm.join("/"));
    }
  }
  return out;
}

Deno.test("rung 3: the repository's own code, checked — no false alarm", async () => {
  const entries = await loadCorpus("packages/wacc/test/corpusEmit.test.ts");
  if (entries.length < 300) throw new Error(`only ${entries.length} corpus files`);
  const map = new Map(entries.map(([name, src]) => [`/${name}`, src]));

  // The canary: something this checker certainly reports, through the same call.
  if (dumpTypeErrors(enc.encode(`export i32 f() { return "x"; }`)).length === 0) {
    throw new Error("the canary is no longer reported — this sweep is blind");
  }

  // **Ours first, theirs only to adjudicate.** Asking the reference about all 341 files costs four
  // and a half minutes — each compile re-reads the whole map — and in the green case its answer is
  // needed for none of them: a file this checker says nothing about cannot be a false alarm whatever
  // the reference thinks. So the expensive question is asked only where the cheap one found
  // something, which is zero times when the suite is passing and once when it is not.
  const alarms: string[] = [];
  let reported = 0;
  for (const [name, src] of entries) {
    const clos = closureOf(`/${name}`, map);
    const out = dumpTypeErrorsFiles([...clos.keys()], [...clos.values()], `/${name}`);
    if (out.length === 0) continue;
    reported++;
    if (!wacCompile(map, `/${name}`).ok) continue;   // the reference refuses it too — not an alarm
    const line = src.split("\n")[out[1] - 1] ?? "";
    alarms.push(`${name}:${out[1]}:${out[2]} code ${out[0]} — ${line.trim().slice(0, 90)}`);
  }
  console.log(`    rung 3 on the repository: ${entries.length} files, ` +
    `${reported} this checker reports on, ${alarms.length} of them the reference compiles cleanly`);
  if (alarms.length > 0) {
    throw new Error(`the checker reported ${alarms.length} working file(s):\n  ` +
      alarms.slice(0, 8).join("\n  "));
  }
});
