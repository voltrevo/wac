// A coverage point says which file it is in, and the line that file's editor shows.
//
// wacc links by concatenating files, so every line number inside the emitter is a line of the blob
// rather than of a file anybody has open. The table said `index, line, col, kind` and stopped there,
// which leaves a reader two ways to be wrong at once: it attributed every point to the entry — the
// only path it had — and reported the blob's line as if it were the file's. `packages/json` came back
// as 621 points in `json.wac` and none at all in `parse.wac`, `stringify.wac` or `value.wac`, where
// the reference compiler puts 269 of them [issue 0105].
//
// The reference is the oracle here: it has always reported both, and a coverage report that names
// the wrong file is worse than none, because it reads as a file nobody tested.

import { waccApi } from "../../../harness/waccBuild.ts";

const files: Record<string, string> = {
  "/t/main.wac": `import { twice } from "./helper.wac";
export i32 run(i32 n) { if (n > 1) { return twice(n); } return twice(1); }
`,
  "/t/helper.wac": `// A comment, so the branch below is not on the same line as main's.
export i32 twice(i32 n) {
  if (n > 0) { return n * 2; }
  return 0;
}
`,
};

Deno.test("a coverage point names its own file, at that file's own line", async () => {
  const api = await waccApi();
  const paths = Object.keys(files);
  const sources = paths.map((p) => files[p]);
  const table = api.covTableFiles(paths, sources, "/t/main.wac");

  const rows = table.split("\n").filter((l) => l !== "").map((l) => l.split("\t"));
  if (rows.length === 0) throw new Error("no coverage points at all");
  for (const r of rows) {
    if (r.length < 5) throw new Error(`a row has no file: ${JSON.stringify(r.join("\t"))}`);
  }

  const byFile = new Map<string, number[]>();
  for (const r of rows) {
    const lines = byFile.get(r[4]) ?? [];
    lines.push(Number(r[1]));
    byFile.set(r[4], lines);
  }

  // Both files have a branch, so both must appear — attributing everything to the entry is the
  // failure this is here for.
  for (const p of paths) {
    if (!byFile.has(p)) {
      throw new Error(`no points in ${p}; the table names ${[...byFile.keys()].join(", ")}`);
    }
  }

  // `helper.wac`'s branch is on **its** line 3, not on whatever line the concatenation put it.
  const helper = byFile.get("/t/helper.wac")!;
  if (!helper.includes(3)) {
    throw new Error(`helper's branch is on line 3; the table says ${helper.join(", ")}`);
  }
  // And no line may exceed the file it claims to be in.
  for (const [file, lines] of byFile) {
    const count = files[file].split("\n").length;
    const over = lines.filter((l) => l > count);
    if (over.length > 0) {
      throw new Error(`${file} has ${count} lines; the table claims ${over.join(", ")}`);
    }
  }
});
