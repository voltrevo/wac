import { fileSet } from "../bootstrap/js/flatten.js";
import { boot, files as ladderFiles } from "../bootstrap/hosts/deno.js";
import { flatten } from "../bootstrap/js/flatten.js";
import { assemble } from "../bootstrap/js/assemble.js";
import { wacc as driveWacc } from "../bootstrap/js/wacc.js";
import {
  generate,
  parseAliases,
  parseBindTypes,
  parseCallbacks,
  parseOutRefs,
  parseSigs,
} from "../packages/wacc/tools/waccBindgen.ts";

Deno.chdir(new URL("..", import.meta.url).pathname);

const ENTRY = "packages/wacc/src/api.wac";
const OUT = "site/public/";
const PLACEHOLDER = "__WACC_STAGE_WASM_BASE64__";

// **The ladder builds stage A.** This asked the TypeScript reference to compile wacc — "the
// reference cannot compile wacc, so the demo has no stage A" was the error. The reference is
// deleted; `bootstrap/` builds wacc from five rungs of hand-written source, needing neither cargo
// nor a `wac` on the machine, which is what lets `npm run build` do it.
//
// Round 0 emits no bindgen — wac-L5 does not — so round 1, compiled *by* round 0, is what carries a
// binding layer and is what the demo swaps stages into.
const driver = await Deno.readTextFile("bootstrap/drivers/spec_cases.wac");
const l5Input = await flatten(ENTRY, ladderFiles) + "\n" + driver;
const l0 = await (await boot()).l5ToL0(l5Input);
const refused = (l0.match(/^!!/gm) ?? []).length;
if (refused > 0) throw new Error(`wac-L5 refused ${refused} thing(s) in wacc's own source`);

const round0 = driveWacc(
  await WebAssembly.instantiate(await WebAssembly.compile(assemble(l0).buffer as ArrayBuffer), {}),
);

const graph = await fileSet(ENTRY, ladderFiles);
const paths = graph.keys;
const sources = graph.texts;
const bytes = sources.reduce((n: number, s: string) => n + s.length, 0);

// The entry must name one of the files shipped beside it. Asserted because when it does not, wacc
// answers with an empty module and no complaint — an 8-byte wasm header — and the failure surfaces
// three steps later as a page that cannot instantiate what it built.
if (!paths.includes(graph.entry)) {
  throw new Error(`the entry ${graph.entry} is not among the ${paths.length} files shipped with it`);
}
console.log(`wacc's closure: ${paths.length} files, ${(bytes / 1024).toFixed(0)} KB`);

const wasm = round0.emitFiles(paths, sources, graph.entry);
if (wasm.length === 0) throw new Error(`the ladder built nothing for ${ENTRY}`);

// **JavaScript directly, so no `tsc` subprocess.** wacc's bindgen has a JS mode; the reference's
// emitted TypeScript, which is the only reason this shelled out to `./node_modules/.bin/tsc` and
// then checked the placeholder had survived the transpile.
const wire = round0.bindTypes();
const withA = generate(
  wasm,
  parseSigs(round0.exportSigs()),
  parseBindTypes(wire),
  parseCallbacks(wire),
  parseOutRefs(wire),
  parseAliases(wire),
  { lang: "js" },
);

// **`const WASM = "…"`, not `atob("…")`.** The reference's bindgen inlined the base64 in the call;
// wacc's names it first. The check below is the one that caught the difference, which is what an
// error message saying "its shape changed" is for.
const b64 = /const WASM = "([A-Za-z0-9+/=]+)"/.exec(withA);
if (b64 === null) throw new Error("no base64 payload in the generated glue — its shape changed");
const templated = withA.replace(b64[1], PLACEHOLDER);
if (!templated.includes(PLACEHOLDER)) throw new Error("the placeholder did not land");

await Deno.mkdir(OUT, { recursive: true });

// **No transpile step.** `generate(..., { lang: "js" })` already answered JavaScript, so what was
// here — a temp directory, `./node_modules/.bin/tsc` as a subprocess, reading its output back, and a
// second check that the placeholder had survived it — is gone with the compiler whose bindgen only
// emitted TypeScript.
const js = templated;
await Deno.writeTextFile(`${OUT}wacc-glue.js`, js);
// **The ladder's own sources, so the page can build stage A rather than be handed it.** The demo
// used to start from the TypeScript reference, which was "already bundled here for the playground"
// — it is not, and it is deleted. These five files are the whole of the compiler's root: the lowest
// is hand-written wasm assembly text, and each compiles the next.
const RUNGS = ["l1.l0", "l2.l1", "l3.l2", "l4.l3", "l5.l4"];
const rungs: Record<string, string> = {};
for (const r of RUNGS) rungs[r] = await Deno.readTextFile(`bootstrap/boot/${r}`);
const rungBytes = Object.values(rungs).reduce((n, s) => n + s.length, 0);
console.log(`  the ladder: ${RUNGS.length} rungs, ${(rungBytes / 1024).toFixed(0)} KB`);

await Deno.writeTextFile(`${OUT}wacc-rungs.json`, JSON.stringify(rungs));

// **What wac-L5 eats, flattened here because the page cannot flatten.** wac-L5 has no imports, so
// wacc's graph has to arrive as one source; the driver is concatenated on because the wacc wac-L5
// builds emits no bindgen and has to be driven byte-at-a-time. The browser has no filesystem to
// walk, so the walk happens here and the page fetches the answer.
await Deno.writeTextFile(`${OUT}wacc-l5-input.wac`, l5Input);
console.log(`  wacc-l5-input.wac: ${(l5Input.length / 1024).toFixed(0)}K (flattened, + driver)`);

await Deno.writeTextFile(
  `${OUT}wacc-sources.json`,
  // **`graph.entry`, not `ENTRY`.** `fileSet` keys the graph relative to its own common root, so
  // the entry as a command line writes it — `packages/wacc/src/api.wac` — names none of these
  // files; the key is `wacc/src/api.wac`. Shipping the unrelated spelling made the entry absent
  // from its own file set, and wacc answers that with an empty module rather than a complaint.
  JSON.stringify({ entry: graph.entry, paths, sources, placeholder: PLACEHOLDER }),
);

const size = async (p: string) => ((await Deno.stat(p)).size / 1024).toFixed(0);
console.log(`  wacc-glue.js: ${await size(`${OUT}wacc-glue.js`)}K`);
console.log(`  wacc-sources.json: ${await size(`${OUT}wacc-sources.json`)}K`);
console.log("  stage A is not shipped: the page builds it, by running the ladder itself.");
