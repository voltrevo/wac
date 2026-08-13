// wacBind — compile a .wac entry file and hand back its bindgen'd JS module.
//
// Going through wacBindgen rather than wacInstance is what makes u8[] usable
// from the test side: bindgen embeds the copy-in/copy-out helpers, so an
// `u8[] gzip(u8[])` export becomes `gzip(Uint8Array): Uint8Array`. Calling the
// raw wasm export directly is not an option — a JS caller cannot build a
// WasmGC array without those helpers.
//
// The generated module is written under .cache/ and imported, because a
// bindgen'd file is a real TypeScript module, not a string to eval.
//
// The write is atomic — a uniquely named temp file, then rename — because the suite
// runs in parallel and several test files bind the same entry. Writing the final path
// directly means one worker can import what another is halfway through writing, which
// fails as a syntax error in generated code and looks like a compiler bug.
//
// The result is cached by the content of everything that produced it — see `buildCache.ts`. A hit
// skips the compiler entirely, which is most of what this repo's suite used to spend its time on:
// twenty test files bind the same handful of entries, and each one compiled the whole import graph
// again. Profile mode never caches, because it wants the compiler's coverage table rather than only
// its output.

import { wacCompile } from "wac/wacCompile.ts";
import { wacBindgen } from "wac/wacBindgen.ts";
import { wacFiles } from "./wacFiles.ts";
import { profileDir, registerProfiled } from "./wacProfile.ts";
import { cached, compilerKeyParts, contentKey, filesParts, harnessKeyParts, hashDir } from "./buildCache.ts";
import {
  generate as waccGenerate, parseAliases, parseBindTypes, parseCallbacks, parseOutRefs, parseSigs,
  unsupported,
} from "../packages/wacc/tools/waccBindgen.ts";

const CACHE_DIR = ".cache";

/**
 * A name no other worker can produce.
 *
 * `Deno.pid` plus a counter is not enough: `--parallel` runs test files in isolates
 * that share a pid, and each starts its counter at zero — so two workers wrote the
 * same temp path, one renamed it, and the other's rename failed with NotFound. Only
 * visible in parallel, from a cold cache, about one run in three.
 */
const tempName = (base: string) => `${base}.${crypto.randomUUID()}.tmp`;

/**
 * The cache key for a binding, or null when it cannot be computed.
 *
 * Null means "do not cache", which is the honest answer when the compiler's own sources cannot be
 * read: that is the case where a stale artifact does the most damage, since whoever is editing the
 * compiler would be shown their previous build and told their fix did nothing.
 */
async function bindKey(
  entry: string,
  files: Map<string, string>,
  opts: BindOpts,
): Promise<string | null> {
  const compiler = await compilerKeyParts();
  const harness = await harnessKeyParts();
  if (compiler === null || harness === null) return null;
  // **Which compiler emitted the code is part of the key.** Without this a `WAC_WASM_FROM=wacc` run
  // is served the reference's build from an earlier run and reports a green suite that never ran a
  // byte of `wacc`'s output — the exact stale-artifact failure this key exists to prevent, in the
  // one mode where it would be least visible.
  const from = `${wasmFrom(opts)}/${bindFrom(opts)}`;
  // **And wacc's own sources, when wacc is the one emitting.** The parts above cover the reference
  // compiler and the harness; neither changes when `packages/wacc/src` does, so a measurement taken
  // after editing wacc's emitter was served the previous build and reported the old blocker. Two
  // packages said so by disagreeing with a third that happened to miss the cache.
  // **And the generator, when it is wacc's.** `WAC_BIND_FROM=wacc` builds the glue with
  // `packages/wacc/tools/waccBindgen.ts`, which none of the parts above cover: a fix to it was
  // served the previous run's broken artifact and looked like no fix at all.
  const wacc = from === "reference/reference" ? [] : [
    ...await hashDir("packages/wacc/src", ".wac"),
    ...await hashDir("packages/wacc/tools", ".ts"),
  ];
  return await contentKey(["bind", entry, from, ...wacc, ...compiler, ...harness, ...filesParts(files)]);
}

