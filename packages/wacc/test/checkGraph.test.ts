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

// ── A type reachable only through an imported struct's signature ─────────────────────────────────
//
// `checkFiles` declares, from each imported file, exactly the names the entry wrote in its import
// list. That is right for what a file may *write*, and wrong for what it may *reach*: a struct's
// field can hold `fn[Pending<i32>()]`, and calling it gives a `Pending<i32>` whether or not the
// entry ever names `Pending`. Undeclared, that type has no methods, so `.wait()` answers nothing and
// every rule downstream of it goes quiet.
//
// The shape is the platform's, because that is where it was found — `packages/platform`'s `Cli` is
// entirely funcref fields answering `Pending<T>`, and almost no program imports `Pending`. Writing
// `!cli.writeFile(...).wait()` was accepted and built a module the engine refuses to load, with an
// engine-level message naming a function index (`issues/lang/0132`).
//
// **And the pair of assertions is the point**, as it is above. Declaring the reachable type is easy;
// declaring it in a way that also makes it *nameable* would trade this silence for a worse one, so
// the second test is the entry writing `Pending<i32>` without importing it, which must still be
// refused.
const CAP = `export struct Pending<T> {
  i32 id;
  fn[T(i32)] resolve;
  T wait(const this) { return this.resolve(this.id); }
}
export struct Cli {
  fn[Pending<i32>()] argCount;
}
`;
const REACHES = `import { Cli } from "./lib.wac";
export i32 main(Cli cli) { if (!cli.argCount().wait()) { return 1; } return 0; }
`;
const NAMES = `import { Cli } from "./lib.wac";
export i32 main(Cli cli) { Pending<i32> p = cli.argCount(); return p.wait(); }
`;

Deno.test("a generic reached through an imported field's type has its methods", () => {
  // `!` on an `i32`. Silent before this: `wait` was a method of a struct nobody had declared, so the
  // operand arrived untyped and the rule had nothing to refuse.
  const got = lines(api.diagnoseGraph(paths, [REACHES, CAP], "/t/m.wac"));
  if (got.length !== 1) throw new Error(`expected one diagnostic, got ${got.length}: ${got}`);
  const [file, , , phase, message] = got[0].split("\t");
  if (file !== "/t/m.wac") throw new Error(`blamed ${file} rather than the entry that wrote the '!'`);
  if (phase !== "check") throw new Error(`the wrong phase: ${phase}`);
  if (!message.includes("operand")) throw new Error(`the wrong rule: ${message}`);
});

Deno.test("but reaching a type is not importing it: the entry still may not write the name", () => {
  // The canary for the fix above, and the reason it cannot simply declare the name. The reference
  // says `undefined type 'Pending'` here, and a fix that made reachable types nameable would agree
  // with the buggy compiler instead — trading a missing diagnostic for a missing diagnostic.
  const got = lines(api.diagnoseGraph(paths, [NAMES, CAP], "/t/m.wac"));
  const undefinedType = got.filter((l) => l.split("\t")[4]?.includes("undefined type"));
  if (undefinedType.length === 0) {
    throw new Error(`writing an unimported type name was accepted: ${JSON.stringify(got)}`);
  }
});

// A function's signature reaches as far as a field's does, and the first version of the fix above
// closed only over structs and enums — so `later()` answering a `Pending<i32>` was the same silence
// one declaration kind over. Found by asking what else carries a type across a module boundary,
// which is the question the first fix should have been made to answer.
const RETURNS = `export struct Pending<T> {
  T v;
  T wait(const this) { return this.v; }
}
export Pending<i32> later() { return Pending<i32>(7); }
`;
const CALLS = `import { later } from "./lib.wac";
export i32 main() { if (!later().wait()) { return 1; } return 0; }
`;
const TAKES = `import { give } from "./lib.wac";
export i32 main() { return give(3); }
`;
const ACCEPTS = RETURNS + `export i32 give(Pending<i32> p) { return p.wait(); }\n`;

Deno.test("a generic reached through an imported function's return type has its methods", () => {
  const got = lines(api.diagnoseGraph(paths, [CALLS, RETURNS], "/t/m.wac"));
  if (got.length !== 1) throw new Error(`expected one diagnostic, got ${got.length}: ${got}`);
  const message = got[0].split("\t")[4];
  if (!message.includes("operand")) throw new Error(`the wrong rule: ${message}`);
});

Deno.test("and through a parameter type, which is the same reach in the other direction", () => {
  // `give` takes a `Pending<i32>` and is handed a literal. Untyped, the parameter matched anything.
  const got = lines(api.diagnoseGraph(paths, [TAKES, ACCEPTS], "/t/m.wac"));
  if (got.length === 0) throw new Error(`passing an i32 where a Pending<i32> goes was accepted`);
});
