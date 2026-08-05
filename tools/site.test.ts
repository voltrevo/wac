// The website's code, compiled.
//
// Every snippet on the site is a claim about the compiler, and until now nothing checked any of
// them. The playground shipped whatever was in `examples.ts`, and the landing page's prose
// asserted things — "these two files compile to byte-identical wasm" — that were true when
// written and had no way to stay true.
//
// This runs the playground's examples through the same `wacCompile` the page calls, and checks
// the landing page's paired snippets against the claim printed next to them.
//
//   deno test -A tools/site.test.ts

import { wacCompile } from "../atoms/wac/wacCompile.ts";
import { EXAMPLES } from "../src/editor/examples.ts";

const LANDING = new URL("../src/Landing.tsx", import.meta.url);

function compile(files: Record<string, string>, entry: string) {
  return wacCompile(new Map(Object.entries(files)), entry);
}

Deno.test("site: every playground example compiles", () => {
  const broken: string[] = [];
  for (const ex of EXAMPLES) {
    const r = compile(ex.files, ex.entry);
    if (!r.ok) {
      const d = r.diagnostics[0];
      broken.push(`${ex.name} (${ex.category}) — ${d.file}:${d.line}:${d.col} ${d.message}`);
    }
  }
  if (broken.length) throw new Error(`${broken.length} of ${EXAMPLES.length}:\n  ${broken.join("\n  ")}`);
  if (EXAMPLES.length < 20) throw new Error(`only ${EXAMPLES.length} examples — did the import resolve?`);
});

Deno.test("site: every example's entry is one of its own files", () => {
  for (const ex of EXAMPLES) {
    if (!(ex.entry in ex.files)) {
      throw new Error(`${ex.name}: entry ${ex.entry} is not among ${Object.keys(ex.files).join(", ")}`);
    }
  }
});

Deno.test("site: an example's extension matches the surface it is written in", () => {
  // A `.wac` file full of `def` would compile as neither, but a `.wapy` file of braces very
  // nearly parses as wapy and would fail somewhere obscure. Cheap to rule out.
  for (const ex of EXAMPLES) {
    for (const [path, src] of Object.entries(ex.files)) {
      const looksWapy = /^\s*(@export\s*$|def |class )/m.test(src);
      const looksWac = /^\s*(export\s+)?(struct|enum|i32|i64|f32|f64|bool|string|void)\s+\w+\s*[({]/m.test(src);
      if (path.endsWith(".wapy") && looksWac && !looksWapy) {
        throw new Error(`${ex.name}: ${path} is named .wapy but reads as wac`);
      }
      if (path.endsWith(".wac") && looksWapy && !looksWac) {
        throw new Error(`${ex.name}: ${path} is named .wac but reads as wapy`);
      }
    }
  }
});

/** A template literal assigned to `const <name> = ` … `, with its escapes undone. */
async function snippet(name: string): Promise<string> {
  const src = await Deno.readTextFile(LANDING);
  const open = `const ${name} = \``;
  const at = src.indexOf(open);
  if (at < 0) throw new Error(`Landing.tsx has no ${name}`);
  let i = at + open.length;
  const start = i;
  while (i < src.length) {
    if (src[i] === "\\") { i += 2; continue; }
    if (src[i] === "`") break;
    i++;
  }
  return src.slice(start, i)
    .replace(/\\`/g, "`")
    .replace(/\\\$/g, "$")
    .replace(/\\\\/g, "\\");
}

Deno.test("site: the landing page's runnable snippets compile", async () => {
  for (const [name, file] of [
    ["EX_SURFACE_WAC", "a.wac"],
    ["EX_SURFACE_WAPY", "a.wapy"],
    ["EX_WAPY_LIVE", "a.wapy"],
  ] as const) {
    const r = compile({ [file]: await snippet(name) }, file);
    if (!r.ok) {
      const d = r.diagnostics[0];
      throw new Error(`${name}: ${d.line}:${d.col} ${d.message}`);
    }
  }
});

Deno.test("site: the two surface snippets emit byte-identical wasm, as the page says", async () => {
  // The page prints this as its central claim about wapy. If the pair ever drifts — someone
  // edits one side, or the printer changes — the sentence becomes false and this goes red.
  const a = compile({ "a.wac": await snippet("EX_SURFACE_WAC") }, "a.wac");
  const b = compile({ "a.wapy": await snippet("EX_SURFACE_WAPY") }, "a.wapy");
  if (!a.ok || !b.ok) throw new Error("a snippet did not compile; see the test above");

  const x = a.compiled.wasm, y = b.compiled.wasm;
  if (x.length !== y.length) throw new Error(`${x.length} bytes from wac, ${y.length} from wapy`);
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) throw new Error(`byte ${i} differs: ${x[i]} vs ${y[i]}`);
  }
});

Deno.test("site: the mixed-import snippets are a real program", async () => {
  // Printed side by side as `stats.wac` and `report.wapy`, with a `hist.wapy` the wac file
  // imports. The page names those files, so they have to resolve to each other.
  const files = {
    "hist.wapy": await snippet("EX_SURFACE_WAPY"),
    "stats.wac": await snippet("EX_MIXED_WAC"),
    "report.wapy": await snippet("EX_MIXED_WAPY"),
  };
  const r = compile(files, "report.wapy");
  if (!r.ok) {
    const d = r.diagnostics[0];
    throw new Error(`${d.file}:${d.line}:${d.col} ${d.message}`);
  }
});