/**
 * Take the *code* from `wacc` and leave everything else alone, when `WAC_WASM_FROM=wacc` is set.
 *
 * `wacBindgen` needs a `WacCompiled`, and all of it but `wasm` is a description of the interface —
 * exports, structs, enums, callbacks — derived from the same source either compiler reads. So
 * replacing the bytes and keeping the description runs this repository's own tests against code
 * `wacc` generated, which is the half of rung 4 that had never been done: `corpusEmit` compiles the
 * corpus and checks the modules are well-formed, and a well-formed module can still compute the
 * wrong answer.
 *
 * **This is the emitter under test and nothing else.** The interface metadata is still the
 * reference's, so what a green run under *this* flag says is that wacc's code is right, not that it
 * could have produced the bindings. `WAC_BIND_FROM=wacc` is the other half and `waccGlue` below is
 * where it lives — set both and the reference is not in the room at all. Two flags rather than one
 * on purpose: when it breaks, it is worth knowing whether the bytes or the description was at fault.
 * Opt-in either way, so a normal suite run is untouched.
 */
async function waccWasm(
  files: Map<string, string>,
  entry: string,
  opts: BindOpts,
): Promise<Uint8Array | null> {
  if (wasmFrom(opts) !== "wacc") return null;
  const api = await waccApi();
  const paths = [...files.keys()];
  const sources = paths.map((p) => files.get(p)!);

  // **The checker first, which this path never asked.** It asked only what the *emitter* declined,
  // so a local `deno test <file>` compiled things the gate refused — a same-type cast, and an import
  // of a name the exporting module never exported, which is a package reaching into another's
  // private surface and being told nothing. Both cost a ten-minute suite to discover, and neither
  // was a compiler disagreement: `packages/platform/build.ts` diagnoses and this did not.
  // `issues/lang/0110`.
  const diagnostics = api.diagnoseGraph(paths, sources, entry);
  if (diagnostics !== "") {
    const lines = diagnostics.split("\n").filter((l) => l !== "").map((l) => {
      const [file, line, col, phase, message, , hint] = l.split("\t");
      return `  ${file}:${line}:${col} [${phase}] ${message}${hint ? ` — ${hint}` : ""}`;
    });
    throw new Error(`wacc did not compile ${entry}:\n${lines.join("\n")}`);
  }

  const blocked = api.blockedFiles(paths, sources, entry);
  if (blocked !== "") throw new Error(`wacc cannot compile ${entry} yet — ${blocked}`);
  return api.emitFiles(paths, sources, entry);
}

type WaccApi = {
  emitFiles: (paths: string[], sources: string[], entry: string) => Uint8Array;
  /** Every file's diagnostics, not just the entry's — `issues/lang/0118`. */
  diagnoseGraph: (paths: string[], sources: string[], entry: string) => string;
  blockedFiles: (paths: string[], sources: string[], entry: string) => string;
  exportSigsFiles: (paths: string[], sources: string[], entry: string) => string;
  bindTypesFiles: (paths: string[], sources: string[], entry: string) => string;
};
let waccCached: WaccApi | null = null;

/** wacc itself, built by the reference — the bootstrap has to start somewhere. */
async function waccApi(): Promise<WaccApi> {
  if (waccCached === null) {
    // **Asked for, not announced.** The seed builds wacc — the bootstrap has to start somewhere —
    // and saying so through the process environment told every concurrent bind the same thing. See
    // `bindFrom`.
    waccCached = (await wacBind("packages/wacc/src/api.wac", {
      from: "reference",
      wasmFrom: "reference",
    })) as unknown as WaccApi;
  }
  return waccCached;
}

/**
 * The whole binding from `wacc`: its code, its description of the interface, its generator.
 *
 * `WAC_WASM_FROM=wacc` swaps the *bytes* and keeps the reference's metadata, which measures the
 * emitter. This measures the rest — `exportSigsFiles` and `bindTypesFiles` are the half only a
 * compiler can answer, and `packages/wacc/tools/waccBindgen.ts` turns them into the same shape of
 * glue. A green run under this says the reference was not needed at all, which is the question
 * "could wacc be the primary compiler" reduced to something a suite can answer.
 *
 * Opt-in through `WAC_BIND_FROM=wacc`, and separate from `WAC_WASM_FROM` on purpose: when this
 * breaks it is worth knowing whether the bytes or the description was at fault.
 */
