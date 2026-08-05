// Run a program that never terminates, with a deadline. Used by `site.test.ts` as a subprocess,
// because a worker stuck in a wasm loop keeps Deno's process alive even after `terminate()` —
// see `runIsolated`. Prints one line and exits; the parent kills whatever is left.
import { createRunner } from "../src/editor/wac-compile.ts";
import { wacCompile } from "../atoms/wac/wacCompile.ts";

function compiled(src: string, file: string) {
  const r = wacCompile(new Map([[file, src]]), file);
  if (!r.ok) throw new Error(r.diagnostics[0].message);
  return r.compiled;
}

const SPIN = `export i32 spin(i32 n) { i32 i = 0; while (n != 1) { i++; } return i; }`;
const OK = `export string hi() { return "recovered"; }`;
const ms = Number(Deno.args[0] ?? "800");

// One runner across both, so the second call also shows that a killed worker is replaced rather
// than reused — it is still spinning and could not answer.
const runner = createRunner();
const started = Date.now();
const stopped = await runner.run({ compiled: compiled(SPIN, "a.wac"), funcName: "spin", argStrings: ["0"] }, ms);
const elapsed = Date.now() - started;
const after = await runner.run({ compiled: compiled(OK, "b.wac"), funcName: "hi", argStrings: [] }, 10_000);
runner.dispose();

console.log(JSON.stringify({ elapsed, ...stopped, after: after.output }));
