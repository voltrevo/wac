#!/usr/bin/env -S deno run --allow-read
// Load a mixed .wac / .wapy import graph, and compile it.
//
//   deno run --allow-read tools/wapyLoad.ts main.wac
//
// ## The seam
//
// A frontend turns a file into a `Program`. wac has two now, chosen by extension, and nothing
// downstream cares which ran: positions come from the file the author wrote, because
// `wapyRead` emits tokens carrying them rather than text that has thrown them away.
//
// `wacCompile` does not yet expose that seam — it lexes and parses inline in phases 1 and 2,
// then works from `Map<path, Program>` for everything after. So this reaches past it, parsing
// each file itself and calling the later phases. The right fix is for `wacCompile` to accept
// programs; that is issue 0072, and until it lands this is the demonstration rather than the
// integration.
//
// ## The extension is not optional
//
// wac does not currently enforce `.wac` — `wacx` only uses it to derive an output name. That
// was harmless with one frontend. It is not harmless now: the extension *selects* the
// frontend, so an unrecognised one has to be an error rather than a silent assumption that a
// file is wac. Also issue 0072.

import { parseWapy } from "./wapyRead.ts";
import { wacResolve } from "../atoms/wac/wacResolve.ts";
import { wacTypeCheck } from "../atoms/wac/wacTypeCheck.ts";
import { wasmBuildBin } from "../atoms/wac/wasmBuildBin.ts";
import { wacLex } from "../atoms/wac/wacLex.ts";
import { wacParse, type Program } from "../atoms/wac/wacParse.ts";

export type Loaded = {
  /** Source, for the files that have one. A `.wapy` file is parsed rather than translated. */
  sources: Map<string, string>;
  programs: Map<string, Program>;
  errors: { file: string; line: number; col: number; message: string }[];
};

function resolveFrom(fromPath: string, spec: string): string {
  const dir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : ".";
  const parts: string[] = [];
  const abs = `${dir}/${spec}`.startsWith("/");
  for (const p of `${dir}/${spec}`.split("/")) {
    if (p === "." || p === "") continue;
    if (p === ".." && parts.length && parts[parts.length - 1] !== "..") parts.pop();
    else parts.push(p);
  }
  return (abs ? "/" : "") + parts.join("/");
}

/** Import specifiers, found by lexing so a specifier in a comment cannot contribute. */
function importPaths(src: string): string[] {
  const { tokens } = wacLex(src);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== "import") continue;
    let j = i + 1;
    while (j < tokens.length && !(tokens[j].kind === "ident" && tokens[j].text === "from") &&
           tokens[j].kind !== ";") j++;
    if (tokens[j]?.kind === "ident" && tokens[j + 1]?.kind === "string") {
      // The lexer already unquotes a string token, so the text *is* the path.
      out.push(tokens[j + 1].text);
    }
  }
  return out;
}

const KNOWN = [".wac", ".wapy"];

export async function loadGraph(
  entry: string,
  read: (p: string) => Promise<string> = (p) => Deno.readTextFile(p),
): Promise<Loaded> {
  const sources = new Map<string, string>();
  const programs = new Map<string, Program>();
  const errors: Loaded["errors"] = [];
  const queue = [entry];
  while (queue.length) {
    const path = queue.shift()!;
    if (programs.has(path)) continue;
    if (!KNOWN.some((e) => path.endsWith(e))) {
      throw new Error(
        `${path}: unknown extension — the extension selects the frontend, so it must be ` +
          `one of ${KNOWN.join(", ")}`,
      );
    }
    const src = await read(path);
    sources.set(path, src);

    // The one place the two frontends differ. Everything after this works from a `Program`.
    const { program, errors: errs } = path.endsWith(".wapy")
      ? parseWapy(src, path)
      : wacParse(wacLex(src).tokens, path);
    programs.set(path, program);
    errors.push(...errs);

    for (const spec of importsOf(program)) queue.push(resolveFrom(path, spec));
  }
  return { sources, programs, errors };
}

/** Imports come off the parsed program, so neither frontend needs a second way to find them. */
function importsOf(p: Program): string[] {
  return p.items.filter((i) => i.tag === "import").map((i) => (i as { path: string }).path);
}

type Diag = { file: string; line: number; col: number; message: string; phase?: string };

/**
 * Compile a mixed graph.
 *
 * Phases 3 to 5, run directly. `wacCompile` does phases 1 and 2 inline — it lexes and parses
 * from source — so a caller holding programs already cannot hand them over. The phases
 * themselves are exported and this calls them in `wacCompile`'s own order.
 *
 * **These fifteen lines are temporary.** Issue 0072 asks for `wacCompile` to accept programs,
 * and when it does this collapses to one call and the extension switch moves into the compiler,
 * where a frontend selector belongs.
 */
export async function compileMixed(entry: string): Promise<
  { ok: true; wasm: Uint8Array } | { ok: false; diagnostics: Diag[] }
> {
  const { programs, errors } = await loadGraph(entry);
  if (errors.length) {
    return { ok: false, diagnostics: errors.map((e) => ({ ...e, phase: "parse" })) };
  }

  const resolved = wacResolve(entry, programs);
  if (resolved.errors.length) {
    return { ok: false, diagnostics: resolved.errors.map((e) => ({ ...e, phase: "resolve" })) };
  }

  const typeDiags = wacTypeCheck(resolved, programs) as Diag[];
  const fatal = typeDiags.filter((d) => (d as { severity?: string }).severity !== "warning");
  if (fatal.length) {
    return { ok: false, diagnostics: fatal.map((d) => ({ ...d, phase: "typecheck" })) };
  }

  return { ok: true, wasm: wasmBuildBin(resolved, programs, {}) };
}

if (import.meta.main) {
  if (Deno.args.length !== 1) { console.error("usage: wapyLoad.ts <entry.wac|entry.wapy>"); Deno.exit(2); }
  const r = await compileMixed(Deno.args[0]);
  if (r.ok) {
    console.log(`compiled: ${r.wasm.length} bytes`);
  } else {
    for (const d of r.diagnostics) {
      console.error(`${d.file}:${d.line}:${d.col} ${d.phase ? `[${d.phase}] ` : ""}${d.message}`);
    }
    Deno.exit(1);
  }
}
