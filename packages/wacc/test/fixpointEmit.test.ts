// Rung 5, the half that makes it a bootstrap: does `wacc`-compiled-by-`wacc` *emit* what
// `wacc`-compiled-by-`wac` emits?
//
// `test/wac/bootstrapemit_test.wac` shows the emitted compiler can read — it lexes, parses, prints and checks
// the same as the reference-built one. Reading is half a compiler. This asks the other half, and the
// answer is a number rather than a shrug: both stages compile the same source and the bytes they
// produce are checksummed. Equal checksums mean the two stages agree byte for byte.
//
// The subject is `wacc`'s **own source**, which is the point — a toy program exercises a toy's worth
// of the emitter. The file is embedded in a generated driver as chunked string literals, because a
// literal is one `array.new_fixed` and an engine caps how many elements that may have, while
// concatenation has no such limit. Nothing is written to disk: both compilers take a file map.
//
// It earned its place immediately. Stage B could not type *any* call, because `typeOfE` in
// `emit.wac` writes its `else` arm first and this emitter used to emit an arm's body where the arm
// stood — so the default ran unconditionally and no `case` was ever reached.

import { wacCompile } from "wac/wacCompile.ts";
import { importClosure, loadCorpus } from "./corpus.ts";
import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const emitFiles = mod.emitFiles as (p: string[], s: string[], e: string) => Uint8Array;

/**
 * Two sources put through both stages. They were once the only two this emitter compiled whole; it
 * compiles almost the whole repository now, and they stay because two files are enough to make this
 * test's point cheaply — `selfHostEmit.test.ts` is the one that puts the entire compiler through.
 */
const TARGETS = ["packages/wacc/src/kinds.wac", "packages/wacc/src/ast.wac"];
const DRIVER = "packages/wacc/test/wac/fixpoint_generated.wac";

/** A wac string literal for a chunk of text, escaping the four escapes this emitter knows. */
function literal(text: string): string {
  return '"' +
    text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t") +
    '"';
}

function driverFor(text: string): string {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 3000) chunks.push(literal(text.slice(i, i + 3000)));
  return `import { emit, blocked } from "../../src/api.wac";

string target() { return ${chunks.join(" +\n    ")}; }

i32 sumBytes(u8[] b) {
  i32 h = 7;
  for (i32 i = 0; i < b.len(); i++) { h = (h * 31 + b[i]) & 2147483647; }
  return h;
}

export i32 targetLen() { return target().len(); }
export i32 emitLen() { return emit(target().toBytes()).len(); }
export i32 emitSum() { return sumBytes(emit(target().toBytes())); }
export i32 blockedLen() { return blocked(target().toBytes()).len(); }
`;
}

Deno.test("rung 5: the fixed point — both stages emit the same bytes", async () => {
  const entries = await loadCorpus("packages/wacc/test/fixpointEmit.test.ts");
  const paths = entries.map(([name]) => name);
  const sources = entries.map(([, src]) => src);

  const differ: string[] = [];
  const report: string[] = [];
  for (const target of TARGETS) {
    const at = paths.indexOf(target);
    if (at < 0) throw new Error(`${target} is not in the corpus`);

    // **The target's closure, not the corpus** — `wacCompile` parses every file in the map, so the
    // repository's files all became the reference's problem and the first wacc-only syntax anywhere
    // failed this with a complaint about a file the driver never imports. `issues/lang/0140`.
    // The *driver's* closure, which is wacc's entry — the target is embedded as a string literal and
    // is not imported. Using the target's own closure left `api.wac` out of the map and the reference
    // answered "file not found in programs map", which is the same mistake in the other direction.
    const near = importClosure(paths, sources, "packages/wacc/src/api.wac");
    const allPaths = [...near.paths, DRIVER];
    const allSources = [...near.sources, driverFor(sources[at])];
    const files = new Map(allPaths.map((p, i) => ["/" + p, allSources[i]]));

    const r = wacCompile(files, "/" + DRIVER);
    if (!r.ok) {
      throw new Error(`the reference refuses the generated driver for ${target}: ` +
        JSON.stringify(r.diagnostics.slice(0, 2)));
    }
    const A = new WebAssembly.Instance(
      new WebAssembly.Module(Uint8Array.from(r.compiled.wasm)),
      {},
    );
    const B = new WebAssembly.Instance(
      new WebAssembly.Module(
        Uint8Array.from(emitFiles(allPaths, allSources, DRIVER) as unknown as number[]),
      ),
      {},
    );

    const ask = (i: WebAssembly.Instance, name: string) => {
      try {
        return String((i.exports[name] as () => number)());
      } catch (e) {
        return `threw: ${(e as Error).message.slice(0, 50)}`;
      }
    };
    for (const q of ["targetLen", "blockedLen", "emitLen", "emitSum"]) {
      const a = ask(A, q);
      const b = ask(B, q);
      if (a !== b) differ.push(`${target} ${q}: stage A=${a}, stage B=${b}`);
    }
    // The canary, per target. A stage that declined the whole file would emit an empty module and
    // agree with the other one about nothing in particular.
    const len = Number(ask(A, "emitLen"));
    if (Number(ask(A, "blockedLen")) !== 0) {
      throw new Error(`${target} is no longer emitted whole, so this compares two partial modules`);
    }
    if (len < 200) throw new Error(`${target} emitted only ${len} bytes — nothing was compiled`);
    report.push(`${target.replace("packages/wacc/src/", "")} ${sources[at].length}B → ${len}B`);
  }
  console.log(`    rung 5 fixed point: ${report.join(", ")}`);

  if (differ.length !== 0) {
    throw new Error(`the two stages emit different bytes:\n  ` + differ.join("\n  "));
  }
});
