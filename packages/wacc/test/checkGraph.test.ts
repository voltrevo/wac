// A file the entry imports is checked too.
//
// `checkFiles` walks **only the entry's bodies**: every imported file contributes its signatures and
// nothing else. So `export i32 helper() { return "x"; }` one file away was silent — and the emitter,
// which compiles every body in the graph, wrote a module that failed validation at instantiation with
// `type error in return[0] (expected i32, got (ref 0))`. A wasm-level mismatch, in place of a source
// line. `issues/lang/0118`.
//
// `diagnoseGraph` checks each file **as an entry**, which is what makes it correct rather than
// approximate: a file gets the scope it would get if you named it on the command line, its own
// private declarations included. It costs a whole-graph parse per file, so it is what `check` calls
// and not what a build calls — the issue has the measurement and what it would take to afford both.
//
// The pair of assertions matters more than either alone. Reporting the error proves the walk reaches
// the file; staying silent on the same graph made correct proves it is the *rule* firing and not the
// walk complaining about scope it cannot see, which is how a per-file check goes wrong.

import { waccApi } from "../../../harness/waccBuild.ts";

type Api = {
  diagnoseFiles(paths: string[], sources: string[], entry: string): string;
  diagnoseGraph(paths: string[], sources: string[], entry: string): string;
};

const api = await waccApi() as unknown as Api;

const MAIN = `import { helper } from "./lib.wac";\nexport i32 main() { return helper(); }\n`;
const BROKEN = `export i32 helper() { return "x"; }\n`;
const FINE = `export i32 helper() { return 1; }\n`;
// A private function the entry never imports: checking this file as an entry must still see it, or
// the walk would report `helper` calling something that is not there.
const PRIVATE = `i32 twice(i32 n) { return n * 2; }\nexport i32 helper() { return twice(21); }\n`;

const paths = ["/t/m.wac", "/t/lib.wac"];

function lines(wire: string): string[] {
  return wire.split("\n").filter((l) => l !== "");
}

Deno.test("a type error in an imported file is reported, and named against that file", () => {
  const got = lines(api.diagnoseGraph(paths, [MAIN, BROKEN], "/t/m.wac"));
  if (got.length !== 1) throw new Error(`expected one diagnostic, got ${got.length}: ${got}`);
  const [file, , , phase, message] = got[0].split("\t");
  if (file !== "/t/lib.wac") throw new Error(`blamed ${file} rather than the file with the error`);
  if (phase !== "check") throw new Error(`the wrong phase: ${phase}`);
  if (!message.includes("return type")) throw new Error(`the wrong rule: ${message}`);
});

Deno.test("and the entry-only walk is why it was silent", () => {
  // Not a preference — the record of what this changed. `diagnoseFiles` is still what a build calls,
  // and this says exactly what that costs the caller.
  const got = lines(api.diagnoseFiles(paths, [MAIN, BROKEN], "/t/m.wac"));
  if (got.length !== 0) throw new Error(`diagnoseFiles now reports imports too: ${got}`);
});

Deno.test("a correct graph stays silent, private declarations and all", () => {
  // The canary. A walk that checked imported files without giving them their own scope would report
  // `twice` as unresolved here — a false alarm on correct code, which is worse than the silence.
  for (const [what, lib] of [["a plain export", FINE], ["a private helper", PRIVATE]] as const) {
    const got = lines(api.diagnoseGraph(paths, [MAIN, lib], "/t/m.wac"));
    if (got.length !== 0) throw new Error(`${what}: correct code was refused — ${got}`);
  }
});
