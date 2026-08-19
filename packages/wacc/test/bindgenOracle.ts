#!/usr/bin/env -S deno run -A
// `packages/wacc/tools/waccBindgen.ts`, behind a command line.
//
// **This is one half of a differential, not a harness.** `waccBindgen.ts` is the last piece of the
// toolchain that exists only in TypeScript, and `src/bindgen.wac` is the port of it; the bar is that
// the two write byte-identical glue. So the TypeScript generator has to stay TypeScript — it is the
// thing being compared — and this is the smallest wrapper that lets a wac test ask it a question.
//
// It has no CLI of its own (`waccx bindgen` is a different entry point), and the test that used to
// drive it called `generate` and its five parsers in process. Everything those parsers are fed comes
// out of wacc itself, so this does the same walk and prints the answer.
//
//   bindgenOracle.ts files <entry.wac> <ts|js>
//   bindgenOracle.ts wire <wasm-hex> <sigs-file> <wire-file> <ts|js>
//
// The glue goes to standard output verbatim. Nothing here decides whether it is right.

import { waccApi } from "../../../harness/waccBuild.ts";
import {
  generate,
  parseAliases,
  parseBindTypes,
  parseCallbacks,
  parseOutRefs,
  parseSigs,
} from "../tools/waccBindgen.ts";

type Api = {
  emitFiles(paths: string[], sources: string[], entry: string): Uint8Array;
  exportSigsFiles(paths: string[], sources: string[], entry: string): string;
  bindTypesFiles(paths: string[], sources: string[], entry: string): string;
};

const unhex = (s: string): Uint8Array =>
  s.length === 0 ? new Uint8Array(0) : Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));

const [mode, ...rest] = Deno.args;
const api = await waccApi() as unknown as Api;

if (mode === "files") {
  const [entry, lang] = rest;
  const { wacFiles } = await import("../../../harness/wacFiles.ts");
  const files = await wacFiles(entry);
  const paths = [...files.keys()];
  const sources = paths.map((p) => files.get(p)!);
  const wasm = Uint8Array.from(api.emitFiles(paths, sources, entry) as unknown as number[]);
  const wire = api.bindTypesFiles(paths, sources, entry);
  const out = generate(
    wasm,
    parseSigs(api.exportSigsFiles(paths, sources, entry)),
    parseBindTypes(wire),
    parseCallbacks(wire),
    parseOutRefs(wire),
    parseAliases(wire),
    { lang: lang as "ts" | "js" },
  );
  await Deno.stdout.write(new TextEncoder().encode(out));
} else if (mode === "wire") {
  // A wire written by hand, for a shape no program can be made to produce on demand.
  const [wasmHex, sigsPath, wirePath, lang] = rest;
  const sigs = await Deno.readTextFile(sigsPath);
  const wire = await Deno.readTextFile(wirePath);
  const out = generate(
    unhex(wasmHex),
    parseSigs(sigs),
    parseBindTypes(wire),
    parseCallbacks(wire),
    parseOutRefs(wire),
    parseAliases(wire),
    { lang: lang as "ts" | "js" },
  );
  await Deno.stdout.write(new TextEncoder().encode(out));
} else {
  console.error("usage: bindgenOracle.ts files <entry.wac> <ts|js>");
  console.error("       bindgenOracle.ts wire <wasm-hex> <sigs-file> <wire-file> <ts|js>");
  Deno.exit(2);
}
