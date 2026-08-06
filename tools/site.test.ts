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

Deno.test("site: the core snippets are a real program, and share one Read", async () => {
  // The page's claim is that neither file declares `Read` and they still meet through it. A
  // compile is what checks that: if `core` stopped resolving, or the two sides got separate
  // copies, this is a type error rather than a sentence that quietly became false.
  const files = {
    "main.wac": await snippet("EX_CORE_MAIN"),
    "report.wac": await snippet("EX_CORE_LIB"),
  };
  const r = compile(files, "main.wac");
  if (!r.ok) {
    const d = r.diagnostics[0];
    throw new Error(`${d.file}:${d.line}:${d.col} ${d.message}`);
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

import { createRunner, runFunction, runnable } from "../src/editor/wac-compile.ts";

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

Deno.test("site: a program that never terminates is stopped at its deadline", async () => {
  // In a subprocess, because Deno's `terminate()` does not stop a worker spinning inside a wasm
  // loop: measured, the core keeps burning and the process never exits. Chromium and Node both
  // kill it. That is a known Deno regression with a fix in flight (denoland/deno#35657), so this
  // subprocess is a workaround with an expiry date — once it lands, call `runIsolated` directly
  // and delete `siteDeadline.ts`. What is under test either way is the deadline and the recovery,
  // which hold everywhere; the parent SIGKILLs whatever the child leaves behind.
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", new URL("./siteDeadline.ts", import.meta.url).pathname, "700"],
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  // Read the *first line* rather than to EOF: the child prints its answer and then cannot exit,
  // because the worker it killed is still spinning. Waiting for EOF would wait for the SIGKILL.
  const line = await firstLine(child.stdout, 20_000);
  try { child.kill("SIGKILL"); } catch { /* the answer is what mattered */ }
  await child.status;

  if (line === null) throw new Error("the child printed nothing — it never reached its deadline");
  const r = JSON.parse(line) as
    { elapsed: number; success: boolean; output: string; after: string };
  if (r.success) throw new Error("a program that cannot terminate reported success");
  if (!r.output.includes("Stopped after 0.7s")) throw new Error(r.output);
  // And the runner recovers: the killed worker is still spinning, so the next run has to get a
  // new one rather than a queue behind a thread that will never answer.
  if (r.after !== "recovered") throw new Error(`the next run after a kill gave: ${r.after}`);
  // Generous: the point is that it is bounded at all, not that it is punctual.
  if (r.elapsed > 5000) throw new Error(`took ${r.elapsed}ms to give up on a 700ms deadline`);
});

/** The first newline-terminated line on `stream`, or null if `ms` passes without one. */
async function firstLine(stream: ReadableStream<Uint8Array>, ms: number): Promise<string | null> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = new Promise<null>((r) => setTimeout(() => r(null), ms));
  try {
    while (true) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next === null) return null;
      if (next.done) return buf.trim() === "" ? null : buf;
      buf += decoder.decode(next.value, { stream: true });
      const nl = buf.indexOf("\n");
      if (nl >= 0) return buf.slice(0, nl);
    }
  } finally {
    reader.releaseLock();
  }
}

Deno.test("site: every runnable playground export actually runs", async () => {
  // Not the answer — only that calling it neither throws nor reports a marshalling failure.
  // Zero and empty are what the boxes hold before anything is typed, so that is what is passed.
  //
  // Every example therefore has to terminate on empty input, and one did not: the Collatz
  // example looped forever on 0, so clicking Run without typing hung the tab. It has a guard now,
  // and each call here goes through the same worker and the same deadline the page uses — so a
  // future example that loops fails this test rather than hanging it.
  // One worker for the whole sweep. A worker each costs a fresh type-check of the worker module
  // under Deno, which took this from milliseconds to a minute.
  const runner = createRunner();
  const broken: string[] = [];
  try {
    for (const ex of EXAMPLES) {
      const r = compile(ex.files, ex.entry);
      if (!r.ok) continue;                            // reported by the compile test above
      for (const f of r.compiled.exports) {
        if (runnable(f) !== null) continue;           // the panel would not offer a Run button
        const out = await runner.run(
          { compiled: r.compiled, funcName: f.name, argStrings: f.params.map(() => "") },
          3000,
        );
        if (!out.success && !out.output.startsWith("Runtime error: wac trap")) {
          broken.push(`${ex.name} · ${f.name} — ${out.output}`);
        }
      }
    }
  } finally {
    runner.dispose();
  }
  if (broken.length) throw new Error(`${broken.length}:\n  ${broken.join("\n  ")}`);
});

Deno.test("site: the built worker chunk runs, not only the source", async () => {
  // Everything above imports TypeScript. This talks to what Vite actually emits, because the
  // worker is the one part of the page whose *bundling* can be wrong on its own: it is a separate
  // chunk, loaded by URL, with its own module graph. Skipped without a build, since `deno test`
  // has to pass on a fresh checkout.
  const dir = new URL("../dist/assets/", import.meta.url);
  let chunk: string | undefined;
  try {
    for (const e of Deno.readDirSync(dir)) if (e.name.startsWith("run.worker")) chunk = e.name;
  } catch {
    console.error("  (no dist/ — run `npx vite build` to check the bundle too)");
    return;
  }
  if (!chunk) throw new Error("dist/assets exists but has no run.worker chunk");

  const r = compile({ "m.wac": `export string hello() { return "from the bundle"; }` }, "m.wac");
  if (!r.ok) throw new Error(r.diagnostics[0].message);

  const worker = new Worker(new URL(chunk, dir).href, { type: "module" });
  try {
    const reply = await new Promise<{ success?: boolean; output?: string }>((resolve) => {
      worker.onmessage = (e) => resolve(e.data);
      setTimeout(() => resolve({}), 10_000);
      worker.postMessage({ compiled: r.compiled, funcName: "hello", argStrings: [] });
    });
    if (reply.output !== "from the bundle") throw new Error(JSON.stringify(reply));
  } finally {
    worker.terminate();
  }
});
