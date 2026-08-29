// `packages/ts` as a command line: files in, one bundle on standard output.
//
//     deno run -A packages/ts/host/run.js transform.wasm entry.ts [more.ts ...] > out.js
//     node        packages/ts/host/run.js transform.wasm entry.ts [more.ts ...] > out.js
//
// `design/system/0009`. This is what the bootstrap reaches for and the reason the transform's
// interface is one function: no capabilities cross, so there is no `Pending`, no scheduler and
// nothing here that knows what TypeScript is.
//
// **The work is `bundle.js`'s**, which is a module because three callers want exactly it — this,
// `bootstrap/js/assembleCommand.js`, and `packages/platform/build.ts`. What is left here is argv,
// reading files and printing, which is what a command is.
//
// **Plain JavaScript with no package imports**, because the machine running a bootstrap has deno or
// node and nothing else — no npm, no network, no bundler. That is the whole constraint the transform
// exists to satisfy, and a host that needed a package would defeat it.

import { bundleFiles } from "./bundle.js";

const DENO = typeof Deno !== "undefined";

// **`createRequire`, not a bare `require`.** The `import` above makes this an ES module, and
// `require` does not exist in one — Node reads a `.js` file with ESM syntax as a module. This file
// used a bare `require` while it had no imports at all, which is why it worked until it gained one.
const req = DENO ? null : (await import("node:module")).createRequire(import.meta.url);

const args = DENO ? Deno.args : process.argv.slice(2);

function writeErr(s) {
  if (DENO) Deno.stderr.writeSync(new TextEncoder().encode(s));
  else process.stderr.write(s);
}

function exit(c) {
  if (DENO) Deno.exit(c);
  else process.exit(c);
}

if (args.length < 2) {
  writeErr("usage: run.js <transform.wasm> <entry.ts> [more.ts ...]\n");
  writeErr("       packs the files into a zip, runs the transform, prints the bundle\n");
  exit(2);
}

function readFile(p) {
  if (DENO) return Deno.readFileSync(p);
  return new Uint8Array(req("fs").readFileSync(p));
}

const files = args.slice(1);
const r = bundleFiles(readFile(args[0]), files.map((f) => [f, readFile(f)]), files[0]);
if (!r.ok) {
  writeErr(r.error + "\n");
  exit(1);
}

if (DENO) Deno.stdout.writeSync(r.bytes);
else process.stdout.write(Buffer.from(r.bytes));
