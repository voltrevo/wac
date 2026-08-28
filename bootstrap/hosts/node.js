// The Node host. The same three things `bootstrap/hosts/deno.js` does — read files, parse a command line,
// print — against `node:fs` and `process.argv` instead of `Deno.*`.
//
// That the two differ only in those three things is the point: a host is not a port of the
// ladder, it is a page of code around it. Node 22 runs wasm GC, which is the one capability this
// needs beyond a filesystem.

import { readFile, realpath, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

import { ladder } from "../js/ladder.js";
import { fileSet, flatten } from "../js/flatten.js";
import { buildWithWacc, grantsOf } from "../js/wacc.js";
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

/** @param {string} l0 */
function refuseIfRefused(l0) {
  const bad = l0.split("\n").filter((x) => x.startsWith("!!"));
  if (bad.length === 0) return;
  console.error(`wac-L5 refused ${bad.length} things`);
  for (const line of bad.slice(0, 5)) console.error(`  ${line}`);
  exit(1);
}

// `import.meta.main` is Deno's; Node compares the entry path instead.
const isMain = fileURLToPath(import.meta.url) === (await realpath(argv[1] ?? "")).toString();

if (isMain) {
  const args = argv.slice(2);
  if (args.length < 1) {
    console.error("usage: node hosts/node.js <file.wac> [--l0 | -o <out.wasm>]");
    console.error("         [--with-wacc <entry.wac>] [--allow-read|write|net|env|run]");
    console.error("  default   compile and run `main`");
    console.error("  --l0      print the wac-L0 instead");
    console.error("  -o FILE   write the wasm module");
    console.error("  --with-wacc E   build wacc from <file.wac>, then compile E with *that*,");
    console.error("            and seal it with the manifest wacc writes for it");
    exit(2);
  }
  const l = await boot();
  const dashO = args.indexOf("-o");

  // The twin of the Deno host's, and deliberately the same shape: `buildWithWacc` is the whole of
  // it, so the difference between these two files stays "where the bytes come from".
  const withWacc = args.indexOf("--with-wacc");
  if (withWacc >= 0) {
    if (dashO < 0) {
      console.error("hosts/node.js: --with-wacc needs -o, since there is nothing to run");
      exit(2);
    }
    const out = args[dashO + 1];
    const base = out.replace(/\.wasm$/, "").split("/").pop();
    const bytes = await buildWithWacc({
      l5ToL0: (src) => l.l5ToL0(src),
      assemble,
      waccSource: await flattenFrom(args[0]) + "\n" +
        await readFile(fileURLToPath(new URL("../drivers/spec_cases.wac", import.meta.url)), "utf8"),
      target: await fileSet(args[withWacc + 1], files),
      entryAsWritten: args[withWacc + 1],
      wasmName: `${base}.wasm`,
      grants: grantsOf(args),
    });
    await writeFile(out, bytes);
    exit(0);
  }

  const source = await flattenFrom(args[0]);
  const l0 = await l.l5ToL0(source);
  if (dashO >= 0) {
    refuseIfRefused(l0);
    await writeFile(args[dashO + 1], assemble(l0));
  } else if (args.includes("--l0")) {
    process.stdout.write(l0);
  } else {
    refuseIfRefused(l0);
    const inst = await WebAssembly.instantiate(await WebAssembly.compile(assemble(l0).buffer), {});
    console.log(inst.exports.main());
  }
}
