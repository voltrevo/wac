// The artifact a host with no JavaScript in it can run: a `.wasm` and a manifest.
//
// design/0001 step 2a, wac-mono 0087. The other three targets in `build.ts` emit *JavaScript* — the
// wasm goes in base64 inside a bundle, and `wacBindgen` generates the wrappers that know the memory
// layout. None of that can cross to a runtime written in Rust, and none of it needs to: the wasm a wac
// program compiles to has **no imports of its own**, only `wac.cb0`…`wac.cbN`, and everything else the
// host does is calling exports.
//
// So this writes the two files that are the whole contract:
//
//   `<out>.wasm`   the module, unchanged — the same bytes the JavaScript hosts run
//   `<out>.json`   the manifest: what the callback imports are, how to register one, and the grants
//
// ## Why a manifest rather than a generated Rust file
//
// `wacBindgen` writes TypeScript because JavaScript has no way to read wasm metadata at build time
// without it. A native host has the opposite problem: generating Rust would mean a cargo build per
// program, and the whole point of step 2a is one runtime binary that loads *any* wac program. The
// manifest is data, read at startup.
//
// The consequence to keep in view: this file and the runtime are two sides of one format, and nothing
// but the conformance suite makes them agree. The format is versioned for that reason.

import { wacCompile } from "wac/wacCompile.ts";
import { wacFiles } from "../../harness/wacFiles.ts";

/** Bumped when a field changes meaning. A runtime refuses a manifest it does not know. */
export const MANIFEST_VERSION = 1;

/** What a host must be able to do for the program, matching `GRANT_*` in `platform.wac`. */
export type Grants = { read?: boolean; write?: boolean; env?: boolean; net?: boolean };

/**
 * One callback signature the module takes.
 *
 * A wac funcref reaches the guest as a slot number in a per-signature registry: the host supplies one
 * dispatcher import per signature, `helper(slot)` turns a slot into the funcref value to pass in, and
 * the dispatcher is called with the slot as its first argument. `slots` is how many distinct functions
 * of that signature can be live at once — the module's table is fixed at compile time, and a host that
 * registers a fresh function per call dies on the seventeenth a long way from the cause.
 */
export type CallbackSpec = {
  /** Import field under module `wac` — `cb0`, `cb1`. */
  field: string;
  /** Export that turns a slot number into a funcref. */
  helper: string;
  /** The wac type as written, e.g. `fn[Pending<i32>(string)]`. */
  type: string;
  /** wac parameter types, in order. The dispatcher's own leading slot argument is not listed. */
  params: string[];
  /** wac return type, or `void`. */
  ret: string;
  slots: number;
};

/**
 * A struct the boundary carries, with its fields **in construction order**.
 *
 * This is the part a native host would otherwise have to hardcode, and the reason it must not: the
 * order of `Core`'s seven funcrefs is `platform.wac`'s, and a host with its own copy of that order
 * keeps working — wrongly — the day a capability is inserted in the middle. `provider.ts` does hold
 * such a copy, in a `Core.of(...)` call bindgen generated for it; the native host reads this instead.
 */
export type StructSpec = {
  /** As written in wac: `Core`, `Pending<i32>`. */
  name: string;
  /** The mangled stem the `$bind$` exports use. */
  bind: string;
  fields: { name: string; type: string }[];
  methods: { name: string; isStatic: boolean; params: string[]; ret: string; export: string }[];
};

export type Manifest = {
  version: number;
  /** The entry file, for a diagnostic that names something a person recognises. */
  entry: string;
  wasm: string;
  grants: Grants;
  callbacks: CallbackSpec[];
  /** Exports a host needs by name rather than by search: the memory and the string helpers. */
  bind: Record<string, string>;
  structs: StructSpec[];
  /** `main`, and anything else callable, with its wac signature. */
  exports: { name: string; params: string[]; ret: string }[];
};

/**
 * Compile `entry` and write `<out>.wasm` and `<out>.json`.
 *
 * `out` is a stem rather than a filename, because two files come out of it and naming one of them
 * would leave the other implied.
 */
export async function buildNative(entry: string, out: string, grants: Grants = {}): Promise<Manifest> {
  const files = await wacFiles(entry);
  const r = wacCompile(files, entry, {});
  if (!r.ok) {
    throw new Error(
      `${entry} did not compile:\n` +
        r.diagnostics.map((d) => `  ${d.file}:${d.line}:${d.col} ${d.message}`).join("\n"),
    );
  }
  const c = r.compiled;

  // The `$bind$` exports a host needs to find without knowing the mangling. Every wac module has these
  // and only these: the memory, and the seven string helpers. Named here so a runtime does not carry a
  // second copy of the prefix convention.
  const bind: Record<string, string> = {};
  for (const e of c.exports ?? []) {
    if (e.name.startsWith("$bind$") && !e.name.startsWith("$bind$sm_") && !e.name.startsWith("$bind$m_")) {
      bind[e.name.slice("$bind$".length)] = e.name;
    }
  }
  // `$bind$mem` is a memory rather than a function, so it is not in `exports` — it is the one name a
  // host has to know, and knowing one is different from knowing a convention.
  bind["mem"] = "$bind$mem";

  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    entry,
    wasm: out.split("/").pop() + ".wasm",
    grants,
    callbacks: (c.callbacks ?? []).map((cb) => ({
      field: cb.field,
      helper: cb.helper,
      type: cb.type,
      params: cb.params,
      ret: cb.ret,
      slots: cb.slots,
    })),
    bind,
    // The `$bind$sm_` / `$bind$m_` split is the mangling for static and instance methods. It is
    // resolved here rather than in the runtime so that there is one copy of it, and it is the copy
    // that is compiled against the module it describes.
    structs: (c.structs ?? []).map((s) => ({
      name: s.display,
      bind: s.bind,
      fields: (s.fields ?? []).map((f: { name: string; type: string }) => ({
        name: f.name,
        type: f.type,
      })),
      methods: (s.methods ?? []).map((m: {
        name: string;
        isStatic: boolean;
        params?: { type: string }[];
        ret?: string;
      }) => ({
        name: m.name,
        isStatic: m.isStatic,
        params: (m.params ?? []).map((p) => p.type),
        ret: m.ret ?? "void",
        export: `$bind$${m.isStatic ? "sm" : "m"}_${s.bind}_${m.name}`,
      })),
    })),
    exports: (c.exports ?? []).filter((e) => !e.name.startsWith("$bind$")).map((e) => ({
      name: e.name,
      params: (e.params ?? []).map((p: { type: string }) => p.type),
      ret: e.ret ?? "void",
    })),
  };

  await Deno.writeFile(`${out}.wasm`, c.wasm as Uint8Array);
  await Deno.writeTextFile(`${out}.json`, JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

if (import.meta.main) {
  const args = Deno.args;
  const entry = args[0];
  const at = args.indexOf("-o");
  const out = at >= 0 && at + 1 < args.length ? args[at + 1] : null;
  if (entry === undefined || out === null) {
    console.error("usage: deno task app:native <entry.wac> -o <stem> [--allow-read] [--allow-write]");
    console.error("  writes <stem>.wasm and <stem>.json — the artifact a non-JavaScript host runs");
    Deno.exit(2);
  }
  const m = await buildNative(entry, out, {
    read: args.includes("--allow-read"),
    write: args.includes("--allow-write"),
    env: args.includes("--allow-env"),
    net: args.includes("--allow-net"),
  });
  const size = (await Deno.stat(`${out}.wasm`)).size;
  console.log(`${out}.wasm  ${(size / 1024).toFixed(0)}K  ${m.callbacks.length} callback signatures`);
}
