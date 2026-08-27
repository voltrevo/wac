// The Deno host: where the strings come from, and nothing else.
//
// Everything that decides an answer is in `js/`; this reads files, parses a command line and
// prints. A host is meant to be small enough that a new one is not a project — see `hosts/node.js`
// and `hosts/browser.js`, which differ from this only in those three things.

import { ladder } from "../js/ladder.js";
import { flatten } from "../js/flatten.js";
import { assemble } from "../js/assemble.js";

const root = new URL("..", import.meta.url).pathname;

/** The filesystem, as `flatten` wants it. */
export const files = {
  /** @param {string} p @returns {Promise<string>} */
  read: (p) => Deno.readTextFile(p),
  /** @param {string} p @returns {Promise<string>} */
  canonical: (p) => Deno.realPath(p),
};

/** The five rung sources, read once. */
let rungs = null;

/** @returns {Promise<ReturnType<typeof ladder>>} */
export async function boot() {
  if (rungs === null) {
    const read = (n) => Deno.readTextFile(`${root}boot/${n}`);
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

if (import.meta.main) {
  const args = Deno.args;
  if (args.length < 1) {
    console.error("usage: deno run -A hosts/deno.js <file.wac> [--l0]");
    console.error("  default   compile and run `main`");
    console.error("  --l0      print the wac-L0 instead");
    Deno.exit(2);
  }
  const l = await boot();
  const source = await flattenFrom(args[0]);
  const l0 = await l.l5ToL0(source);
  if (args.includes("--l0")) {
    console.log(l0);
  } else {
    const refusals = (l0.match(/^!!/gm) ?? []).length;
    if (refusals > 0) {
      console.error(`wac-L5 refused ${refusals} things`);
      for (const line of l0.split("\n").filter((x) => x.startsWith("!!")).slice(0, 5)) {
        console.error(`  ${line}`);
      }
      Deno.exit(1);
    }
    const inst = await WebAssembly.instantiate(await WebAssembly.compile(assemble(l0).buffer), {});
    console.log(inst.exports.main());
  }
}
