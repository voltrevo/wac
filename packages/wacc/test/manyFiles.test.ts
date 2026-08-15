// More files than the linker's tables used to hold.
//
// `linkFiles` accepts up to 1024 files — `seen` and `queue` are both that size and it refuses past
// them. The tables its callers handed it were half that, and the writes were *guarded* rather than
// checked: `if (starts.len() > sn)`, `if (filePaths.len() > sn - 1)`. So a program with more than
// 512 files linked, compiled, and ran correctly, while every line past the cut was attributed to
// whichever file happened to be last in the table.
//
// It cost nothing visible because nothing here is near the limit — `packages/box` is the largest at
// 170 — which is exactly why this test generates its own program rather than using one. The
// symptom is not a crash or a wrong answer: `total()` was right the whole time. It is that a
// coverage report, or any diagnostic whose line lands past the cut, names the wrong file and says
// so with complete confidence. `issues/lang/0130`.
//
// Kept deliberately just past the boundary rather than at 600, because the cost here is compiling
// the generated program and the interesting question is only whether the table stops early.

import { waccApi } from "../../../harness/waccBuild.ts";

const N = 560; // past 512, and cheap enough to compile in a test

function program(): { paths: string[]; sources: string[]; entry: string } {
  const paths: string[] = [], sources: string[] = [];
  for (let i = 0; i < N; i++) {
    paths.push(`/many/f${i}.wac`);
    // A branch, so each file contributes a coverage point that has to be attributed to it.
    sources.push(`export i32 v${i}(i32 x) {\n  if (x > 0) { return ${i}; }\n  return 0;\n}\n`);
  }
  const imports = Array.from({ length: N }, (_, i) => `import { v${i} } from "./f${i}.wac";`);
  const calls = Array.from({ length: N }, (_, i) => `v${i}(1)`);
  paths.push("/many/main.wac");
  sources.push(`${imports.join("\n")}\n\nexport i32 total() { return ${calls.join(" + ")}; }\n`);
  return { paths, sources, entry: "/many/main.wac" };
}

Deno.test("a program with more than 512 files attributes every line to its own file", async () => {
  // deno-lint-ignore no-explicit-any
  const api = await waccApi() as any;
  const { paths, sources, entry } = program();

  const blocked = api.blockedFiles(paths, sources, entry) as string;
  if (blocked !== "") throw new Error(`declined a ${N + 1}-file program: ${blocked}`);

  // The module is correct either way — that is the point, and why this went unnoticed.
  const wasm = api.emitFilesCovered(paths, sources, entry) as Uint8Array;
  // `slice()` gives a plain ArrayBuffer view: the bindgen array type does not satisfy
  // `BufferSource` under this checker.
  const inst = new WebAssembly.Instance(new WebAssembly.Module(wasm.slice().buffer), {});
  // deno-lint-ignore no-explicit-any
  const total = (inst.exports as any).total() as number;
  const want = (N - 1) * N / 2;
  if (total !== want) throw new Error(`total() answered ${total}, expected ${want}`);

  // What was actually broken: which file each counter belongs to.
  const rows = (api.covTableFiles(paths, sources, entry) as string).split("\n").filter((l: string) =>
    l !== ""
  );
  const named = new Set(rows.map((r: string) => r.split("\t").pop()!));
  if (named.size !== N + 1) {
    const missing = paths.filter((p) => !named.has(p));
    throw new Error(
      `${rows.length} coverage points name ${named.size} distinct files, not ${N + 1} — ` +
        `${missing.length} file(s) got none, first ${missing[0]}. The line table stopped early and ` +
        `their counters were credited to another file.`,
    );
  }
});
