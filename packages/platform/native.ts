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
  /**
   * An enum's variants, with the export that builds each one.
   *
   * **Absent until 2026-08-12, and both hosts paid for it.** `Read` is `enum Read { Data(u8[]),
   * End, Failed(string) }` — what every `readChunk` answers with — and a host that has to build one
   * had nothing here to read, so `native/src/main.rs` and `native/v8/src/main.rs` each spelled
   * `$bind$e_Read_Data_new` themselves. That is exactly what this file's `StructSpec` comment says
   * must not happen, for exactly the reason it gives: three copies of one convention, two of which
   * keep working wrongly the day it changes. `issues/system/0141`.
   *
   * Empty for a struct, which is how a reader tells the two apart without a `kind` field.
   */
  variants: { name: string; fields: { name: string; type: string }[]; make: string }[];
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
  // **wacc, unless asked otherwise**, the same rule and the same switch as `build.ts`: both jobs are
  // "build an application", and a manifest describing a module the reference compiled cannot
  // describe one that uses a feature only wacc has. `issues/lang/0105` — this was the last bundler
  // on the reference, and the binary embedding the pair is why it mattered.
  if (Deno.env.get("WAC_APP_FROM") !== "reference") {
    return await buildNativeWithWacc(entry, out, grants, files);
  }
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
    // **Enums beside structs, not instead of them.** The reference reports the two separately and
    // this list carried only the first, so a reference-built manifest described no `Read` at all —
    // and every host that needed one spelled `$bind$e_Read_Data_new` for itself. `issues/system/0141`.
    structs: [
      ...(c.structs ?? []).map((s) => ({
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
        variants: [],
      })),
      ...(c.enums ?? []).map((e) => ({
        name: e.display,
        bind: e.bind,
        fields: [],
        methods: (e.methods ?? []).map((m: {
          name: string;
          isStatic: boolean;
          params?: { type: string }[];
          ret?: string;
        }) => ({
          name: m.name,
          isStatic: m.isStatic,
          params: (m.params ?? []).map((p) => p.type),
          ret: m.ret ?? "void",
          export: `$bind$${m.isStatic ? "sm" : "m"}_${e.bind}_${m.name}`,
        })),
        variants: (e.variants ?? []).map((v: {
          name: string;
          fields?: { name: string; type: string }[];
        }) => ({
          name: v.name,
          fields: (v.fields ?? []).map((f) => ({ name: f.name, type: f.type })),
          make: `$bind$e_${e.bind}_${v.name}_new`,
        })),
      })),
    ],
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

/**
 * The same manifest, from wacc's own description of the module it just emitted.
 *
 * Every field here has a counterpart in the metadata wire: the `C` lines are the callbacks in
 * `wac.cb<j>` order, `S` and `M` are the structs with their fields in construction order, and
 * `exportSigsFiles` is what a host may call. The one thing the wire does not carry is which
 * `$bind$` names the module ended up exporting, and the module itself is the authority on that —
 * asking it beats keeping a second copy of the convention.
 */
async function buildNativeWithWacc(
  entry: string,
  out: string,
  grants: Grants,
  files: Map<string, string>,
): Promise<Manifest> {
  const { waccApi, waccArtifacts } = await import("../../harness/waccBuild.ts");
  const { parseAliases, parseBindTypes, parseCallbacks, parseSigs } = await import(
    "../wacc/tools/waccBindgen.ts"
  );
  const art = await waccArtifacts(files, entry);
  const api = await waccApi();
  const paths = [...files.keys()];
  const sources = paths.map((p) => files.get(p)!);
  const wire = api.bindTypesFiles(paths, sources, entry);
  const types = parseBindTypes(wire);
  const cbs = parseCallbacks(wire);
  const sigs = parseSigs(api.exportSigsFiles(paths, sources, entry));

  const bind: Record<string, string> = {};
  const module = new WebAssembly.Module(art.wasm.slice().buffer as ArrayBuffer);
  for (const e of WebAssembly.Module.exports(module)) {
    if (
      e.name.startsWith("$bind$") && !e.name.startsWith("$bind$sm_") &&
      !e.name.startsWith("$bind$m_")
    ) {
      bind[e.name.slice("$bind$".length)] = e.name;
    }
  }
  bind["mem"] = "$bind$mem";

  // **A type the emitter collapsed still has both names at the boundary.** `Pending<u8[]?>` and
  // `Pending<u8[]>` are one wasm type — a nullable reference and a reference are the same slot — so
  // the emitter registers one instantiation and records the other spelling as an alias. The *host*
  // does not know that: `native/src/main.rs` asks for `Pending<u8[]?>` by name. Each alias becomes a
  // second entry pointing at the same bind stem, which is true rather than a workaround: they are
  // the same type, reachable by two names [issue 0106].
  const structs = types.map((t) => ({
    name: t.name,
    bind: t.bind,
    fields: t.fields.map((f) => ({ name: f.name, type: f.type })),
    methods: t.methods.map((m) => ({
      name: m.name,
      isStatic: !m.hasThis,
      params: m.params,
      ret: m.ret === "" ? "void" : m.ret,
      export: `$bind$${m.hasThis ? "m" : "sm"}_${t.bind}_${m.name}`,
    })),
    // The mangling is resolved here, once, against the module this manifest describes — the same
    // reason the method exports above are resolved here rather than in each runtime.
    variants: t.variants.map((v) => ({
      name: v.name,
      fields: v.payload.map((f) => ({ name: f.name, type: f.type })),
      make: `$bind$e_${t.bind}_${v.name}_new`,
    })),
  }));
  for (const a of parseAliases(wire)) {
    if (structs.some((s) => s.name === a.name)) continue;
    const of = structs.find((s) => s.name === a.of);
    if (of !== undefined) structs.push({ ...of, name: a.name });
  }

  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    entry,
    wasm: out.split("/").pop() + ".wasm",
    grants,
    callbacks: cbs.map((cb) => ({
      field: `cb${cb.index}`,
      helper: `$bind$fnref_${cb.index}`,
      type: cb.wac,
      params: cb.params,
      ret: cb.ret === "" ? "void" : cb.ret,
      // Both compilers emit this many trampolines per signature — `callbackSlots()` in `emit.wac`,
      // `CALLBACK_SLOTS` in the reference — and a host that registers more dies on the seventeenth.
      slots: 16,
    })),
    bind,
    structs,
    exports: sigs.filter((e) => !e.name.startsWith("$bind$")).map((e) => ({
      name: e.name,
      params: e.params,
      ret: e.ret === "" ? "void" : e.ret,
    })),
  };

  await Deno.writeFile(`${out}.wasm`, art.wasm);
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
