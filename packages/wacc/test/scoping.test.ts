// A parameter's name is not a module-level name.
//
// wacc links by concatenating files, so a name two files both declare is kept apart by the file it
// was written in — and a name *neither* file can be shown to mean is refused rather than guessed at,
// because guessing shows up as "expected (ref null 1), got (ref null 7)" in a third file that
// mentions neither. That refusal is module-wide: one ambiguous name and nothing is emitted.
//
// Which makes it important that only real module-level references reach it. A pre-pass that walks a
// body with no locals loaded sees `write(bytes)` — where `write` is the function's own parameter —
// as a reference to whatever `write` means in the module, and if two files happen to declare one,
// the whole program stops compiling. `packages/box` is 178 files: two of them declare `write` and
// one of them takes a `write` parameter, which is how six programs came to emit an empty module
// [issue 0106].

import { waccApi } from "../../../harness/waccBuild.ts";

const files: Record<string, string> = {
  "/t/a.wac": `export bool write(u8[] b) { return b.len() > 0; }\n`,
  "/t/b.wac": `export bool write(i32 n) { return n > 0; }\n`,
  "/t/c.wac": `export i32 pump(fn[bool(u8[])] write) { return write(u8[1]()) ? 1 : 0; }\n`,
  "/t/main.wac": `import { write } from "./a.wac";
import { write as writeN } from "./b.wac";
import { pump } from "./c.wac";
export i32 run() { return pump(write) + (writeN(1) ? 1 : 0); }
`,
};

Deno.test("a parameter named like two files' functions does not make the module ambiguous", async () => {
  const api = await waccApi();
  const paths = Object.keys(files);
  const sources = paths.map((p) => files[p]);
  const entry = "/t/main.wac";

  // The program is valid: the checker has nothing to say about it, and the reference compiler
  // builds and runs it — `run()` is 2.
  const diags = api.diagnoseFiles(paths, sources, entry);
  if (diags !== "") throw new Error(`the checker refused a valid program: ${diags}`);

  // **Bytes, not the blocked message.** An empty module is eight bytes — the magic and the version —
  // and is what every one of these failures looks like from the outside.
  const wasm = Uint8Array.from(api.emitFiles(paths, sources, entry) as unknown as number[]);
  if (wasm.length <= 8) {
    throw new Error(
      `emitted an empty module (${wasm.length} bytes): a parameter name was resolved as a global`,
    );
  }

  // And it is the *right* module: `pump` calls its parameter, not either file's `write`.
  //
  // An exported function taking a callback makes the module ask for the host's callback bridge, and
  // this test is not about the bridge — the stubs are built from the module's own import list and
  // never called, because `pump` reaches its parameter with `call_ref` rather than through the
  // boundary.
  const mod = new WebAssembly.Module(wasm);
  const imports: Record<string, Record<string, unknown>> = {};
  for (const imp of WebAssembly.Module.imports(mod)) {
    imports[imp.module] ??= {};
    imports[imp.module][imp.name] = imp.kind === "function" ? () => 0 : 0;
  }
  const instance = await WebAssembly.instantiate(mod, imports);
  const run = (instance.exports as { run?: () => number }).run;
  if (run === undefined) throw new Error("run was not exported");
  const got = run();
  if (got !== 2) throw new Error(`run() gave ${got}, the reference gives 2`);
});
