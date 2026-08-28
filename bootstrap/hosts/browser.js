// The browser host: `fetch`, and nothing else.
//
// There is no filesystem, no `Deno.*` and no `node:*` in here — which is the whole reason the
// portable core takes source *strings* and takes the host as two methods. A page supplies the rung
// sources however it likes: fetched from wherever it was served, or handed over as strings it
// already had.
//
// **`canonical` is not supplied**, and that is the point of its being optional. A browser has no
// notion of a real path, so two specifiers reaching one file are visited twice rather than once.
// For a module graph that costs a little work and changes no answer, because `gather` emits in
// dependency order either way and a duplicate declaration would be a collision the flattener
// already reports.

import { ladder } from "../js/ladder.js";
import { flatten } from "../js/flatten.js";
import { assemble } from "../js/assemble.js";

/**
 * A filesystem made of URLs, for `flatten`.
 *
 * @param {string | URL} base where `boot/` and the program live
 * @returns {{ read: (p: string) => Promise<string> }}
 */
export function filesOver(base) {
  return {
    /** @param {string} p @returns {Promise<string>} */
    async read(p) {
      const at = new URL(p, base);
      const res = await fetch(at);
      // A 404 has to throw, because `resolve` walks up a directory tree by trying and failing.
      if (!res.ok) throw new Error(`${res.status} ${at}`);
      return await res.text();
    },
  };
}

/**
 * The ladder, with the five rung sources fetched.
 *
 * @param {string | URL} base
 * @returns {Promise<ReturnType<typeof ladder>>}
 */
export async function boot(base) {
  const files = filesOver(base);
  const read = (n) => files.read(`boot/${n}`);
  return ladder({
    l1: await read("l1.l0"),
    l2: await read("l2.l1"),
    l3: await read("l3.l2"),
    l4: await read("l4.l3"),
    l5: await read("l5.l4"),
  });
}

/**
 * Compile a wac program and run one of its exports — the whole ladder, in a page.
 *
 * @param {string | URL} base
 * @param {string} program a wac program, already whole; use `flattenOver` for a graph
 * @param {string} [entry]
 * @returns {Promise<{ l0: string, wasm: Uint8Array, answer: number }>}
 */
export async function compileAndRun(base, program, entry = "main") {
  const l = await boot(base);
  const l0 = await l.l5ToL0(program);
  const bad = l0.split("\n").filter((x) => x.startsWith("!!"));
  if (bad.length > 0) throw new Error(`wac-L5 refused ${bad.length} things: ${bad[0]}`);
  const wasm = assemble(l0);
  const inst = await WebAssembly.instantiate(
    await WebAssembly.compile(/** @type {ArrayBuffer} */ (wasm.buffer)),
    {},
  );
  return { l0, wasm, answer: /** @type {() => number} */ (inst.exports[entry])() };
}

/**
 * A module graph, flattened over HTTP.
 *
 * @param {string | URL} base
 * @param {string} entry a path relative to `base`
 * @returns {Promise<string>}
 */
export const flattenOver = (base, entry) => flatten(entry, filesOver(base));
