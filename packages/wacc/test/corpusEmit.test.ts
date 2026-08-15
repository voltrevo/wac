// Rung 4 against the repository: how much of the corpus can this emitter actually compile?
//
// The README named this oracle before there was anything to run it on — *compile the corpus with
// wacc and run it*. This is the first half: compile every `.wac` file in the tree and see what comes
// out. It is a **measurement**, not yet a gate, and the numbers are printed rather than asserted,
// because a rung under construction that may never lose a point is a rung nobody can restructure.
//
// What it does assert is that the harness is working — a corpus that loaded nothing, or an emitter
// that emitted nothing, would otherwise report a comfortable zero — and the one property that is
// meant to hold today: a file this emitter *declines* is declined by name, and the name is a language
// feature rather than a stack error thirty instructions later.
// test-lane: heavy — 1024 MB and 51s: every file in the repository through the emitter

import { loadCorpus } from "./corpus.ts";
import { wacBind } from "../../../harness/wacBind.ts";
import { wacLex } from "wac/wacLex.ts";
import { wacParse } from "wac/wacParse.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const emitFiles = mod.emitFiles as (p: string[], s: string[], e: string) => Uint8Array;
const blockedFiles = mod.blockedFiles as (p: string[], s: string[], e: string) => string;

Deno.test("rung 4: the repository corpus, compiled", async () => {
  const entries = await loadCorpus("packages/wacc/test/corpusEmit.test.ts");
  if (entries.length < 100) throw new Error(`only ${entries.length} corpus files loaded`);

  // **Every file is compiled as an entry, with the whole corpus available to import from.** Passing
  // more files than the entry needs costs nothing — what is emitted is the closure of its imports —
  // and it is the only honest way to ask the question, since resolving the closure here would be
  // this test grading its own homework.
  const paths = entries.map(([name]) => name);
  const sources = entries.map(([, src]) => src);

  let whole = 0;
  let partial = 0;
  let invalid = 0;
  // **"Whole" used to mean "the emitter did not say it was blocked", which is not the same thing.**
  // `packages/json/src/json.wac` reports nothing blocked and is missing three of its four exported
  // functions, so the count was measuring the emitter's opinion of itself. This asks the *source*:
  // every `export` it declares has to be a function in the module.
  //
  // Read by parsing rather than by compiling with the reference. The first version did the latter and
  // put four minutes on this test — ten on the suite — for a question the declaration already
  // answers. Generic functions are excluded because they are templates: nothing is emitted for one
  // until it is instantiated, and the reference does not export them either.
  let short = 0;
  const declaredExports = (src: string, file: string): string[] => {
    const { program } = wacParse(wacLex(src).tokens, file);
    const out: string[] = [];
    for (const item of program.items) {
      if (item.tag !== "func" || !item.exported) continue;
      if ((item.typeParams ?? []).length > 0) continue;
      out.push(item.name);
    }
    return out;
  };
  const reasons = new Map<string, number>();
  for (const [name] of entries) {
    const bytes = Uint8Array.from(emitFiles(paths, sources, name) as unknown as number[]);
    if (!WebAssembly.validate(bytes)) {
      invalid++;
      continue;
    }
    const why = blockedFiles(paths, sources, name);
    if (why !== "") {
      partial++;
      reasons.set(why, (reasons.get(why) ?? 0) + 1);
      continue;
    }
    whole++;
    const want = declaredExports(sources[paths.indexOf(name)], name);
    if (want.length === 0) continue;
    const got = new Set(
      WebAssembly.Module.exports(await WebAssembly.compile(bytes as BufferSource))
        .filter(e => e.kind === "function").map(e => e.name),
    );
    if (want.some(n => !got.has(n))) short++;
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, n]) => `${n}× ${k}`).join(", ");
  console.log(`    rung 4 corpus: ${entries.length} files — ${whole} whole, ${partial} partial, ` +
    `${invalid} invalid. Blocked by: ${top}`);
  console.log(`    of the ${whole} whole, ${short} are missing an export the source declares ` +
    `— issues/lang/0090`);
  // **Asserted, not just counted.** This was 29 when `issues/lang/0090` was filed and printing it
  // was the right first move: a number nobody could act on yet. It has been 0 since the emitter
  // stopped dropping functions, and a module called *whole* that is missing what its source
  // exports is exactly the failure the word denies — so it fails the suite now rather than
  // scrolling past in a log.
  if (short > 0) {
    throw new Error(`${short} module(s) called whole are missing an export the source declares ` +
      `— issues/lang/0090`);
  }

  // The canary: a harness that compiled nothing would report that nothing is wrong.
  if (whole === 0) throw new Error("no corpus file was emitted in full — the harness is not reaching the emitter");
  if (partial === 0) throw new Error("every file emitted whole, which cannot be true yet");
  if (reasons.size === 0) throw new Error("nothing was declined by name — the emittability walk is not running");

  // **The invariant, asserted.** A function the walk approves must produce a module that validates.
  // Anything else means the walk lied: it said yes to something the emitter then got wrong, and the
  // wasm error arrives dozens of instructions from the cause. This was 43 when the walk was written
  // and is 0 now, so it can stop being a number and start being a rule.
  if (invalid !== 0) {
    throw new Error(`${invalid} corpus file(s) produced an invalid module — the emittability walk ` +
      `approved something the emitter cannot actually do`);
  }
});
