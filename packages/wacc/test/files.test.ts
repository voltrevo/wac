// The import walk, in wac, against the one in TypeScript.
//
// `harness/wacFiles.ts` has walked the import graph for every build this repository has ever done,
// which makes it the oracle here — and a legitimate one, because it is not the compiler under test.
// The wac copy exists so that a wac program can be the compiler's command line without TypeScript in
// the path (design/lang/0003 step 4), and the two have to agree about what a program is *made of* or
// they will compile different programs from the same entry.

import { wacBind } from "../../../harness/wacBind.ts";
import { importPaths } from "../../../harness/wacFiles.ts";

const files = await wacBind("packages/wacc/src/files.wac") as {
  importSpecs: (src: Uint8Array) => string[];
  resolveFrom: (from: string, spec: string) => string;
};

/** Every `.wac` file in the repository, which is the corpus this walk has to agree on. */
async function everyWacFile(): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for await (const e of Deno.readDir(dir)) {
      const path = `${dir}/${e.name}`;
      if (e.isDirectory) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "target") continue;
        await walk(path);
      } else if (e.name.endsWith(".wac")) out.push(path);
    }
  };
  await walk("packages");
  await walk("spec");
  return out;
}

Deno.test("the wac walk names the same imports as the TypeScript one, on every file in the tree", async () => {
  const wrong: string[] = [];
  let total = 0;
  for (const path of await everyWacFile()) {
    const src = await Deno.readTextFile(path);
    const want = importPaths(src);
    const got = files.importSpecs(new TextEncoder().encode(src));
    total++;
    if (got.join("|") !== want.join("|")) {
      wrong.push(`${path}: wac says [${got.join(", ")}], TypeScript says [${want.join(", ")}]`);
    }
  }
  if (total < 100) throw new Error(`only ${total} files walked — the corpus is not being found`);
  if (wrong.length > 0) {
    throw new Error(`${wrong.length} of ${total} disagree:\n  ${wrong.slice(0, 5).join("\n  ")}`);
  }
  console.log(`    imports: ${total} files, both walks agree`);
});

Deno.test("a specifier resolves against the file that wrote it", () => {
  // The last two are the ones worth having: an absolute path that must keep its root, and a `..`
  // that walks past the start, where dropping the leading slash or keeping the `..` are the two
  // ways this goes wrong quietly.
  const cases: [string, string, string][] = [
    ["packages/git/src/repo.wac", "../../fs/src/fs.wac", "packages/fs/src/fs.wac"],
    ["main.wac", "./lib.wac", "lib.wac"],
    ["a/b/c.wac", "../../d.wac", "d.wac"],
    ["/abs/dir/a.wac", "./b.wac", "/abs/dir/b.wac"],
    // A `..` that climbs past the root stays, in **both** walks — `/../b.wac`. POSIX would say `/`,
    // and neither of these is a filesystem: what they compute is an identity for a path, and two
    // identities agreeing matters more than either matching `realpath`. Asserted as it is so that
    // one of them cannot quietly start "fixing" it.
    ["/abs/a.wac", "../../b.wac", "/../b.wac"],
  ];
  const wrong = cases
    .map(([from, spec, want]) => ({ from, spec, want, got: files.resolveFrom(from, spec) }))
    .filter((c) => c.got !== c.want)
    .map((c) => `${c.from} + ${c.spec} = ${c.got}, wanted ${c.want}`);
  if (wrong.length > 0) throw new Error(wrong.join("\n"));
});
