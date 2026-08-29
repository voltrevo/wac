// Assembling a self-contained `wac` out of a module, its glue and the bridge.
//
//     deno run -A bootstrap/js/assembleCommand.js <work> <transform.wasm> <glue.js> <out> <grants>
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
// Deno only. The Node target needs `entryNode.ts`, `runLauncherNode` and `node:worker_threads`
// rather than these three, and inventing that without running it would be worse than saying so.

const DENO = typeof Deno !== "undefined";

function args() {
  return DENO ? Deno.args : process.argv.slice(2);
}

function readText(p) {
  return DENO ? Deno.readTextFileSync(p) : require("fs").readFileSync(p, "utf8");
}

function writeText(p, s) {
  if (DENO) Deno.writeTextFileSync(p, s);
  else require("fs").writeFileSync(p, s);
}

function listDir(p) {
  return DENO
    ? [...Deno.readDirSync(p)].map((e) => e.name)
    : require("fs").readdirSync(p);
}

function mkdirp(p) {
  if (DENO) Deno.mkdirSync(p, { recursive: true });
  else require("fs").mkdirSync(p, { recursive: true });
}

function chmodX(p) {
  if (DENO) Deno.chmodSync(p, 0o755);
  else require("fs").chmodSync(p, 0o755);
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
 * Bundle one entry by running `packages/ts/host/run.js` over the working directory.
 *
 * **A subprocess rather than an import**, so there is one implementation of "drive the transform"
 * rather than two. `run.js` is the host `design/system/0009` specifies — bytes in, bytes out — and
 * calling it the way anybody else would is what keeps it honest.
 *
 * Every file in `work` is handed over, not just the ones this entry reaches. The bundler emits what
 * the entry imports, so the extra files cost bytes in the zip and nothing in the output — and it
 * saves writing a TypeScript import walker in plain JavaScript to answer a question the bundler
 * already answers.
 */
function bundle(runner, transform, work, entry) {
  const files = listDir(work)
    .filter((n) => n.endsWith(".ts") || n.endsWith(".js"))
    .map((n) => `${work}/${n}`);
  const argv = [`${RUN_JS}`, transform, `${work}/${entry}`, ...files];

  if (DENO) {
    const r = new Deno.Command(runner, { args: ["run", "-A", "--no-check", ...argv], stdout: "piped", stderr: "piped" }).outputSync();
    if (!r.success) die(`bundling ${entry} failed:\n${new TextDecoder().decode(r.stderr)}`);
    return new TextDecoder().decode(r.stdout);
  }
  const { execFileSync } = require("child_process");
  try {
    return execFileSync(runner, argv, { maxBuffer: 1 << 30 }).toString();
  } catch (e) {
    return die(`bundling ${entry} failed:\n${e.stderr ?? e.message}`);
  }
}

const [work, transform, glue, out, grantsJson] = args();
if (!out) die("usage: assembleCommand.js <work> <transform.wasm> <glue.js> <out> <grants-json>");
const grants = JSON.parse(grantsJson ?? "{}");

const ROOT = new URL("../..", import.meta.url).pathname;
const RUN_JS = `${ROOT}packages/ts/host/run.js`;
const HOST = `${ROOT}packages/platform/host`;
const RUNNER = DENO ? "deno" : "node";

mkdirp(work);
for (const name of listDir(HOST)) {
  if (name.endsWith(".ts")) writeText(`${work}/${name}`, readText(`${HOST}/${name}`));
}
writeText(`${work}/app.gen.js`, readText(glue));

// The worker imports the application *and* the bridge's worker loop. The loop is imported first on
// purpose: it installs the message handler as a side effect of being evaluated, and the application
// below it has a top-level await that would otherwise suspend before any handler exists.
writeText(
  `${work}/worker.ts`,
  `import { runAsWorkerEntry } from "./entry.ts";\n` +
    `import * as app from "./app.gen.js";\n` +
    `await runAsWorkerEntry(app, undefined);\n`,
);

// Program-independent — the same text for every build — but a built application cannot *find* it:
// `import.meta.url` is the built file, so a sibling lookup finds nothing and every module started by
// name is refused. `issues/system/0144`.
writeText(
  `${work}/childwasm.ts`,
  `import { childMain } from "./childWasm.ts";\n` +
    `await childMain(globalThis.__wacChildBytes);\n`,
);

const worker = "//wac-worker 1\n" + bundle(RUNNER, transform, work, "worker.ts");
const child = bundle(RUNNER, transform, work, "childwasm.ts");

writeText(
  `${work}/launcher.ts`,
  `import { runLauncher } from "./entry.ts";\n` +
    `await runLauncher(${JSON.stringify(worker)}, ${JSON.stringify(grants)}, ` +
    `${JSON.stringify(child)});\n`,
);
const launcher = bundle(RUNNER, transform, work, "launcher.ts");

// **The shebang states exactly the capabilities granted and nothing else**, which is only possible
// because the worker starts from a blob URL rather than from this file — see the note at the top.
//
// `--no-code-cache` is not a micro-optimisation. Deno keeps V8's compiled code for every script it
// runs, keyed on contents, and never evicts; a built command is a unique multi-megabyte script, so
// each one leaves an entry that can never be hit again. That cache had reached 28 GB on one machine
// — 97% of a shared disk — before anybody looked. wac-mono 0068.
const flags = ["--no-code-cache"];
if (grants.read) flags.push("--allow-read");
if (grants.write) flags.push("--allow-write");
// `--unstable-net` rides with the network grant: `Deno.listenDatagram` is the whole datagram
// capability on this host and does not exist without it. design/system 0007.
if (grants.net) flags.push("--allow-net", "--unstable-net");
if (grants.env) flags.push("--allow-env");
if (grants.run) flags.push("--allow-run");

writeText(out, `#!/usr/bin/env -S deno run ${flags.join(" ")}\n${launcher}`);
chmodX(out);
