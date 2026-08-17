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
// file asked for are in scope.
//
// **Any report on a file in this corpus is a false alarm, and the reference only says which kind.**
// That is a widening: the invariant used to be "the reference compiles this cleanly, so we say nothing
// about it", and a file the reference *refuses* was excused. Which is every `only: wacc` file — the
// reference has no lambdas, so it refuses `packages/platform` and everything built on it for reasons
// that have nothing to do with the diagnostic under test. This corpus is the **emitter's**, so wacc
// compiles all of it by construction; a type error on one of these files is wrong whatever the
// reference thinks of the file.
//
// It cost a real defect to notice. A new argument-type rule reported on 36 of these files, this test
// passed — 36 reported, 0 adjudicated — and the way it surfaced instead was `deno task seed` failing
// to build, because one of the 36 was `packages/fs/src/proc.wac`, which is in the seed app's graph.
// The oracle was blind in exactly the region where the newest language features live.

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

  // **Ours first, theirs only to classify.** Asking the reference about all 341 files costs four
  // and a half minutes — each compile re-reads the whole map — and in the green case its answer is
  // needed for none of them: a file this checker says nothing about cannot be a false alarm whatever
  // the reference thinks. So the expensive question is asked only where the cheap one found
  // something, which is zero times when the suite is passing.
  const shared: string[] = [];   // the reference compiles it cleanly, so both compilers disagree
  const ours: string[] = [];     // the reference refuses it too, for a feature it does not have
  for (const [name, src] of entries) {
    const clos = closureOf(`/${name}`, map);
    const out = dumpTypeErrorsFiles([...clos.keys()], [...clos.values()], `/${name}`);
    if (out.length === 0) continue;
    const line = src.split("\n")[out[1] - 1] ?? "";
    const at = `${name}:${out[1]}:${out[2]} code ${out[0]} — ${line.trim().slice(0, 90)}`;
    if (wacCompile(map, `/${name}`).ok) shared.push(at);
    else ours.push(at);
  }
  console.log(`    rung 3 on the repository: ${entries.length} files, ` +
    `${shared.length + ours.length} this checker reports on ` +
    `(${shared.length} the reference compiles cleanly, ${ours.length} only wacc can compile at all)`);
  if (shared.length + ours.length > 0) {
    // The `only wacc` half is named separately because its diagnostic is the more likely to be
    // *about* a wacc-only feature, and because it is the half this test used to let through.
    throw new Error(
      `the checker reported ${shared.length + ours.length} working file(s):\n  ` +
        [...shared, ...ours.map((o) => `${o}  [only wacc compiles this file]`)]
          .slice(0, 8).join("\n  "),
    );
  }
});
