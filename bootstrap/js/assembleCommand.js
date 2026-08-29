// Assembling a self-contained `wac` out of a module, its glue and the bridge.
//
//     deno run -A bootstrap/js/assembleCommand.js <work> <transform.wasm> <glue.js> <out> <grants> [deno|node]
//
// `design/system/0009` step 5, and the last piece of `bootstrap.sh --host deno`. Everything before
// this is the ladder: it builds wacc from five rungs of hand-written source, compiles the `wac`
// command with it, and — since 2026-08-29 — asks it for the JavaScript binding layer too. What is
// left is a file somebody can run, and that is three bundles and a shebang.
//
// ## Why this is not `packages/platform/build.ts`
//
// That file does exactly this for its `deno` target and is the shape copied here. It cannot be used:
// it is TypeScript, and a bootstrap that needed TypeScript to build a compiler would be the loop
// this whole design exists to cut. It also shells out to `deno bundle`, which fetches
// `@esbuild/<platform>` from npm on first use — and `bootstrap.sh` has to work offline.
//
// So the bundling here is `packages/ts`, written in wac and built by the ladder from source. The
// duplication is real and is named in `design/system/0009`; `bootstrap/MIGRATION.md` already accepts
// the same shape for `bootstrap/js/flatten.js` against `harness/wacFiles.ts`. The mitigation is that
// this one runs on every `--host deno` build, so it cannot rot quietly.
//
// The *bundling* itself is not duplicated: `packages/ts/host/bundle.js` is the one implementation
// and `run.js`, this file and `build.ts` all call it. This spawned `run.js` as a subprocess for a
// few hours on the argument that calling it as anybody else would keeps it honest — which was a
// worse trade than it sounded: a subprocess per bundle, three per build, to avoid an import.
//
// ## The three bundles
//
// A launcher carries a worker as a *string* and starts it from a blob URL. That is not indirection
// for its own sake: self-spawning would need `--allow-read` in every shebang whatever the program
// could do, which reads as a filesystem grant to anyone auditing it.
//
//   worker     the bridge plus the application — where the wasm actually runs
//   childwasm  the generic entry for a *module* started by `spawn`, program-independent
//   launcher   the bridge plus the two strings above, and the only one with a shebang
//
// **Both targets, and they are three *different* bundles rather than the same three run twice.** Node
// has no permission system, so its shebang states nothing and the capability world is the whole
// boundary; it reaches `node:worker_threads` and `node:fs/promises` where Deno reaches `Deno.*`
// directly; and its network is `host/nodeNet.js`, built out of `node:net` and `node:dgram`, because
// `Deno.connect` has no Node equivalent. `packages/platform/build.ts` makes the same distinction in
// the same three places.

import { bundleFiles } from "../../packages/ts/host/bundle.js";

const DENO = typeof Deno !== "undefined";

// **`createRequire`, not a bare `require`.** This file uses `import.meta.url`, so Node loads it as an
// ES module — and `require` does not exist in one. The first version called `require("fs")` and died
// with *require is not defined in ES module scope* after the ladder had already done its work,
// which is a late place to find out. `packages/ts/host/run.js` gets away with a bare
// `require` because it has no ESM syntax at all and Node therefore treats it as CommonJS.
const req = DENO ? null : (await import("node:module")).createRequire(import.meta.url);

function args() {
  return DENO ? Deno.args : process.argv.slice(2);
}

function readBytes(p) {
  return DENO ? Deno.readFileSync(p) : new Uint8Array(req("fs").readFileSync(p));
}

function readText(p) {
  return DENO ? Deno.readTextFileSync(p) : req("fs").readFileSync(p, "utf8");
}

function writeText(p, s) {
  if (DENO) Deno.writeTextFileSync(p, s);
  else req("fs").writeFileSync(p, s);
}

function listDir(p) {
  return DENO
    ? [...Deno.readDirSync(p)].map((e) => e.name)
    : req("fs").readdirSync(p);
}

function mkdirp(p) {
  if (DENO) Deno.mkdirSync(p, { recursive: true });
  else req("fs").mkdirSync(p, { recursive: true });
}

function chmodX(p) {
  if (DENO) Deno.chmodSync(p, 0o755);
  else req("fs").chmodSync(p, 0o755);
}

function die(msg) {
  const w = DENO
    ? (s) => Deno.stderr.writeSync(new TextEncoder().encode(s))
    : (s) => process.stderr.write(s);
  w(`assembleCommand: ${msg}\n`);
  if (DENO) Deno.exit(1);
  else process.exit(1);
}

/**
 * Bundle one entry out of the working directory.
 *
 * Every file in `work` is handed over, not just the ones this entry reaches. The bundler emits what
 * the entry imports, so the extra files cost bytes in the zip and nothing in the output — and it
 * saves writing a TypeScript import walker in plain JavaScript to answer a question the bundler
 * already answers.
 */
function bundle(transformWasm, work, entry) {
  const files = listDir(work)
    .filter((n) => n.endsWith(".ts") || n.endsWith(".js"))
    .map((n) => [`${work}/${n}`, readBytes(`${work}/${n}`)]);
  const r = bundleFiles(transformWasm, files, `${work}/${entry}`);
  if (!r.ok) die(`bundling ${entry} failed:\n${r.error}`);
  return new TextDecoder().decode(r.bytes);
}

