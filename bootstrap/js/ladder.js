// The ladder, portable.
//
//   a wac program
//     -> the wac-L5 compiler, a wac-L4 program
//       -> the wac-L4 compiler, a wac-L3 program
//         -> the wac-L3 compiler, a wac-L2 program
//           -> the wac-L2 compiler, a wac-L1 program
//             -> wac-L1, hand-written wac-L0
//               -> the assembler, and whatever engine the host brought
//
// **Nothing in this file touches a file.** It is handed the five rung sources as strings and
// answers wac-L0 text or an answer; the host decides where the strings came from — a filesystem
// under Deno or Node, a fetch in a browser, or bytes compiled into a binary. That is the whole
// reason the browser costs almost nothing: the discipline it forces is the one already needed to
// have more than one host.
//
// A rung is expensive to build and cheap to run, so each is built once per `ladder()` and kept.

import { assemble } from "./assemble.js";

/** The five rung sources, as text. Keys are the files in `boot/`. */
/** @typedef {{ l1: string, l2: string, l3: string, l4: string, l5: string }} Rungs */

/**
 * Where a rung wants its source and leaves its output, **asked of the rung**.
 *
 * These used to be three constants here, and again in `bootstrap/rust-ladder/src/main.rs`. A host that has to
 * know an address it was never told is a host that can be wrong about it, and neither copy was
 * checked against anything. Each rung now answers for its own, so a new host reads them and there
 * is one statement of the fact rather than one per host.
 *
 * **Two shapes remain, which is a wart rather than a design.** wac-L1 is handed one address and
 * answers another, with the text running to a NUL; every rung above it is handed two and answers a
 * length. Unifying that means rewriting the seam of the one rung written by hand in wac-L0, and it
 * buys a smaller reduction than it costs — so it is written down instead.
 *
 * @param {WebAssembly.Instance} inst
 */
const seamOf = (inst) => ({
  src: /** @type {() => number} */ (inst.exports.seam_src)(),
  out: /** @type {() => number} */ (inst.exports.seam_out)(),
});

/**
 * @param {Rungs} rungs
 */
export function ladder(rungs) {
  /** @type {WebAssembly.Module | null} */
  let l1Mod = null;
  /** @type {WebAssembly.Module | null} */
  let l3Mod = null;
  /** @type {WebAssembly.Module | null} */
  let l4Mod = null;
  /** @type {WebAssembly.Module | null} */
  let l5Mod = null;

  /**
   * @param {string} l0
   * @returns {Promise<WebAssembly.Module>}
   */
  const compile = async (l0) =>
    await WebAssembly.compile(/** @type {ArrayBuffer} */ (assemble(l0).buffer));

  /**
   * Run a wac-L1 program under the hand-written interpreter, and read the text it answers.
   *
   * **The view is taken after the call, not before.** `$alloc` grows the memory, and growing
   * detaches the buffer a caller was holding — so a view taken earlier is empty by the time
   * there is anything to read through it.
   *
   * @param {string} source
   * @returns {Promise<string>}
   */
  async function l1Text(source) {
    if (l1Mod === null) l1Mod = await compile(rungs.l1);
    const inst = await WebAssembly.instantiate(l1Mod, {});
    const memory = /** @type {WebAssembly.Memory} */ (inst.exports.memory);
    const at = /** @type {() => number} */ (inst.exports.seam_at)();
    const bytes = new TextEncoder().encode(source);
    new Uint8Array(memory.buffer).set(bytes, at);
    new Uint8Array(memory.buffer)[at + bytes.length] = 0;

    const answer = /** @type {(at: number) => number} */ (inst.exports.run_at)(at);

    const out = new Uint8Array(memory.buffer);
    let end = answer;
    while (end < out.length && out[end] !== 0) end++;
    return new TextDecoder().decode(out.subarray(answer, end));
  }

  /**
   * Every rung above wac-L2 has the same seam: source at one address, `compile` answers a length,
   * and the rung says where both go.
   *
   * @param {WebAssembly.Module} mod
   * @param {string} program
   * @returns {Promise<string>}
   */
  async function through(mod, program) {
    const inst = await WebAssembly.instantiate(mod, {});
    const seam = seamOf(inst);
    const memory = /** @type {WebAssembly.Memory} */ (inst.exports.memory);
    const bytes = new TextEncoder().encode(program);
    const u8 = new Uint8Array(memory.buffer);
    u8.set(bytes, seam.src);
    u8[seam.src + bytes.length] = 0;
    const len = /** @type {(s: number, o: number) => number} */ (inst.exports.compile)(
      seam.src,
      seam.out,
    );
    return new TextDecoder().decode(new Uint8Array(memory.buffer, seam.out, len));
  }

  /**
   * wac-L2 has no seam of its own: it is a wac-L1 program, so the compiler and the program go to
   * the interpreter together in one s-expression.
   *
   * @param {string} program
   * @returns {Promise<string>}
   */
  const l2ToL0 = (program) => l1Text(`${rungs.l2}\n(compile (quote (${program})))\n`);

  /** @returns {Promise<WebAssembly.Module>} */
  async function l3Compiler() {
    if (l3Mod === null) l3Mod = await compile(await l2ToL0(rungs.l3));
    return l3Mod;
  }

  /** @returns {Promise<WebAssembly.Module>} */
  async function l4Compiler() {
    if (l4Mod === null) l4Mod = await compile(await l3ToL0(rungs.l4));
    return l4Mod;
  }

  /** @returns {Promise<WebAssembly.Module>} */
  async function l5Compiler() {
    if (l5Mod === null) l5Mod = await compile(await l4ToL0(rungs.l5));
    return l5Mod;
  }

  /**
   * @param {string} program
   * @returns {Promise<string>}
   */
  async function l3ToL0(program) {
    return await through(await l3Compiler(), program);
  }

  /**
   * @param {string} program
   * @returns {Promise<string>}
   */
  async function l4ToL0(program) {
    return await through(await l4Compiler(), program);
  }

  /**
   * @param {string} program
   * @returns {Promise<string>}
   */
  async function l5ToL0(program) {
    return await through(await l5Compiler(), program);
  }

  /**
   * wac-L0 text, assembled and run.
   *
   * @param {string} l0
   * @param {string} [entry]
   * @returns {Promise<number>}
   */
  async function run(l0, entry = "main") {
    const inst = await WebAssembly.instantiate(await compile(l0), {});
    return /** @type {() => number} */ (inst.exports[entry])();
  }

  return {
    l1Text,
    l2ToL0,
    l3ToL0,
    l4ToL0,
    l5ToL0,
    l3Compiler,
    l4Compiler,
    l5Compiler,
    run,
    /** @param {string} p @returns {Promise<number>} */
    l2Run: async (p) => await run(await l2ToL0(p)),
    /** @param {string} p @param {string} [e] @returns {Promise<number>} */
    l3Run: async (p, e = "main") => await run(await l3ToL0(p), e),
    /** @param {string} p @param {string} [e] @returns {Promise<number>} */
    l4Run: async (p, e = "main") => await run(await l4ToL0(p), e),
    /** @param {string} p @param {string} [e] @returns {Promise<number>} */
    l5Run: async (p, e = "main") => await run(await l5ToL0(p), e),
  };
}
