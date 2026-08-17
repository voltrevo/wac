// A relative import with a `..` anywhere but the front — `issues/lang/0150`.
//
// The bug was not in either resolver on its own. `gather` resolved `./sub/../lib.wac` to
// `lib.wac`, read the file and supplied it under that key; the linker resolved the same specifier
// with its own copy, which stripped leading `./` and `../` and nothing else, and asked for
// `sub/../lib.wac`. The program read and then did not link.
//
// So the test is at the seam where the two met: `emitFiles` takes the paths the walker produced
// and the sources it read, and links them. A test of either resolver alone passes with the bug in
// place — which is what happened for as long as it existed, because `test/files.test.ts` has
// covered `resolveFrom` all along.

import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const emitFiles = mod.emitFiles as (paths: string[], sources: string[], entry: string) => Uint8Array;
const blockedFiles = mod.blockedFiles as (paths: string[], sources: string[], entry: string) => string;

const LIB = "export i32 answer() { return 42; }\n";
const main = (spec: string) => `import { answer } from "${spec}";\nexport i32 main() { return answer(); }\n`;

/** The walker's own normalisation: what `gather` would have supplied these files under. */
const PATHS = ["main.wac", "lib.wac"];

Deno.test("a specifier with an interior `..` links to the file the walker supplied", async () => {
  const wrong: string[] = [];
  // Every spelling of "lib.wac, next to main.wac" that a person might write. Each one is resolved
  // to `lib.wac` by the walker, so each one has to be found by the linker under that key.
  for (
    const spec of [
      "./lib.wac",
      ".//lib.wac",
      "./sub/../lib.wac",
      "./a/b/../../lib.wac",
      "./././lib.wac",
      "./sub/./../lib.wac",
    ]
  ) {
    const sources = [main(spec), LIB];
    const why = blockedFiles(PATHS, sources, "main.wac");
    if (why !== "") { wrong.push(`${spec}: ${why}`); continue; }
    const wasm = emitFiles(PATHS, sources, "main.wac");
    if (wasm.length === 0) wrong.push(`${spec}: emitted nothing`);
  }
  if (wrong.length > 0) throw new Error(`${wrong.length} spelling(s) did not link:\n  ` + wrong.join("\n  "));
});

Deno.test("a specifier that really names no supplied file still says so", async () => {
  // The canary for the above: the fix widened what resolves, and a fix that resolved *everything*
  // to something present would pass every case in the first test. This is the same call shape with
  // a genuinely absent file, and it must still be refused.
  const sources = [main("./nope.wac"), LIB];
  const why = blockedFiles(PATHS, sources, "main.wac");
  if (why === "") throw new Error("a missing import was accepted");
  if (!why.includes("not supplied")) throw new Error(`refused for the wrong reason: ${why}`);
});

Deno.test("climbing out of the supplied set is still not a way in", async () => {
  // `../` past the root normalises to a leading `..`, which no supplied path has. Worth its own
  // case because the fix made interior components collapse, and collapsing is exactly what could
  // have turned `../../lib.wac` into `lib.wac`.
  const sources = [main("../lib.wac"), LIB];
  const why = blockedFiles(PATHS, sources, "main.wac");
  if (why === "") throw new Error("an import from above the program's root was accepted");
});