const [work, transform, glue, out, grantsJson, targetArg] = args();
if (!out) die("usage: assembleCommand.js <work> <transform.wasm> <glue.js> <out> <grants> [target]");
const grants = JSON.parse(grantsJson ?? "{}");
// The *target* is what the built command will run on, and the *runner* is what is building it. They
// are usually the same and need not be: a Deno process can assemble a Node command, and the
// bootstrap does exactly that when `deno` is what is on the machine.
const target = targetArg === "node" ? "node" : "deno";
if (target !== "deno" && target !== "node") die(`unknown target ${target}`);

const ROOT = new URL("../..", import.meta.url).pathname;
const HOST = `${ROOT}packages/platform/host`;

mkdirp(work);
for (const name of listDir(HOST)) {
  if (name.endsWith(".ts")) writeText(`${work}/${name}`, readText(`${HOST}/${name}`));
}
writeText(`${work}/app.gen.js`, readText(glue));
// `nodeNet.js` is the one `.js` in the bridge; the copy loop above takes `.ts` only.
writeText(`${work}/nodeNet.js`, readText(`${HOST}/nodeNet.js`));

// The worker imports the application *and* the bridge's worker loop. The loop is imported first on
// purpose: it installs the message handler as a side effect of being evaluated, and the application
// below it has a top-level await that would otherwise suspend before any handler exists.
//
// Node's takes `wt` as its first argument because a worker there reaches its parent through
// `worker_threads.parentPort`, where Deno's is `self`.
writeText(
  `${work}/worker.ts`,
  target === "node"
    ? `import { runAsWorkerEntryNode } from "./entryNode.ts";\n` +
      `import * as wt from "node:worker_threads";\n` +
      `import * as app from "./app.gen.js";\n` +
      `runAsWorkerEntryNode(wt, app);\n`
    : `import { runAsWorkerEntry } from "./entry.ts";\n` +
      `import * as app from "./app.gen.js";\n` +
      `await runAsWorkerEntry(app, undefined);\n`,
);

// Program-independent — the same text for every build — but a built application cannot *find* it:
// `import.meta.url` is the built file, so a sibling lookup finds nothing and every module started by
// name is refused. `issues/system/0144`.
writeText(
  `${work}/childwasm.ts`,
  target === "node"
    ? `import { childMainNode } from "./childWasmNode.ts";\n` +
      `import * as wt from "node:worker_threads";\n` +
      `await childMainNode(wt, globalThis.__wacChildBytes);\n`
    : `import { childMain } from "./childWasm.ts";\n` +
      `await childMain(globalThis.__wacChildBytes);\n`,
);

const transformWasm = readBytes(transform);
const worker = "//wac-worker 1\n" + bundle(transformWasm, work, "worker.ts");
const child = bundle(transformWasm, work, "childwasm.ts");

// **The network import is present only when the network is granted**, which is the same discipline
// as the shebang: an ungranted capability is absent rather than refused at the call. `nodeNet` is a
// file rather than 93 inlined lines precisely so this and `build.ts` share one copy.
//
// The sixth argument is passed as `undefined` rather than omitted when there is no network grant.
// It used to be left off, which is fine while it is last and silently hands the next argument added
// to the network the day one is.
writeText(
  `${work}/launcher.ts`,
  target === "node"
    ? (grants.net ? `import { nodeNet } from "./nodeNet.js";\n` : "") +
      `import { runLauncherNode } from "./entryNode.ts";\n` +
      `import * as wt from "node:worker_threads";\n` +
      `import { readFile, writeFile, stat, lstat, chmod, readdir, mkdir, rm, rename, open } ` +
      `from "node:fs/promises";\n` +
      `await runLauncherNode(\n` +
      `  wt,\n` +
      `  { readFile, writeFile, stat, lstat, chmod, readdir, mkdir, rm, rename, open },\n` +
      `  process,\n` +
      `  ${JSON.stringify(worker)},\n` +
      `  ${JSON.stringify(grants)},\n` +
      `  ${grants.net ? "nodeNet" : "undefined"},\n` +
      `  ${JSON.stringify(child)},\n` +
      `);\n`
    : `import { runLauncher } from "./entry.ts";\n` +
      `await runLauncher(${JSON.stringify(worker)}, ${JSON.stringify(grants)}, ` +
      `${JSON.stringify(child)});\n`,
);
const launcher = bundle(transformWasm, work, "launcher.ts");

// **The shebang states exactly the capabilities granted and nothing else**, which is only possible
// because the worker starts from a blob URL rather than from this file — see the note at the top.
//
// `--no-code-cache` is not a micro-optimisation. Deno keeps V8's compiled code for every script it
// runs, keyed on contents, and never evicts; a built command is a unique multi-megabyte script, so
// each one leaves an entry that can never be hit again. That cache had reached 28 GB on one machine
// — 97% of a shared disk — before anybody looked. wac-mono 0068.
// **Node's shebang states nothing**, and that is not an oversight: Node has no permission system, so
// the capability world inside the module is the whole boundary there. A Deno one names exactly the
// grants and nothing else.
let shebang;
if (target === "node") {
  shebang = "#!/usr/bin/env node\n";
} else {
  const flags = ["--no-code-cache"];
  if (grants.read) flags.push("--allow-read");
  if (grants.write) flags.push("--allow-write");
  // `--unstable-net` rides with the network grant: `Deno.listenDatagram` is the whole datagram
  // capability on this host and does not exist without it. design/system 0007.
  if (grants.net) flags.push("--allow-net", "--unstable-net");
  if (grants.env) flags.push("--allow-env");
  if (grants.run) flags.push("--allow-run");
  shebang = `#!/usr/bin/env -S deno run ${flags.join(" ")}\n`;
}

writeText(out, `${shebang}${launcher}`);
chmodX(out);
