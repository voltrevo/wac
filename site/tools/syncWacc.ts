// Generate `site/public/wacc-api.js` — wacc, bound as a module the playground can import.
//
// The build itself is `harness/waccFromLadder.ts`, which `harness/waccBuild.ts` also uses to
// bootstrap the Deno side. It lived here first and moved out when the second caller appeared:
// `site/package.json` puts this subtree in an npm resolution scope, so nothing under `harness/`
// can import from it.
//
// What stays here is the part that is about *this asset*: where it goes, and the contract the page
// depends on.

import { buildWaccAsset } from "../../harness/waccFromLadder.ts";

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
