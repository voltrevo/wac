import { fileSet } from "../../bootstrap/js/flatten.js";
import { files as ladderFiles } from "../../bootstrap/hosts/deno.js";
import { boot } from "../../bootstrap/hosts/deno.js";
import { flatten } from "../../bootstrap/js/flatten.js";
import { assemble } from "../../bootstrap/js/assemble.js";
import { wacc as driveWacc } from "../../bootstrap/js/wacc.js";
import {
  generate,
  parseAliases,
  parseBindTypes,
  parseCallbacks,
  parseOutRefs,
  parseSigs,
} from "../../packages/wacc/tools/waccBindgen.ts";

const ROOT = new URL("../..", import.meta.url).pathname;
const ENTRY = "packages/wacc/src/api.wac";

export async function buildWaccAsset(): Promise<string> {
  // **The ladder builds wacc, and wacc describes itself.** This used to ask the TypeScript reference
  // for the module and a reference-built wacc for the description, which is why the playground could
  // not compile the language's own spec examples — `issues/lang/0105`. The reference is deleted; the
  // ladder in `bootstrap/` builds wacc from five rungs of hand-written source, needing neither cargo
  // nor a `wac` on the machine, which is what lets this run in the Pages workflow.
  //
  // **Round 0 cannot be the asset.** wac-L5 emits no bindgen, so a module it builds exports no
  // `$bind$` helpers and the glue below would call functions that are not there. wacc *does* emit
  // them, so round 0 compiles wacc again and round 1 is what ships. The driver is concatenated onto
  // round 0 only, which is how it can be asked anything at all before a binding layer exists.
  const driver = await Deno.readTextFile(`${ROOT}/bootstrap/drivers/spec_cases.wac`);
  const l0 = await (await boot()).l5ToL0(
    await flatten(`${ROOT}/${ENTRY}`, ladderFiles) + "\n" + driver,
  );
  const refused = (l0.match(/^!!/gm) ?? []).length;
  if (refused > 0) throw new Error(`wac-L5 refused ${refused} thing(s) in wacc's own source`);

  const round0 = driveWacc(
    await WebAssembly.instantiate(
      await WebAssembly.compile(assemble(l0).buffer as ArrayBuffer),
      {},
    ),
  );

  const graph = await fileSet(`${ROOT}/${ENTRY}`, ladderFiles);
  const wasm = round0.emitFiles(graph.keys, graph.texts, graph.entry);
  if (wasm.length === 0) throw new Error(`the ladder built nothing for ${ENTRY}`);

  const wire = round0.bindTypes();
  return generate(
    wasm,
    parseSigs(round0.exportSigs()),
    parseBindTypes(wire),
    parseCallbacks(wire),
    parseOutRefs(wire),
    parseAliases(wire),
    { lang: "js" },
  );
}

/**
 * The five entry points `site/src/editor/wacc-compile.ts`'s `WaccModule` calls, and the module the
 * page runs. An asset missing any of them loads and then fails at the first compile.
 */
export const REQUIRED = [
  "diagnoseFiles",
  "blockedFiles",
  "emitFiles",
  "exportSigsFiles",
  "bindTypesFiles",
];

/**
 * Refuse to write an asset the page cannot use.
 *
 * **The page falls back to the reference when this file is absent**, deliberately, so a plain
 * checkout still works — and that fallback is a silent wrong answer for a *deploy*, which is what
 * `issues/system/0146` is about: the published playground used the reference compiler for a while
 * and said nothing. A missing `--import-map` made this script fail, which was loud; what is not
 * guarded is the quieter shape, where it exits 0 having written something unusable and the page
 * falls back exactly as it does for a checkout.
 *
 * So the check is on the *contract* rather than on a byte count: the names the page calls, and
 * evidence that the compiler itself is in there. A size floor alone would pass an asset with all
 * five functions renamed.
 */
export function checkAsset(glue: string): void {
  const missing = REQUIRED.filter((name) => !glue.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `wacc-api.js would not export ${missing.join(", ")} — the page's WaccModule calls those, so ` +
        `this asset would load and fail at the first compile. Nothing is written.`,
    );
  }
  // The module travels as base64, and it is most of the file. A build that emitted the bindings and
  // no module is the failure this catches: every name is present and there is no compiler.
  if (glue.length < 100_000) {
    throw new Error(
      `wacc-api.js would be ${(glue.length / 1024).toFixed(0)}K, which is too small to hold wacc's ` +
        `module — it is normally around 400K, nearly all of it the base64. Nothing is written.`,
    );
  }
}

if (import.meta.main) {
  const out = new URL("../public/wacc-api.js", import.meta.url).pathname;
  const t0 = Date.now();
  const glue = await buildWaccAsset();
  // Before the write, so a bad build leaves the previous asset alone rather than replacing a working
  // one with a broken one.
  checkAsset(glue);
  await Deno.mkdir(new URL("../public/", import.meta.url).pathname, { recursive: true });
  await Deno.writeTextFile(out, glue);
  console.log(
    `wacc-api.js  ${(glue.length / 1024).toFixed(0)}K  built in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  console.log("\nA page can import this and compile wac with wacc — including what only wacc has.");
}
