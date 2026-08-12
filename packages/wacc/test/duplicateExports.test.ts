// A bind helper belongs to one struct, even when five files declare that name.
//
// `Reader` is declared in `packages/fs/src/wire.wac`, `packages/tls/src/wire.wac`,
// `packages/ssh/src/wire.wac`, `packages/zstd/src/frame.wac` and `packages/box/src/lib/input.wac`.
// Linking keeps them apart by file — the first keeps the name `Reader` and the rest are keyed
// `Reader@<file>` — so the *key* is what says which struct is meant. The loop that exports a
// crossing struct's methods matched declarations by the text of their name token instead, which is
// the same text for all five: one module then carried `$bind$m_Reader__packages_fs_src_wire_u32`
// several times over, and WebAssembly refuses a duplicate export name outright [issue 0106].
//
// It took building `packages/box` through wacc to see this, because it takes two files declaring one
// name *and* that struct crossing the boundary.

import { waccApi } from "../../../harness/waccBuild.ts";

const files: Record<string, string> = {
  // Two files, one name, both with a `u32` method — and both crossing the bind boundary, which is
  // what makes the helpers exist at all.
  "/t/one.wac": `export struct Reader {
  i32 at;
  i32 u32(this) { return this.at + 1; }
}
export Reader openOne() { return Reader(1); }
`,
  "/t/two.wac": `export struct Reader {
  i32 pos;
  i32 u32(this) { return this.pos + 2; }
}
export Reader openTwo() { return Reader(2); }
`,
  // **The entry has to say that both cross.** A `Reader` is bound because an exported signature
  // here names it — not because the file it lives in said `export struct`, which means "visible to
  // whoever imports me". So the collision this test is about needs both types in *this* file's
  // interface, which is also the only way a host could hold one. `issues/lang/0107`.
  "/t/main.wac": `import { Reader as ReaderOne, openOne } from "./one.wac";
import { Reader as ReaderTwo, openTwo } from "./two.wac";
export ReaderOne one() { return openOne(); }
export ReaderTwo two() { return openTwo(); }
export i32 run() { return openOne().u32() + openTwo().u32(); }
`,
};

Deno.test("two files declaring one struct name export their helpers once each", async () => {
  const api = await waccApi();
  const paths = Object.keys(files);
  const sources = paths.map((p) => files[p]);
  const wasm = Uint8Array.from(
    api.emitFiles(paths, sources, "/t/main.wac") as unknown as number[],
  );
  if (wasm.length <= 8) throw new Error("the module was declined");

  // **The engine is the assertion.** A duplicate export name is not a warning or a stylistic
  // problem: `new WebAssembly.Module` rejects the whole module, which is how this arrived — as a
  // shell that would not start rather than as a wrong answer.
  let mod: WebAssembly.Module;
  try {
    mod = new WebAssembly.Module(wasm);
  } catch (err) {
    throw new Error(`the module was rejected: ${err instanceof Error ? err.message : err}`);
  }

  const seen = new Set<string>();
  for (const e of WebAssembly.Module.exports(mod)) {
    if (seen.has(e.name)) throw new Error(`${e.name} was exported twice`);
    seen.add(e.name);
  }

  // And the helpers are distinct: one per struct, not one name shared by two.
  const readers = [...seen].filter((n) => n.startsWith("$bind$m_") && n.endsWith("_u32"));
  if (readers.length !== 2) {
    throw new Error(`expected a u32 helper for each Reader, got ${JSON.stringify(readers)}`);
  }
});
