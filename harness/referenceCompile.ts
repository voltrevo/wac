// Compile an entry with the reference compiler, resolution and all.
//
// **Because `wacFiles(entry)` answers the smaller of two questions, and the small one looks complete.**
// The walk searches upward for each `@/` importer's `wac.json5` — it has to, or it cannot follow the
// import — and then `wacFiles` returns the files and drops what it found. `wacFilesWithRoots` returns
// both, and `wacCompile` takes them as `options.roots` and `options.base`.
//
// Seven call sites did `wacCompile(await wacFiles(entry), entry)`. Two of them — `referenceRun.ts` and
// `referenceCheck.ts` — got it right by writing the four-line version out; every other one compiled a
// project's `@/` import to nothing and reported "needs a project: no `wac.json5` above …" for a file
// with a manifest two directories up. GitHub issue 22 read that divergence as each tool growing its
// own loader. There is one loader; what differed was which of its two entry points was called, and
// nothing made the shorter one look lossy.
//
// So the fix is a function rather than the same edit seven times: a caller that wants a compiled entry
// asks for one, and cannot omit an argument it does not know exists.

import { wacCompile } from "wac/wacCompile.ts";
import type { CompileResult, WacCompileOptions } from "wac/wacCompile.ts";
import { wacFilesWithRoots } from "./wacFiles.ts";

/**
 * `entry` and its closure, compiled with the project roots the walk found.
 *
 * `options` is passed through, so a caller wanting coverage or anything else adds it and keeps the
 * resolution. Explicitly passing `roots` or `base` wins — nothing here second-guesses a caller that
 * has its own graph.
 */
export async function compileEntry(
  entry: string,
  options: WacCompileOptions = {},
): Promise<CompileResult> {
  const { files, roots } = await wacFilesWithRoots(entry);
  return wacCompile(files, entry, { roots, base: Deno.cwd(), ...options });
}
