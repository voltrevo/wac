// The committed copy of the compiler the website's bootstrap demo runs.
//
// `site/public/wacc-sources.json` is `packages/wacc/src/api.wac` and everything it imports, written
// out by `tools/syncBootstrap.ts` so the demo can compile wacc with wacc in a browser tab. It is
// committed, which is right — a checkout builds the site without regenerating it — and committed
// artefacts rot.
//
// It had. On 2026-08-17 the file held **eleven** sources and the graph was **fifteen**: `bindgen`,
// `files`, `manifest` and `render` were added after 2026-08-11 and never reached the page, so the
// byte counts the demo printed were six days old and every number beside them was current. Nothing
// compared the two, and the deploy had stopped regenerating it — `site/package.json`'s `build`
// script runs `syncBootstrap` first, and the workflow called `tsc -b` and `vite build` directly.
//
// This cannot run `syncBootstrap` to compare, because that shells out to the site's own `tsc` and
// needs `npm ci` first, which the suite does not do. What it can do is the part that actually rots:
// **the file list**. A source added to the compiler is the change that goes unnoticed; the contents
// of a file that is already listed are refreshed by the deploy the moment the list is right.
//
// Lives here rather than under `site/` because `site/` is excluded from the suite — a vite subtree
// with its own resolver — so a guard placed there is one nothing runs.

import { docTest } from "./docCheck.ts";
import { wacFiles } from "../harness/wacFiles.ts";

const ASSET = "site/public/wacc-sources.json";

docTest("the bootstrap demo's copy of the compiler lists every source", async () => {
  const asset = JSON.parse(await Deno.readTextFile(ASSET)) as { entry: string; paths: string[] };
  const graph = [...(await wacFiles(asset.entry)).keys()];

  const missing = graph.filter((p) => !asset.paths.includes(p));
  const extra = asset.paths.filter((p) => !graph.includes(p));
  if (missing.length === 0 && extra.length === 0) return;

  const say = (label: string, xs: string[]) =>
    xs.length === 0 ? "" : `\n  ${label}: ${xs.map((p) => p.split("/").pop()).join(", ")}`;
  throw new Error(
    `${ASSET} is ${asset.paths.length} sources and the graph from ${asset.entry} is ` +
      `${graph.length}. The demo would compile a different compiler from the one in the tree.` +
      say("in the tree, absent from the asset", missing) +
      say("in the asset, gone from the tree", extra) +
      "\n  Regenerate: cd site && npm ci && deno run -A ../tools/syncBootstrap.ts",
  );
});
