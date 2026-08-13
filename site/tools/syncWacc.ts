// wacc as a single file a page can import.
//
// The playground compiles whatever a reader types, and it has always done that with the *reference*
// compiler, because a browser can import JavaScript and the reference is TypeScript this site's build
// transpiles. So the playground cannot accept anything the reference does not have — JSX, components,
// fragments, an omitted nullable field, the bit methods. The language's own spec examples do not
// compile in the language's own playground. `issues/lang/0105`.
//
// This writes the other half: `public/wacc-api.js`, holding wacc's module as base64 and the bindings
// for its API, in JavaScript, with no transpile step in between.
//
//   deno run -A site/tools/syncWacc.ts
//
// **The reference compiles wacc, and that is the only thing it is for** (`design/lang/0003`). What
// generates the glue is *wacc's own* bindgen in its JavaScript mode — the mode exists for this — so
// the artefact is the seed's output described by the compiler it seeds.
//
// Written into `public/`, which is gitignored: it is build output, like the demos `syncDemos.ts`
// makes, and CI rebuilds it on every deploy.

import { wacCompile } from "../../compiler/wacCompile.ts";
import { wacFiles } from "../../harness/wacFiles.ts";
import { waccApi } from "../../harness/waccBuild.ts";
import {
  generate,
  parseAliases,
  parseBindTypes,
  parseCallbacks,
  parseOutRefs,
  parseSigs,
} from "../../packages/wacc/tools/waccBindgen.ts";

const ENTRY = "packages/wacc/src/api.wac";

/** The compiler as one importable file: its module inline, its API bound. */
export async function buildWaccAsset(): Promise<string> {
  const files = await wacFiles(ENTRY);
  const paths = [...files.keys()];
  const sources = paths.map((p) => files.get(p)!);

  const r = wacCompile(files, ENTRY);
  if (!r.ok) {
    throw new Error(
      `the seed could not compile wacc:\n` +
        r.diagnostics.slice(0, 6).map((d) => `  ${d.file}:${d.line} ${d.message}`).join("\n"),
    );
  }

  // The description comes from wacc rather than from the reference: the two agree on this interface —
  // that is what `harness/wacBind.ts` relies on to run one compiler's code against the other's
  // metadata — and asking wacc keeps the wire format in one place.
  const api = await waccApi();
  const wire = api.bindTypesFiles(paths, sources, ENTRY);
  return generate(
    r.compiled.wasm,
    parseSigs(api.exportSigsFiles(paths, sources, ENTRY)),
    parseBindTypes(wire),
    parseCallbacks(wire),
    parseOutRefs(wire),
    parseAliases(wire),
    { lang: "js" },
  );
}

if (import.meta.main) {
  const out = new URL("../public/wacc-api.js", import.meta.url).pathname;
  const t0 = Date.now();
  const glue = await buildWaccAsset();
  await Deno.mkdir(new URL("../public/", import.meta.url).pathname, { recursive: true });
  await Deno.writeTextFile(out, glue);
  console.log(
    `wacc-api.js  ${(glue.length / 1024).toFixed(0)}K  built in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  console.log("\nA page can import this and compile wac with wacc — including what only wacc has.");
}
