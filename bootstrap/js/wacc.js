// Driving the wacc the ladder built.
//
// **Not through `$bind$`.** Every module wacc builds exports a binding layer, and the natural move
// is to use it — but the wacc wac-L5 builds has none, because wac-L5 does not emit bindgen. The
// first compiler in the chain is the one host that has to be driven without help.
//
// So it is driven the way `bootstrap/rust-ladder/src/wacc.rs` drives it: a small wac driver is
// concatenated onto wacc's flattened source before wac-L5 sees it, and every value crosses the
// boundary as an i32, a byte at a time. That is the whole of what a wasm module can hand a host
// with no binding layer — a GC reference cannot be built by a host and cannot cross out as
// anything a host could rebuild.
//
// Portable: no filesystem, no host API. The caller supplies the bytes and the file set.

/** @typedef {Record<string, (...args: number[]) => number>} Exports */

/**
 * Grant bits, which are `manifestOf`'s own encoding in `packages/wacc/src/manifest.wac`. Written
 * here as the names they have on a command line so that a host does not have to know the numbers.
 */
export const GRANTS = { read: 1, write: 2, net: 4, env: 8, run: 16 };

/**
 * The bitfield for a list of `--allow-…` flags, ignoring anything else on the line.
 *
 * @param {string[]} args
 * @returns {number}
 */
export function grantsOf(args) {
  let bits = 0;
  for (const [name, bit] of Object.entries(GRANTS)) {
    if (args.includes(`--allow-${name}`)) bits |= bit;
  }
  return bits;
}

/**
 * A wacc module built by wac-L5, with `bootstrap/drivers/spec_cases.wac` concatenated on.
 *
 * @param {WebAssembly.Instance} instance
 */
export function wacc(instance) {
  const e = /** @type {Exports} */ (/** @type {unknown} */ (instance.exports));

  /** Hand a string across, a byte at a time, through one of the driver's buffer pairs. */
  const feed = (alloc, put, text) => {
    const b = new TextEncoder().encode(text);
    e[alloc](b.length);
    for (let i = 0; i < b.length; i++) e[put](i, b[i]);
  };

  /** Take a byte-addressed answer back. */
  const take = (n, at) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = e[at](i);
    return out;
  };

  return {
    /**
     * Compile a whole program. `keys` are what the modules call each other by — see `fileSet`.
     *
     * @param {string[]} keys
     * @param {string[]} texts
     * @param {string} entry
     * @returns {Uint8Array}
     */
    emitFiles(keys, texts, entry) {
      e.drv_files(keys.length);
      for (let i = 0; i < keys.length; i++) {
        feed("drv_alloc", "drv_setByte", texts[i]);
        feed("drv_allocName", "drv_setNameByte", keys[i]);
        e.drv_pushFile();
      }
      feed("drv_allocName", "drv_setNameByte", entry);
      return take(e.drv_buildFiles(), "drv_byteAt");
    },

    /**
     * Append the `wac.manifest` section to what `emitFiles` just built.
     *
     * **wacc writes it, not us.** The format is `manifestOf`'s, and asking the compiler that owns
     * it is what keeps there from being a second implementation to drift — see the comment on
     * `drv_seal` in the driver.
     *
     * @param {string} entry    the entry as the command line wrote it, which is what it records
     * @param {string} wasmName the name the manifest records for the module, from `-o`
     * @param {number} grants
     * @returns {Uint8Array}
     */
    seal(entry, wasmName, grants) {
      feed("drv_allocEntryName", "drv_setEntryNameByte", entry);
      feed("drv_allocWasmName", "drv_setWasmNameByte", wasmName);
      return take(e.drv_seal(grants), "drv_byteAt");
    },

    /** Why a linked build declined, or `""`. */
    decline() {
      return new TextDecoder().decode(take(e.drv_declineFiles(), "drv_declineByte"));
    },
  };
}

/**
 * Build a program with a wacc the ladder has just built, and seal it with its manifest.
 *
 * The whole of `--with-wacc`, so the Deno and Node hosts stay twins rather than two copies of the
 * same twelve lines. Everything it needs is passed in: it opens no file and knows no host.
 *
 * @param {object} o
 * @param {(source: string) => Promise<string>} o.l5ToL0    wac-L5, as the ladder exposes it
 * @param {(l0: string) => Uint8Array} o.assemble
 * @param {string} o.waccSource   wacc's graph, flattened, with the driver concatenated on
 * @param {{ keys: string[], texts: string[], entry: string }} o.target   the program to compile
 * @param {string} o.entryAsWritten the entry as the command line wrote it
 * @param {string} o.wasmName     the name the manifest records — the output's, not the entry's
 * @param {number} o.grants
 * @returns {Promise<Uint8Array>}
 */
export async function buildWithWacc(o) {
  const l0 = await o.l5ToL0(o.waccSource);
  const refusals = (l0.match(/^!!/gm) ?? []).length;
  if (refusals > 0) throw new Error(`wac-L5 refused ${refusals} thing(s) in wacc's own source`);

  const instance = await WebAssembly.instantiate(
    await WebAssembly.compile(/** @type {ArrayBuffer} */ (o.assemble(l0).buffer)),
    {},
  );
  const w = wacc(instance);

  const module = w.emitFiles(o.target.keys, o.target.texts, o.target.entry);
  if (module.length === 0) {
    const why = w.decline();
    throw new Error(why === "" ? "wacc emitted nothing, and said nothing about why" : why);
  }
  return w.seal(o.entryAsWritten, o.wasmName, o.grants);
}
