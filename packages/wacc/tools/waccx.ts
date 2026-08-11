// `waccx` — the same CLI as `wacx`, over `wacc` instead of the reference.
//
// This exists to be *used*, which is the thing the ladder could not do for itself. Every oracle in
// this package compares wacc to the reference by position and count, and a position is a shape rather
// than a sentence: it can be right while the compiler is unusable. The first hour of writing this
// found four error codes that each meant two different errors — invisible to every one of those
// oracles, because none of them reads a code — and then found that `report` carries a code and a
// position and nothing else, so no diagnostic here can say *expected i32, found f64*. Neither fact
// needed a new test to discover. They needed something that consumes the output.
//
// Deliberately **not** a replacement. It reads the import graph with `wacx`'s own `readGraph` and
// renders with `wacx`'s own `wacDiag`, so the only difference between the two toolchains is the
// compiler in the middle — which is what makes `waccx.test.ts` a comparison of compilers rather than
// of command-line plumbing.
//
//     deno run -A packages/wacc/tools/waccxMain.ts check main.wac
//
// Commands: `check`, `compile`, `run`, `bindgen`. The last writes TypeScript that calls the module,
// for the types this generator covers — the numbers, `bool`, `string`, the numeric arrays, the
// structs and enums a host can hold, a callback it hands in, and a wac function handed back out —
// and names on stderr what it declined.

import { readGraph, type WacxCap } from "wac/wacx.ts";
import {
  generate, parseBindTypes, parseCallbacks, parseOutRefs, parseSigs, unsupported,
} from "./waccBindgen.ts";
import { wacDiag, type DiagError } from "wac/wacDiag.ts";
import { wacBind } from "../../../harness/wacBind.ts";

export type WaccxResult = { code: number };

const USAGE = `waccx — the wacc toolchain

  waccx check   main.wac        type-check the entry file and its imports
  waccx compile main.wac        write main.wasm
  waccx run     main.wac fn a b compile, instantiate, call fn
  waccx bindgen main.wac        write main.gen.ts — TypeScript that calls the module

Exit codes: 0 success, 1 a compile or usage error, 2 the program trapped.`;

type WaccApi = {
  diagnoseFiles: (paths: string[], sources: string[], entry: string) => string;
  exportSigsFiles: (paths: string[], sources: string[], entry: string) => string;
  bindTypesFiles: (paths: string[], sources: string[], entry: string) => string;
  emitFiles: (paths: string[], sources: string[], entry: string) => Uint8Array;
  blockedFiles: (paths: string[], sources: string[], entry: string) => string;
};

let cached: WaccApi | null = null;

/** Build wacc once per process. It is a wasm module like any other package here. */
async function wacc(): Promise<WaccApi> {
  if (cached === null) cached = (await wacBind("packages/wacc/src/api.wac")) as unknown as WaccApi;
  return cached;
}

/**
 * wacc's diagnostics, as the shared formatter wants them.
 *
 * The wire form is `file\tline\tcol\tphase\tmessage\tannotation`, one per line — the boundary carries
 * strings and not structures. The annotation is empty for a site that did not record its operands,
 * and omitted rather than blank here so the formatter draws a bare underline instead of a trailing
 * space. `span` is still 1 and `hint` still absent: wacc records neither, and inventing a span would
 * be making up the part of the diagnostic that is meant to be true.
 */
export function parseDiagnostics(wire: string): DiagError[] {
  const out: DiagError[] = [];
  for (const line of wire.split("\n")) {
    if (line === "") continue;
    const [file, ln, col, phase, message, annotation, hint, span] = line.split("\t");
    out.push({
      severity: "error",
      message,
      file,
      line: Number(ln),
      col: Number(col),
      phase: phase === "parse" || phase === "lex" ? phase : "typecheck",
      // A recorded width, or one where the checker measured none — see `diagnoseFiles`, which emits
      // `0` for "not measured" precisely so a *measurement* can tell that from a genuine width of 1.
      span: Number(span) > 0 ? Number(span) : 1,
      ...(annotation ? { annotation } : {}),
      ...(hint ? { hint } : {}),
    });
  }
  return out;
}

