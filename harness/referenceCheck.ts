// Type-check a wac file and its imports **with the reference compiler**. Exit 0 if it is clean.
//
//     deno run -A harness/referenceCheck.ts <entry.wac>
//
// The companion to `referenceRun.ts`, and there for the same one reason: a differential needs two
// implementations. `packages/wacc/test/wac/corpuscheck_test.wac` asks this about a file *wacc*
// reported a diagnostic on, so that "wacc found something the reference agrees is wrong" and "wacc
// invented a false alarm" are different answers. Asking wacc would make it one answer.
//
// **The failure mode this replaces is worth naming.** That test reached the reference through the
// retired `wacx` CLI and read `r.ran() && r.status == 0` — so with the program gone it answers
// *false* for every file, meaning "the reference is unhappy too", meaning every false alarm wacc
// might raise is waved through as agreement. It is dormant while wacc reports nothing, which is why
// nothing failed; it is a rubber stamp the moment it is needed. Exit status is load-bearing here,
// so this is careful to separate "could not look" from "looked and it is wrong":
//
//     0   the reference compiles it with no errors
//     1   the reference reports at least one error — the diagnostics go to stderr
//     2   it could not be read, or the arguments are wrong
//
// A caller that treats 2 as 1 is back to the bug above, so the codes differ.

import { wacFilesWithRoots } from "./wacFiles.ts";
import { wacCompile } from "wac/wacCompile.ts";
import { wacDiag } from "wac/wacDiag.ts";

const [entry] = Deno.args;
if (entry === undefined) {
  console.error("usage: deno run -A harness/referenceCheck.ts <entry.wac>");
  Deno.exit(2);
}

let files: Map<string, string>;
let roots: Map<string, string>;
try {
  ({ files, roots } = await wacFilesWithRoots(entry));
} catch (e) {
  console.error(
    `referenceCheck: cannot read ${entry} or one of its imports — ${
      e instanceof Error ? e.message : String(e)
    }`,
  );
  Deno.exit(2);
}

const result = wacCompile(files, entry, { roots, base: Deno.cwd() });
if (!result.ok) {
  console.error(wacDiag(result.diagnostics, files));
  Deno.exit(1);
}
// Warnings do not fail a check, the same rule the binary follows — a warning that failed a build
// would be an error under a softer name.
if (result.diagnostics.length > 0) console.error(wacDiag(result.diagnostics, files));
console.log(`${entry}: ${files.size} file(s), no errors`);
