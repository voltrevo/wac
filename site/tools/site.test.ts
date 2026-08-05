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

// ── Running, not just compiling ─────────────────────────────────────────────
//
// Compiling was not enough. The panel's runner held its own copy of the marshalling accessor
// names — `__bind_str_len` where the emitter emits `$bind$str_len` — so every export returning a
// string or taking an array failed at run time with "not a function", including the landing
// page's hello world. Nothing noticed, because nothing here had ever called one.

import { runFunction, runnable } from "../src/editor/wac-compile.ts";

/** The panel's own path: text in, text out. */
async function run(src: string, file: string, fn: string, args: string[]): Promise<string> {
  const r = await runFunction({ [file]: src }, file, fn, args);
  if (!r.success) throw new Error(`${fn}: ${r.output}`);
  return r.output;
}

Deno.test("site: the panel runs an export that returns a string", async () => {
  const got = await run(`export string hello() { return "Hello, world!"; }`, "m.wac", "hello", []);
  if (got !== "Hello, world!") throw new Error(got);
});

Deno.test("site: the panel runs an export that takes a string", async () => {
  const src = `export string shout(string s) { return s + "!"; }`;
  const got = await run(src, "m.wac", "shout", ["hi"]);
  if (got !== "hi!") throw new Error(got);
});

Deno.test("site: the panel runs an export that takes and returns an array", async () => {
  const src = `export i32[] doubled(i32[] xs) {
    i32[] out = i32[xs.len()]();
    for (i32 i = 0; i < xs.len(); i++) { out[i] = xs[i] * 2; }
    return out;
  }`;
  for (const typed of ["1, 2, 3", "[1, 2, 3]"]) {
    const got = await run(src, "m.wac", "doubled", [typed]);
    if (got !== "[2, 4, 6]") throw new Error(`${typed} → ${got}`);
  }
});

Deno.test("site: the panel runs the landing page's wapy demo", async () => {
  const got = await run(await snippet("EX_WAPY_LIVE"), "m.wapy", "fizzbuzz", ["15"]);
  if (!got.startsWith("1 2 Fizz 4 Buzz Fizz 7 8 Fizz Buzz 11 Fizz 13 14 FizzBuzz")) {
    throw new Error(got);
  }
});

Deno.test("site: every runnable playground export actually runs", async () => {
  // Not the answer — only that calling it neither throws nor reports a marshalling failure.
  // Zero and empty are what the boxes hold before anything is typed, so that is what is passed.
  //
  // Which also means every example has to *terminate* on empty input, and one did not: the
  // Collatz example looped forever on 0, so clicking Run without typing hung the tab. It has a
  // guard now. If this test ever hangs rather than failing, that is what happened again.
  const broken: string[] = [];
  for (const ex of EXAMPLES) {
    const r = compile(ex.files, ex.entry);
    if (!r.ok) continue;                              // reported by the compile test above
    for (const f of r.compiled.exports) {
      if (runnable(f) !== null) continue;             // the panel would not offer a Run button
      const out = await runFunction(ex.files, ex.entry, f.name, f.params.map(() => ""));
      if (!out.success && !out.output.startsWith("Runtime error: wac trap")) {
        broken.push(`${ex.name} · ${f.name} — ${out.output}`);
      }
    }
  }
  if (broken.length) throw new Error(`${broken.length}:\n  ${broken.join("\n  ")}`);
});
