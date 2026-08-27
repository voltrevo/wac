
/**
 * Make the directory `-o` names, if it is not there.
 *
 * `native/v8/seed/` is gitignored — it holds a compiler rebuilt from source, not a checked-in
 * artefact — so the very invocation `native/v8/build.rs` documents,
 * `wac task app:native … -o native/v8/seed/wacc`, failed on a fresh checkout with a missing
 * directory nobody had been told to create. A tool that is given an output path should make the
 * place it was told to write. `issues/system/0148` recorded it.
 */
async function ensureOutDir(out: string): Promise<void> {
  const slash = out.lastIndexOf("/");
  if (slash <= 0) return;                       // no directory part, or the root
  await Deno.mkdir(out.slice(0, slash), { recursive: true });
}
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
import { wacFilesWithRoots } from "../../harness/wacFiles.ts";
import type { WaccRes } from "../../harness/waccBuild.ts";

/** Bumped when a field changes meaning. A runtime refuses a manifest it does not know. */
export const MANIFEST_VERSION = 1;

/** What a host must be able to do for the program, matching `GRANT_*` in `platform.wac`. */
/** `run` is `Cli.exec` — a host program, which `spawn` is not. `issues/system/0165`. */
export type Grants = {
  read?: boolean;
  write?: boolean;
  env?: boolean;
  net?: boolean;
  run?: boolean;
};

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
 * The module with its manifest **inside it**, as a custom section named `wac.manifest`.
 *
 * A host handed a module cannot work out the field order of `Core` or which dispatcher serves which
 * funcref — that is what the manifest is for, and until now it travelled beside the module as a
 * second file. One artefact matters because of `spawn`: what a program hands to `spawn` today is a
 * *JavaScript worker bundle*, which is why the shell searches `$WACPATH` rather than `$PATH`, and
 * nothing in this repository ever hands it anything but a compiled wac program. A module that
 * describes itself is what lets `spawn` take wasm instead.
 *
 * A custom section is the format's own extension point: id 0, a name, and bytes nobody else reads.
 * Appending one changes no index and no other section, so a module with this in it runs anywhere a
 * module without it runs — including a browser, which is the property that would be lost by
 * inventing a container format instead.
 */
export function withManifestSection(wasm: Uint8Array, manifest: string): Uint8Array {
  const name = new TextEncoder().encode("wac.manifest");
  const body = new TextEncoder().encode(manifest);
  const payload = new Uint8Array(uleb(name.length).length + name.length + body.length);
  let at = 0;
  const nameLen = uleb(name.length);
  payload.set(nameLen, at); at += nameLen.length;
  payload.set(name, at); at += name.length;
  payload.set(body, at);
  const size = uleb(payload.length);
  const out = new Uint8Array(wasm.length + 1 + size.length + payload.length);
  out.set(wasm, 0);
  out[wasm.length] = 0; // a custom section
  out.set(size, wasm.length + 1);
  out.set(payload, wasm.length + 1 + size.length);
  return out;
}

/** The format's own integer encoding, which is the only reason this needs any code at all. */
function uleb(n: number): Uint8Array {
  const bytes: number[] = [];
  let v = n;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    bytes.push(b);
  } while (v !== 0);
  return new Uint8Array(bytes);
}

/**
 * Compile `entry` and write `<out>.wasm` — the manifest is a section inside it.
 *
 * `out` is a stem rather than a filename, because two files come out of it and naming one of them
 * would leave the other implied.
 */
