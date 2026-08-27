// **The whole ladder, end to end, against the real compiler.**
//
// Every other test here checks one rung against what that rung is supposed to do. This one asks
// the only question the experiment was set up to answer: can the last rung compile wacc, and does
// the wacc it builds work?
//
// So: wac-L0's assembler builds wac-L1's interpreter, which runs wac-L2's compiler, which builds
// wac-L3's, which builds wac-L4's, which builds wac-L5's — and wac-L5 compiles 37,874 lines of
// real wac into a wasm module. That module is wacc. It is then handed a wac program, and the
// module *it* emits is run. If the answer is 42 then every rung did its job, because a mistake
// anywhere in the chain does not produce a working compiler by accident.
//
// It needs the wac repo beside this one, which is the layout the operator's workspaces use. When
// it is not there the test says so and skips rather than failing: a test that fails because a
// sibling directory is missing teaches nobody anything.

import { flatten, l5ToL0 } from "./l5.ts";
import { assemble } from "./assemble.ts";

const HERE = new URL(".", import.meta.url).pathname;
const API = `${HERE}../../wac/packages/wacc/src/api.wac`;

async function corpusIsHere(): Promise<boolean> {
  try {
    await Deno.stat(API);
    return true;
  } catch {
    return false;
  }
}

Deno.test({
  name: "the ladder compiles wacc, and the wacc it builds compiles wac",
  ignore: !(await corpusIsHere()),
  fn: async () => {
    const driver = await Deno.readTextFile(`${HERE}../drivers/emit_and_run.wac`);
    const l0 = await l5ToL0(await flatten(API) + "\n" + driver);
    const refusals = (l0.match(/^!!/gm) ?? []).length;
    if (refusals !== 0) throw new Error(`wac-L5 refused ${refusals} things in wacc`);

    const mod = await WebAssembly.compile(assemble(l0).buffer as ArrayBuffer);
    const inst = await WebAssembly.instantiate(mod, {});
    const build = inst.exports.build as () => number;
    const byteAt = inst.exports.byteAt as (i: number) => number;

    // wacc, compiled by wac-L5, compiling a wac program.
    const n = build();
    if (n <= 0) throw new Error("wacc emitted nothing");
    const inner = new Uint8Array(n);
    for (let i = 0; i < n; i++) inner[i] = byteAt(i);

    // And the module it emitted, run.
    const m2 = await WebAssembly.compile(inner.buffer as ArrayBuffer);
    const i2 = await WebAssembly.instantiate(m2, {});
    const answer = i2.exports.answer as () => number;
    const got = answer();
    if (got !== 42) throw new Error(`got ${got}, want 42`);
  },
});