export async function waccx(argv: string[], cap: WacxCap): Promise<WaccxResult> {
  const [command, entry, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h") {
    cap.out(USAGE);
    return { code: command === undefined ? 1 : 0 };
  }
  if (!["check", "compile", "run", "bindgen"].includes(command)) {
    cap.err(`waccx: unknown command '${command}'\n\n${USAGE}`);
    return { code: 1 };
  }
  if (entry === undefined) {
    cap.err(`waccx ${command}: needs an entry file\n\n${USAGE}`);
    return { code: 1 };
  }

  let files: Map<string, string>;
  try {
    files = await readGraph(entry, cap);
  } catch (e) {
    cap.err(`waccx: ${e instanceof Error ? e.message : String(e)}`);
    return { code: 1 };
  }

  const api = await wacc();
  const paths = [...files.keys()];
  const sources = paths.map((p) => files.get(p)!);

  const diagnostics = parseDiagnostics(api.diagnoseFiles(paths, sources, entry));
  if (diagnostics.length > 0) {
    cap.err(wacDiag(diagnostics, files));
    return { code: 1 };
  }
  if (command === "check") return { code: 0 };

  // **A feature wacc cannot emit is not a silent partial module.** `blockedFiles` names it, and a
  // caller told "unsupported: untyped member" can act on that; one handed a module missing a function
  // finds out when it is called.
  const blocked = api.blockedFiles(paths, sources, entry);
  if (blocked !== "") {
    cap.err(`waccx: wacc cannot compile this yet — ${blocked}`);
    return { code: 1 };
  }

  const wasm = api.emitFiles(paths, sources, entry);

  if (command === "compile") {
    const outPath = entry.replace(/\.wac$/, "") + ".wasm";
    await cap.writeFile(outPath, wasm);
    return { code: 0 };
  }

  // **`bindgen`**: TypeScript that calls this module, beside it. What the generator cannot bind is
  // reported rather than skipped — a caller who is told `makeP(i32) -> P` was declined can change the
  // signature; one handed glue missing a function finds out at the call site.
  if (command === "bindgen") {
    const sigs = parseSigs(api.exportSigsFiles(paths, sources, entry));
    const wire = api.bindTypesFiles(paths, sources, entry);
    const types = parseBindTypes(wire);
    const cbs = parseCallbacks(wire);
    const outs = parseOutRefs(wire);
    const declined = unsupported(sigs, types, cbs, outs);
    if (declined.length > 0) {
      cap.err(`waccx bindgen: not bound yet — ${declined.join("; ")}`);
    }
    const outPath = entry.replace(/\.wac$/, "") + ".gen.ts";
    await cap.writeFile(outPath, new TextEncoder().encode(generate(wasm, sigs, types, cbs, outs)));
    return { code: 0 };
  }

  const fn = rest[0];
  if (fn === undefined) {
    cap.err(`waccx run: needs a function to call\n\n${USAGE}`);
    return { code: 1 };
  }
  let instance: WebAssembly.Instance;
  try {
    const built = await WebAssembly.instantiate(wasm as BufferSource, {});
    instance = built.instance;
  } catch (e) {
    cap.err(`waccx run: the emitted module did not instantiate — ${e instanceof Error ? e.message : String(e)}`);
    return { code: 1 };
  }
  const target = instance.exports[fn];
  if (typeof target !== "function") {
    cap.err(`waccx run: '${fn}' is not an exported function`);
    return { code: 1 };
  }
  // Numbers only. The reference coerces by the parameter's *declared* type, which it reads from the
  // compiled module's export table; wacc has no equivalent to read yet, so anything else is refused
  // rather than guessed.
  const args: number[] = [];
  for (const a of rest.slice(1)) {
    const n = Number(a);
    if (!Number.isFinite(n)) {
      cap.err(`waccx run: '${a}' is not a number — waccx coerces numeric arguments only`);
      return { code: 1 };
    }
    args.push(n);
  }
  try {
    const value = (target as (...xs: number[]) => unknown)(...args);
    if (value !== undefined) cap.out(String(value));
    return { code: 0 };
  } catch (e) {
    cap.err(`waccx run: trapped — ${e instanceof Error ? e.message : String(e)}`);
    return { code: 2 };
  }
}
