// What the Tor client costs: to ship, and to compile.
//
//   wac task size
//
// The layers are compiled separately and each pulls its own dependencies, so they do not
// sum to the total — TLS and the Tor protocol share most of the crypto, and the shared part
// is counted twice if you add them up. The interesting numbers are the total and the gap
// between it and each layer.
//
// Times are the median of five runs after a warm-up, so they measure the compiler rather
// than V8 deciding to optimise it. A genuinely cold run is roughly twice as slow: the first
// compile in a fresh process pays for the JIT as well as the work.
//
// **Both numbers are wacc's**, because wacc is what builds an application now: a size measured on
// the reference's output is a size of bytes nobody runs, and a time measured on the reference is
// how long a compiler nobody invokes takes. Figures recorded before 2026-08-12 are the reference's
// and are not comparable — the compiler changed, not the program. `issues/lang/0105`.

import { waccApi, waccArtifacts } from "../harness/waccBuild.ts";
import { wacFiles } from "../harness/wacFiles.ts";

const gzip = async (b: Uint8Array) =>
  new Uint8Array(await new Response(
    new Blob([b as BlobPart]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer());

const TARGETS: [string, string][] = [
  ["packages/tor/size/proto_only.wac", "cells + path selection, no crypto"],
  ["packages/tor/size/tor_only.wac", "tor protocol + its crypto"],
  ["packages/tor/size/tls_only.wac", "TLS 1.3 client + its crypto"],
  ["packages/tor/src/client_entry.wac", "the whole client"],
];

console.log(
  "layer".padEnd(36) + "     wasm     gzipped     lines    compile",
);
console.log("-".repeat(76));
const broken: string[] = [];
for (const [entry, label] of TARGETS) {
  // **Asked in two parts**, because wacc answers them separately: the checker's diagnostics, then
  // what the emitter declined. The cast that used to be here said `{ ok, compiled? }` and nothing
  // else, so the diagnostics this branch exists to print were a property it had thrown away — it
  // reported nothing, silently, in exactly the case the tool is for.
  const files0 = await wacFiles(entry);
  const paths0 = [...files0.keys()];
  const sources0 = paths0.map((p) => files0.get(p)!);
  const api = await waccApi();
  const diagnostics = api.diagnoseFiles(paths0, sources0, entry);
  const blocked = diagnostics === "" ? api.blockedFiles(paths0, sources0, entry) : "";
  if (diagnostics !== "" || blocked !== "") {
    // Loudly, and non-zero at the end. A size report that prints "did not compile" and
    // exits 0 is green to everything that checks exit codes while measuring nothing —
    // three of these four layers were broken for some time and this is what said so.
    console.log(`${label.padEnd(36)}  did not compile`);
    for (const line of (diagnostics === "" ? blocked : diagnostics).split("\n")) {
      if (line !== "") console.log(`    ${line}`);
    }
    broken.push(entry);
    continue;
  }

  const times: number[] = [];
  let lines = 0;
  for (let i = 0; i < 5; i++) {
    const files = await wacFiles(entry) as Map<string, string>;
    if (i === 0) {
      lines = [...files.values()].reduce((n, src) => n + src.split("\n").length, 0);
    }
    const paths = [...files.keys()];
    const sources = paths.map((p) => files.get(p)!);
    const t0 = performance.now();
    api.emitFiles(paths, sources, entry);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);

  const wasm = (await waccArtifacts(files0, entry)).wasm;
  const gz = await gzip(wasm);
  console.log(
    label.padEnd(36) +
    `${(wasm.length / 1024).toFixed(1).padStart(8)} KiB` +
    `${(gz.length / 1024).toFixed(1).padStart(9)} KiB` +
    `${String(lines).padStart(10)}` +
    `${times[2].toFixed(0).padStart(9)} ms`,
  );
}

if (broken.length > 0) {
  console.error(`\n${broken.length} of ${TARGETS.length} layers did not compile:`);
  for (const b of broken) console.error(`  ${b}`);
  Deno.exit(1);
}
