// The Node host. The same three things `hosts/deno.js` does — read files, parse a command line,
// print — against `node:fs` and `process.argv` instead of `Deno.*`.
//
// That the two differ only in those three things is the point: a host is not a port of the
// ladder, it is a page of code around it. Node 22 runs wasm GC, which is the one capability this
// needs beyond a filesystem.

import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

import { ladder } from "../js/ladder.js";
import { flatten } from "../js/flatten.js";
import { assemble } from "../js/assemble.js";

const root = fileURLToPath(new URL("..", import.meta.url));

/** The filesystem, as `flatten` wants it. */
export const files = {
  /** @param {string} p @returns {Promise<string>} */
  read: (p) => readFile(p, "utf8"),
  /** @param {string} p @returns {Promise<string>} */
  canonical: (p) => realpath(p),
};

/** @type {ReturnType<typeof ladder> | null} */
let rungs = null;

export async function boot() {
  if (rungs === null) {
    const read = (n) => readFile(`${root}boot/${n}`, "utf8");
    rungs = ladder({
      l1: await read("l1.l0"),
      l2: await read("l2.l1"),
      l3: await read("l3.l2"),
      l4: await read("l4.l3"),
      l5: await read("l5.l4"),
    });
  }
  return rungs;
}

/** @param {string} entry @returns {Promise<string>} */
export const flattenFrom = (entry) => flatten(entry, files);

// `import.meta.main` is Deno's; Node compares the entry path instead.
const isMain = fileURLToPath(import.meta.url) === (await realpath(argv[1] ?? "")).toString();

if (isMain) {
  const args = argv.slice(2);
  if (args.length < 1) {
    console.error("usage: node hosts/node.js <file.wac> [--l0]");
    console.error("  default   compile and run `main`");
    console.error("  --l0      print the wac-L0 instead");
    exit(2);
  }
  const l = await boot();
  const source = await flattenFrom(args[0]);
  const l0 = await l.l5ToL0(source);
  if (args.includes("--l0")) {
    process.stdout.write(l0);
  } else {
    const refusals = (l0.match(/^!!/gm) ?? []).length;
    if (refusals > 0) {
      console.error(`wac-L5 refused ${refusals} things`);
      for (const line of l0.split("\n").filter((x) => x.startsWith("!!")).slice(0, 5)) {
        console.error(`  ${line}`);
      }
      exit(1);
    }
    const inst = await WebAssembly.instantiate(await WebAssembly.compile(assemble(l0).buffer), {});
    console.log(inst.exports.main());
  }
}
