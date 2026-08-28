// wacc, built from source by the ladder, as a JavaScript module a host can import.
//
// **The bootstrap for everything on this side.** `harness/waccBuild.ts` said it plainly: *"wacc
// itself is built by the reference — the bootstrap has to start somewhere, and that somewhere is
// `wacBind` with `WAC_BIND_FROM=reference`."* The reference is deleted, and this is that somewhere
// now: five rungs whose lowest is hand-written wasm assembly text, each compiling the next, until
// wac-L5 compiles wacc.
//
// It needs neither cargo nor a `wac` on the machine — only a JavaScript host — which is what
// lets both the Pages workflow and a fresh checkout's test run use it.
//
// **Here rather than in `site/tools/`, where it was written.** `site/package.json` puts that subtree
// in an npm resolution scope, so a script under `harness/` importing from it resolves `wac/` as an
// npm package and fails; `site/` is excluded from the repo-wide Deno walks for the same reason.
// Two callers wanted it, and only one of them could be in there.

import { fileSet, flatten } from "../bootstrap/js/flatten.js";
import { boot, files as ladderFiles } from "../bootstrap/hosts/deno.js";
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
import { hashDir } from "./buildCache.ts";

const ROOT = decodeURIComponent(new URL("..", import.meta.url).pathname);
const ENTRY = "packages/wacc/src/api.wac";

/**
 * wacc's API, bound as JavaScript: the module base64'd with glue around it, importable with no
 * build step.
 *
 * **Round 0 cannot be the asset.** wac-L5 emits no bindgen, so a module it builds exports no
 * `$bind$` helpers and the glue would call functions that are not there. wacc *does* emit them, so
 * round 0 compiles wacc again and round 1 is what ships. The driver is concatenated onto round 0
 * only, which is how it can be asked anything at all before a binding layer exists.
 */
export async function buildWaccAsset(): Promise<string> {
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
  if (wasm.length === 0) {
    const why = round0.decline();
    throw new Error(
      `the ladder built nothing for ${ENTRY}${why === "" ? "" : ` — ${why}`}`,
    );
  }

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

let parts: string[] | null | undefined;

/**
 * What the asset depends on, for a cache key: **the ladder as well as wacc**.
 *
 * `waccKeyParts` hashes `packages/wacc/src`, which is what is being compiled. It is not enough on
 * its own — a change to a rung, to the assembler or to the flattener changes what comes out of the
 * same sources, and a key that could not see that would serve a stale compiler from the cache
 * with nothing to say it had.
 */
export async function ladderKeyParts(): Promise<string[] | null> {
  if (parts !== undefined) return parts;
  try {
    parts = [
      ...await hashDir(`${ROOT}/bootstrap/boot`.replace(/\/$/, ""), ".l0"),
      ...await hashDir(`${ROOT}/bootstrap/boot`.replace(/\/$/, ""), ".l1"),
      ...await hashDir(`${ROOT}/bootstrap/boot`.replace(/\/$/, ""), ".l2"),
      ...await hashDir(`${ROOT}/bootstrap/boot`.replace(/\/$/, ""), ".l3"),
      ...await hashDir(`${ROOT}/bootstrap/boot`.replace(/\/$/, ""), ".l4"),
      ...await hashDir(`${ROOT}/bootstrap/js`.replace(/\/$/, ""), ".js"),
      ...await hashDir(`${ROOT}/bootstrap/drivers`.replace(/\/$/, ""), ".wac"),
    ];
  } catch {
    // A missing `bootstrap/` is not something to paper over with a key that still hashes: the
    // caller cannot build wacc at all, and will say so with a better message than this could.
    parts = null;
  }
  return parts;
}