export async function buildNative(entry: string, out: string, grants: Grants = {}): Promise<Manifest> {
  // **With the roots, which `wacFiles` computes and drops.** `@/` is defined as the nearest
  // `wac.json5` at or above the importing file, so the walk that opens files is the only thing that
  // can answer it — and both compilers below need to be told. Asking for the files alone made the
  // documented Deno path unable to compile any project using `@/`, in two different words:
  //
  //     wacc:        wacc cannot compile main.wac yet — an import of a file that was not supplied
  //     reference:   `@/src/lib.wac` needs a project: no `wac.json5` above main.wac
  //
  // GitHub issue 22 finding 4 read that as two loaders diverging. It is one loader, asked the smaller
  // of its two questions by everything except `harness/referenceRun.ts` and `referenceCheck.ts`.
  const { files, roots } = await wacFilesWithRoots(entry);
  // The directory relative keys are measured from. The walk resolved `@/` against `Deno.cwd()`, so a
  // compiler handed a different base would file the same file under a second key.
  const base = Deno.cwd();
  // **wacc, unless asked otherwise**, the same rule and the same switch as `build.ts`: both jobs are
  // "build an application", and a manifest describing a module the reference compiled cannot
  // describe one that uses a feature only wacc has. `issues/lang/0105` — this was the last bundler
  // on the reference, and the binary embedding the pair is why it mattered.
  if (Deno.env.get("WAC_APP_FROM") !== "reference") {
    return await buildNativeWithWacc(entry, out, grants, files, roots, base);
  }
  const r = wacCompile(files, entry, { roots, base });
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

  const text = JSON.stringify(manifest, null, 2) + "\n";
  await ensureOutDir(out);
  await Deno.writeFile(`${out}.wasm`, withManifestSection(c.wasm as Uint8Array, text));
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
// **The wire is no longer derived here at all**, so the memo that used to hold it is gone with it.
//
// It existed because `bindTypesFiles` and `exportSigsFiles` were two more full front-end passes over
// a graph `waccArtifacts` had already compiled — 1.9s against `buildApp`'s 0.3, and 7.6s for the four
// grant sets `native_hostfs_test.wac` builds. Taking the boundary from the module's own compile costs
// nothing at all instead of a memoised ~1.8s, and it cannot disagree with the module. Which is the
// better reason: `issues/system/0241c` is what the disagreement looked like.


/** What `waccApi` builds, and therefore part of the wire cache's key. */
// **Absolute, from this file's own location.** It is the *compiler's* source, not the caller's, so a
// bare relative path only worked with the wac checkout as the working directory — GitHub issue 21.
const WACC_API = new URL("../wacc/src/api.wac", import.meta.url).pathname;

async function buildNativeWithWacc(
  entry: string,
  out: string,
  grants: Grants,
  files: Map<string, string>,
  roots: Map<string, string>,
  base: string,
): Promise<Manifest> {
  const { waccApi, waccArtifacts, waccRes } = await import("../../harness/waccBuild.ts");
  const { parseAliases, parseBindTypes, parseCallbacks, parseSigs } = await import(
    "../wacc/tools/waccBindgen.ts"
  );
  const art = await waccArtifacts(files, entry, { roots, base });
  const api = await waccApi();
  const paths = [...files.keys()];
  const sources = paths.map((p) => files.get(p)!);
  // **From the compile that made the module, not from a second one** — `issues/system/0241c`.
  //
  // This called `bindTypesFilesIn` separately, which is its own pass with its own signature table:
  // a capability signature that pass did not reach got no `C` line while the emitter still emitted
  // its import, so the manifest described 63 callbacks for a module importing 65 and instantiating
  // it from the manifest failed. `packages/box/example/boxsh.wac` never calls `Cli.load`, which is
  // what made it the file that showed it.
  //
  // `buildFilesIn` answers the wasm and the metadata together — `issues/lang/0129` made that one
  // call — so the boundary here is the module's own by construction and cannot drift from it.
  const wire = art.wire;
  const types = parseBindTypes(wire);
  const cbs = parseCallbacks(wire);
  const sigs = parseSigs(art.sigWire);

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

  const text = JSON.stringify(manifest, null, 2) + "\n";
  // **Inside the module and beside it.** The pair is what every host reads today; the section is
  // what lets one artefact be handed to `spawn`. Writing both costs 389 KB on the largest program
  // here and removes the need to decide anything at once.
  await ensureOutDir(out);
  await Deno.writeFile(`${out}.wasm`, withManifestSection(art.wasm, text));
  return manifest;
}

if (import.meta.main) {
  const args = Deno.args;
  const entry = args[0];
  const at = args.indexOf("-o");
  const out = at >= 0 && at + 1 < args.length ? args[at + 1] : null;
  if (entry === undefined || out === null) {
    // **`wac task app:native` is not a task**, and this line told the reader to run it. It was one
    // once; `deno.json` has `app:build` and nothing else in that family. So the first thing somebody
    // gets wrong here was answered with a command that does not exist — and GitHub issue 22 is a case
    // study of exactly that reader, who reached for this path because the documented one needed Cargo.
    // The spelling below is `docs/your-own-project.md`'s, which is the one that works from outside the
    // checkout. `issues/system/0230a`.
    console.error("usage: deno run -A --import-map <wac>/deno.json <wac>/packages/platform/native.ts");
    console.error("        <entry.wac> -o <stem> [--allow-read] [--allow-write] [--allow-net]");
    console.error("        [--allow-env] [--allow-run]");
    console.error("  writes <stem>.wasm — one artefact, manifest inside, for a non-JavaScript host");
    Deno.exit(2);
  }
  // **A flag this does not know is refused, not ignored.** Every grant below is an `args.includes(…)`,
  // so nothing looked at the arguments left over: `--allow-network` for `--allow-net` built a program
  // with no network grant and said nothing, and the failure arrived later as a capability refusal at
  // run time with nothing pointing back at the spelling. `wac build` answers *"unknown flag '…' —
  // --allow-read, …"* with exit 2 and no artefact; this now agrees, and quotes the word, because the
  // reason to have typed it was a mistake in it. `issues/system/0230a`.
  //
  // Everything that is not the entry, `-o`, or the name after `-o` has to be one of the five.
  const grants = ["--allow-read", "--allow-write", "--allow-net", "--allow-env", "--allow-run"];
  for (let i = 1; i < args.length; i++) {
    if (i === at || i === at + 1 || grants.includes(args[i])) continue;
    console.error(`unknown flag '${args[i]}' — ${grants.join(", ")}`);
    Deno.exit(2);
  }
  // **`--allow-run` was missing here and nowhere else**, which made `Cap::Exec` in the wasmtime host
  // unreachable: the manifest never carried `run`, `serde` defaulted it to false, and every call was
  // refused. The capability was written, compiled and never executed. `issues/system/0165`.
  // **A compiler reports; it does not throw at the user.** Every failure below used to reach the top
  // as an uncaught exception, so a program that did not compile printed its diagnostic followed by ten
  // frames of this repository's TypeScript — and a missing file printed nothing *but* a stack. That is
  // what an outsider saw when the documented install had failed and they reached for this path
  // instead. The message is the whole of what a caller can act on; the stack is available with
  // `WAC_STACK=1` for whoever is debugging the compiler rather than their program.
  // GitHub issue 21, `issues/system/0228a`.
  let m;
  try {
    m = await buildNative(entry, out, {
      read: args.includes("--allow-read"),
      write: args.includes("--allow-write"),
      env: args.includes("--allow-env"),
      net: args.includes("--allow-net"),
      run: args.includes("--allow-run"),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(message);
    if (Deno.env.get("WAC_STACK") === "1" && e instanceof Error && e.stack !== undefined) {
      console.error(e.stack);
    } else {
      console.error("  (WAC_STACK=1 for the TypeScript stack, if the compiler is what you are debugging)");
    }
    Deno.exit(1);
  }
  const size = (await Deno.stat(`${out}.wasm`)).size;
  console.log(`${out}.wasm  ${(size / 1024).toFixed(0)}K  ${m.callbacks.length} callback signatures`);
}