/**
 * Which compiler binds a package — **wacc unless told otherwise**, since 2026-08-12.
 *
 * The spec targets wacc (design/lang/0003), so anything using a feature the reference does not have
 * cannot be bound by it at all; the default has to be the one that will still work. `reference` is
 * the way back, and is what the seed build uses — see `waccApi`.
 */
/**
 * Which compiler describes and which emits — **the caller's word first, the environment second**.
 *
 * These used to be read from the process environment alone, and the bootstrap set
 * `WAC_BIND_FROM=reference` around building wacc itself and put it back afterwards. Tests run
 * concurrently in one process, so that window was visible to every *other* bind happening at the
 * time: `packages/zstd` was compiled by the reference because `packages/crypto` was building wacc in
 * the next task along, and it failed with `type 'u32' has no method 'leadingZeros'` — a wacc-only
 * feature refused by the seed, in a run where nobody had asked for the seed.
 *
 * It cost an afternoon to see because it needs two packages in one process and the right order, so
 * it looked like the feature was at fault rather than the harness. A parameter cannot race.
 */
function bindFrom(opts: BindOpts = {}): "wacc" | "reference" {
  if (opts.from !== undefined) return opts.from;
  return Deno.env.get("WAC_BIND_FROM") === "reference" ? "reference" : "wacc";
}

/** The same question about the *bytes*, which `WAC_WASM_FROM` selects and defaults to the seed. */
function wasmFrom(opts: BindOpts = {}): "wacc" | "reference" {
  if (opts.wasmFrom !== undefined) return opts.wasmFrom;
  return Deno.env.get("WAC_WASM_FROM") === "wacc" ? "wacc" : "reference";
}

async function waccGlue(
  files: Map<string, string>,
  entry: string,
  opts: BindOpts,
): Promise<string | null> {
  if (bindFrom(opts) !== "wacc") return null;
  const api = await waccApi();
  const paths = [...files.keys()];
  const sources = paths.map((p) => files.get(p)!);

  // **The checker first, which this path never asked.** It asked only what the *emitter* declined,
  // so a local `deno test <file>` compiled things the gate refused — a same-type cast, and an import
  // of a name the exporting module never exported, which is a package reaching into another's
  // private surface and being told nothing. Both cost a ten-minute suite to discover, and neither
  // was a compiler disagreement: `packages/platform/build.ts` diagnoses and this did not.
  // `issues/lang/0110`.
  const diagnostics = api.diagnoseGraph(paths, sources, entry);
  if (diagnostics !== "") {
    const lines = diagnostics.split("\n").filter((l) => l !== "").map((l) => {
      const [file, line, col, phase, message, , hint] = l.split("\t");
      return `  ${file}:${line}:${col} [${phase}] ${message}${hint ? ` — ${hint}` : ""}`;
    });
    throw new Error(`wacc did not compile ${entry}:\n${lines.join("\n")}`);
  }

  const blocked = api.blockedFiles(paths, sources, entry);
  if (blocked !== "") throw new Error(`wacc cannot compile ${entry} yet — ${blocked}`);
  const wasm = api.emitFiles(paths, sources, entry);
  const wire = api.bindTypesFiles(paths, sources, entry);
  const sigs = parseSigs(api.exportSigsFiles(paths, sources, entry));
  const declined = unsupported(sigs, parseBindTypes(wire), parseCallbacks(wire), parseOutRefs(wire));
  if (declined.length > 0) {
    throw new Error(`wacc's bindgen declined ${entry}: ${declined.join("; ")}`);
  }
  return waccGenerate(
    wasm, sigs, parseBindTypes(wire), parseCallbacks(wire), parseOutRefs(wire), parseAliases(wire),
  );
}

