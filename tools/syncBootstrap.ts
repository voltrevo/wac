// Build the two assets the bootstrap demo needs: wacc's own sources, and glue that can drive any
// stage of it.
//
//   deno run -A tools/syncBootstrap.ts
//
// The demo runs the whole chain in the browser — the reference compiler makes stage A, A compiles
// wacc's sources to make B, B compiles them again to make C, and B and C are compared. Three of
// those four steps need nothing from here: the reference compiler is already bundled into the site
// for the playground, and the sources are text.
//
// The fourth needs help. `wacBindgen` emits **TypeScript**, and it bakes one wasm binary into the
// module as base64 at generation time — so a page cannot make a module for stage B, whose bytes do
// not exist until the page has run stage A. Two problems, one shape: generate the glue here, replace
// the base64 with a placeholder, and transpile it with `tsc` so what the page fetches is JavaScript
// it can substitute into and `import()`.
//
// The interface is the same for every stage — same sources, same reference compiler — which is the
// property that makes one glue enough, and it is the same property `harness/wacBind.ts` relies on
// when it swaps wacc's code under the reference's metadata.

import { wacCompile } from "../compiler/wacCompile.ts";
import { wacBindgen } from "../compiler/wacBindgen.ts";
import { wacFiles } from "../harness/wacFiles.ts";

const ENTRY = "packages/wacc/src/api.wac";
const OUT = "site/public/";
/** What the page substitutes its own bytes into. Distinctive enough not to occur in the glue. */
const PLACEHOLDER = "__WACC_STAGE_WASM_BASE64__";

const files = await wacFiles(ENTRY);
const paths = [...files.keys()].sort();
const sources = paths.map((p) => files.get(p)!);
const bytes = sources.reduce((n, s) => n + s.length, 0);
console.log(`wacc's closure: ${paths.length} files, ${(bytes / 1024).toFixed(0)} KB`);

const result = wacCompile(files, ENTRY);
if (!result.ok) {
  const first = result.diagnostics.slice(0, 3).map((d) =>
    `  ${d.file}:${d.line}:${d.col} ${d.message}`).join("\n");
  throw new Error(`the reference cannot compile wacc, so the demo has no stage A:\n${first}`);
}

// The glue, with the binary taken back out. `wacBindgen` writes exactly one `atob("…")` for the
// module it was given, so the base64 is found by its own literal rather than by position.
const withA = wacBindgen(result.compiled);
const b64 = /atob\("([A-Za-z0-9+/=]+)"\)/.exec(withA);
if (b64 === null) throw new Error("no base64 payload in the generated glue — its shape changed");
const templated = withA.replace(b64[1], PLACEHOLDER);
if (!templated.includes(PLACEHOLDER)) throw new Error("the placeholder did not land");

await Deno.mkdir(OUT, { recursive: true });
const tmp = await Deno.makeTempDir({ prefix: "wacc-glue-" });
await Deno.writeTextFile(`${tmp}/glue.ts`, templated);
// `tsc`, not a regular expression over type annotations: the glue is generated, but "generated" is
// not "regular", and a stripper that is wrong once produces JavaScript that parses and misbehaves.
const tsc = new Deno.Command("./node_modules/.bin/tsc", {
  args: [
    `${tmp}/glue.ts`,
    "--target", "es2022",
    "--module", "esnext",
    "--moduleResolution", "bundler",
    "--outDir", tmp,
    "--skipLibCheck",
    "--ignoreConfig",
  ],
  cwd: "site",
  stdout: "piped",
  stderr: "piped",
});
const ran = await tsc.output();
const js = await Deno.readTextFile(`${tmp}/glue.js`).catch(() => null);
if (js === null) {
  throw new Error(`tsc emitted no JavaScript:\n${new TextDecoder().decode(ran.stdout)}`);
}
if (!js.includes(PLACEHOLDER)) throw new Error("tsc dropped the placeholder");

await Deno.writeTextFile(`${OUT}wacc-glue.js`, js);
await Deno.writeTextFile(
  `${OUT}wacc-sources.json`,
  JSON.stringify({ entry: ENTRY, paths, sources, placeholder: PLACEHOLDER }),
);
await Deno.remove(tmp, { recursive: true });

const size = async (p: string) => ((await Deno.stat(p)).size / 1024).toFixed(0);
console.log(`  wacc-glue.js: ${await size(`${OUT}wacc-glue.js`)}K`);
console.log(`  wacc-sources.json: ${await size(`${OUT}wacc-sources.json`)}K`);
console.log("  stage A is not shipped: the page compiles it with the reference compiler it has.");
