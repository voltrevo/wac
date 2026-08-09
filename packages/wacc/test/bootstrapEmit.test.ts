// Rung 5: `wacc`, compiled by `wacc`, answering what `wacc` answers.
//
// The ladder's last rung, and its oracle is the one every rung below uses — **run what both
// compilers emit and compare the answers**. The awkward part is the surface: `dump(u8[]) -> string`
// traffics in references, and a reference cannot cross the JavaScript boundary without bindgen's
// glue, which a module emitted here by hand does not have.
//
// So the crossing moves inside. `test/wac/selfdrive.wac` calls `wacc` on a program written into it
// and returns an `i32`, which crosses anywhere. Compiled by the reference it reports one number;
// compiled by `wacc` it must report the same one — and that second module is `wacc`'s own lexer,
// parser, printer and checker as emitted by `wacc`.
//
// It found two things in its first minutes that 336 corpus files and 3,600 generated programs had
// not: `this.pos++` on a field emitted nothing, so the lexer never advanced, and every **character
// literal** compiled to 0, so `isSpace(c)` asked whether the byte was NUL.

import { wacCompile } from "wac/wacCompile.ts";
import { loadCorpus } from "./corpus.ts";
import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const emitFiles = mod.emitFiles as (p: string[], s: string[], e: string) => Uint8Array;
const blockedFiles = mod.blockedFiles as (p: string[], s: string[], e: string) => string;

const ENTRY = "packages/wacc/test/wac/selfdrive.wac";

Deno.test("rung 5: wacc compiled by wacc answers what wacc answers", async () => {
  const entries = await loadCorpus("packages/wacc/test/bootstrapEmit.test.ts");
  const paths = entries.map(([name]) => name);
  const sources = entries.map(([, src]) => src);
  if (!paths.includes(ENTRY)) throw new Error(`${ENTRY} is not in the corpus`);

  const why = blockedFiles(paths, sources, ENTRY);
  if (why !== "") {
    throw new Error(`wacc declines the driver — and so declines part of itself: ${why}`);
  }

  const files = new Map(entries.map(([name, src]) => ["/" + name, src]));
  const r = wacCompile(files, "/" + ENTRY);
  if (!r.ok) throw new Error(`the reference refuses the driver: ${JSON.stringify(r.diagnostics.slice(0, 3))}`);

  const reference = new WebAssembly.Instance(
    new WebAssembly.Module(Uint8Array.from(r.compiled.wasm)),
    {},
  );
  const oursBytes = Uint8Array.from(emitFiles(paths, sources, ENTRY) as unknown as number[]);
  const ours = new WebAssembly.Instance(new WebAssembly.Module(oursBytes), {});

  // Every stage, smallest first, so a failure names how far it got rather than only that it failed.
  const asked = [
    "literalBytes",
    "subjectLen",
    "subjectBytes",
    "tokenCount",
    "declCount",
    "dumpSum",
    "errorCount",
    "badErrorCount",
  ];
  const differ: string[] = [];
  for (const name of asked) {
    const a = (reference.exports[name] as () => unknown)();
    let b: unknown;
    try {
      b = (ours.exports[name] as () => unknown)();
    } catch (e) {
      b = `threw: ${(e as Error).message.slice(0, 60)}`;
    }
    if (String(a) !== String(b)) differ.push(`${name}: reference=${a} ours=${b}`);
  }
  console.log(`    rung 5: ${asked.length} answers from wacc-compiled-by-wacc, ` +
    `${oursBytes.length} bytes against the reference's ${r.compiled.wasm.length}`);

  // The canary. `dumpSum` is a checksum over the whole printed AST, so it is the answer that cannot
  // be right by accident — and a zero from both sides would mean neither compiler ran anything.
  const sum = (reference.exports.dumpSum as () => number)();
  if (sum === 0) throw new Error("the reference's own dump checksum is 0 — the driver ran nothing");
  if ((reference.exports.badErrorCount as () => number)() === 0) {
    throw new Error("the program that must be rejected was accepted — the driver proves nothing");
  }

  if (differ.length !== 0) {
    throw new Error(`wacc compiled by wacc disagrees with wacc:\n  ` + differ.join("\n  "));
  }
});