/** Compile and bind, throwing with the diagnostics a person needs. Shared by both paths. */
async function generate(
  files: Map<string, string>,
  entry: string,
  opts: BindOpts,
): Promise<string> {
  const whole = await waccGlue(files, entry, opts);
  if (whole !== null) return whole;
  const result = wacCompile(files, entry);
  if (!result.ok) {
    const lines = result.diagnostics.map((d) =>
      `  ${d.file}:${d.line}:${d.col} [${d.phase}] ${d.message}`);
    throw new Error(`wac compile failed for ${entry}:\n${lines.join("\n")}`);
  }
  for (const d of result.diagnostics) {
    console.warn(`warning: ${d.file}:${d.line}:${d.col} ${d.message}`);
  }
  const wasm = await waccWasm(files, entry, opts);
  return wacBindgen(wasm === null ? result.compiled : { ...result.compiled, wasm });
}

/**
 * Bind a wac program for a test.
 *
 * `asTool` says this module is part of the *toolchain* rather than the thing under test — wacc
 * itself, bound so it can compile something else. Under `WAC_PROFILE` every bound module is built
 * with coverage instrumentation and registered for attribution, and once applications are built by
 * wacc that swept the compiler's own 30,000 lines into every profile: `packages/wacc/src/api.wac`,
 * `ast.wac` and the rest, credited to whichever test happened to trigger a build, with none of the
 * subject's own lines left. A tool is not a subject [issue 0106].
 */
/** What a caller may pin, rather than announcing it to the whole process. */
export type BindOpts = {
  asTool?: boolean;
  /** Which compiler writes the glue and the metadata. */
  from?: "wacc" | "reference";
  /** Which compiler emits the module's bytes. */
  wasmFrom?: "wacc" | "reference";
};

export async function wacBind(
  entry: string,
  opts: BindOpts = {},
): Promise<Record<string, unknown>> {
  const profiling = profileDir && !opts.asTool;
  // Before the compiler is asked to do anything, so a stale checkout says so itself
  // rather than surfacing as a type error in whichever package used a new feature.
  const files = await wacFiles(entry);

  // The fast path: this exact program, compiled by this exact compiler, is already on disk.
  if (!profiling) {
    const key = await bindKey(entry, files, opts);
    if (key !== null) {
      const path = await cached("bind", key, ".gen.ts", async (tmp) => {
        await Deno.writeTextFile(tmp, await generate(files, entry, opts));
      });
      return await import(`${Deno.cwd()}/${path}`) as Record<string, unknown>;
    }
  }

  // Profile mode compiles with coverage instrumentation so wacProfile can record which
  // tests reach which lines. Off by default and invisible to a normal run: the
  // instrumented build is a different binary, and it is used for attribution only, never
  // for deciding whether a mutant was killed.
  const result = wacCompile(files, entry, profiling ? { coverage: true } : {});

  if (!result.ok) {
    const lines = result.diagnostics.map(d =>
      `  ${d.file}:${d.line}:${d.col} [${d.phase}] ${d.message}`);
    throw new Error(`wac compile failed for ${entry}:\n${lines.join("\n")}`);
  }
  // Warnings do not fail the compile, but silently dropping them in a build
  // helper is how they stay unnoticed forever.
  for (const d of result.diagnostics) {
    console.warn(`warning: ${d.file}:${d.line}:${d.col} ${d.message}`);
  }

  const ts = wacBindgen(result.compiled);
  await Deno.mkdir(CACHE_DIR, { recursive: true });
  const outPath = `${CACHE_DIR}/${profiling ? "prof_" : ""}${entry.replaceAll("/", "_")}.gen.ts`;
  const tmpPath = tempName(outPath);
  await Deno.writeTextFile(tmpPath, ts);
  await Deno.rename(tmpPath, outPath);

  const mod = await import(`${Deno.cwd()}/${outPath}`) as Record<string, unknown>;
  if (profiling) {
    // The counter array is allocated by __cov_init, not at instantiation; without it the
    // first instrumented branch traps on a null pointer.
    (mod.__cov_init as () => void)();
    const points = result.compiled.coverage!;
    registerProfiled({
      points,
      counts: () => {
        const len = (mod.__cov_len as () => number)();
        const get = mod.__cov_get as (i: number) => number;
        return Array.from({ length: len }, (_, i) => get(i));
      },
    });
  }
  return mod;
}
