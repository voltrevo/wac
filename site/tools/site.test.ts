// Run it like this:
//
//   deno test -A --unstable-sloppy-imports --no-check site/tools/site.test.ts
//
// Both flags are about `site/src`, which is a vite project. `./file-store` with no extension is
// what vite and `tsc --moduleResolution bundler` resolve and what Deno's resolver refuses — there
// are 33 such imports and rewriting them would be changing the site to suit a tool that is not
// building it. The site's TypeScript is checked by `npx tsc -b` in `site/`, which is the checker
// that agrees with the bundler. The flags are on this one command rather than in `deno.json`, so
// the other 2,900 tests keep strict resolution.
//
// It needed neither before the repository merge, only because the language repo had no
// `deno.json` at all.
//
// This file reaches into `site/src`, which is a vite project: `./file-store` with no extension is
// what vite and `tsc --moduleResolution bundler` both resolve, and what Deno's resolver refuses.
// The site's TypeScript is checked by `npx tsc -b` in `site/`, which is the checker that agrees
// with the bundler actually building it; Deno type-checking the same files is a second opinion
// from a tool that is not compiling them. It worked before the repository merge only because the
// language repo had no `deno.json` at all.
//
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

import { wacCompile } from "../../compiler/wacCompile.ts";
import { EXAMPLES } from "../src/editor/examples.ts";
import { buildWaccAsset } from "./syncWacc.ts";
import { compileWithWacc, type WaccModule } from "../src/editor/wacc-compile.ts";

// **The compiler the page uses, which is wacc for a `.wac` entry.** This test exists to catch an
// example that has stopped compiling, and asking a different compiler than the page asks would catch
// the wrong thing — an example using JSX would fail here and work in the playground, or the reverse.
// `.wapy` stays with the reference because that is the only implementation of it (`design/lang/0003`).
const dir = await Deno.makeTempDir({ prefix: "wac-sitetest-" });
await Deno.writeTextFile(`${dir}/wacc-api.js`, await buildWaccAsset());
const wacc = await import(`${dir}/wacc-api.js`) as unknown as WaccModule;
globalThis.addEventListener("unload", () => { Deno.removeSync(dir, { recursive: true }); });

// Snippets live in `src/snippets.ts` (the tour) and beside the page that prints only its own.
// A name exists once across all of them.
const PAGES = ["snippets.ts", "next/Home.tsx", "next/Language.tsx", "next/Stack.tsx"]
  .map((n) => new URL(`../src/${n}`, import.meta.url));

function compile(files: Record<string, string>, entry: string) {
  if (entry.endsWith(".wac") && !/from\s+"[^"]*\.wapy"/.test(files[entry] ?? "")) {
    // Only the `.wac` files: `diagnoseFiles` lexes everything it is handed, and a wapy file in the
    // same example set is not wac. The page does the same filtering, for the same reason.
    const only: Record<string, string> = {};
    for (const [k, v] of Object.entries(files)) if (k.endsWith(".wac")) only[k] = v;
    const r = compileWithWacc(wacc, only, entry);
    return r.ok
      ? { ok: true as const, compiled: r.compiled, diagnostics: [] }
      : { ok: false as const, diagnostics: r.diagnostics.map((d) => ({ ...d, phase: "check" })) };
  }
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
  const open = `const ${name} = \``;
  let src = "";
  let at = -1;
  for (const page of PAGES) {
    src = await Deno.readTextFile(page);
    at = src.indexOf(open);
    if (at >= 0) break;
  }
  if (at < 0) throw new Error(`no page declares ${name}`);
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

Deno.test("site: the pages' runnable snippets compile", async () => {
  for (const [name, file] of [
    // The front page prints this one and invites the reader to run it, which makes it the most
    // embarrassing snippet on the site to have broken. `EX_FRONT` was its counterpart on the page
    // this replaced and went with it.
    ["EX_HELLO", "a.wac"],
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
  //
  // **Both sides through the reference, deliberately, and not through `compile` above.** That helper
  // sends `.wac` to wacc and `.wapy` to the reference, which is right where the question is *what
  // does the playground do* — and wrong here, where the question is *are these two surfaces the same
  // program*. Compiled by two different compilers the byte comparison measures the compilers instead,
  // and it did: 1137 bytes from wac against 2493 from wapy, a red test about a true sentence
  // (`issues/lang/0121`). wacc has no wapy front end (`design/lang/0003`), so the only compiler that
  // can answer this one is the one with both front ends.
  const a = wacCompile(new Map([["a.wac", await snippet("EX_SURFACE_WAC")]]), "a.wac");
  const b = wacCompile(new Map([["a.wapy", await snippet("EX_SURFACE_WAPY")]]), "a.wapy");
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

// ── The routes and the pages agree ─────────────────────────────────────────

Deno.test("site: every page in the nav is a route, and every route renders something", async () => {
  // Six pages behind a hash router, so the way to break it is to add one to the navigation and
  // not to the switch — which gives a link that silently lands on the front page. `tsc -b` cannot
  // see that, because both halves type-check perfectly well apart.
  //
  // This used to check two sites, the live one and the rewrite beside it. There is one now.
  const dir = new URL("../src/", import.meta.url);
  const ui = await Deno.readTextFile(new URL("next/ui.tsx", dir));
  const app = await Deno.readTextFile(new URL("next/App.tsx", dir));

  const declared = [...ui.matchAll(/export type Route =([^;]+);/g)]
    .flatMap((m) => [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]));
  if (declared.length < 5) throw new Error(`only ${declared.length} routes in the Route type`);
  const routed = new Set([...[...app.matchAll(/case "([a-z]+)":/g)].map((m) => m[1]), "home"]);
  const unrouted = declared.filter((r) => !routed.has(r));
  if (unrouted.length) throw new Error(`Route has ${unrouted.join(", ")}, App.tsx does not`);

  // And every nav entry names one of them.
  for (const m of ui.matchAll(/route: "([a-z]+)", href: "#\/([a-z]*)"/g)) {
    if (!declared.includes(m[1])) throw new Error(`nav names route ${m[1]}, which the Route type does not`);
    if (m[1] !== m[2]) throw new Error(`nav entry ${m[1]} points at #/${m[2]}`);
  }

  // The routes the site this replaced used, which now resolve here rather than falling back to
  // the front page in silence. A reader who followed an old link about Tor should not arrive at a
  // heading about a language with nothing to say anything went wrong.
  const moved = [...app.matchAll(/(\w+): "([a-z]+)"/g)]
    .filter(([, , to]) => declared.includes(to));
  if (!/built: "stack"/.test(app) || !/showcase: "stack"/.test(app)) {
    throw new Error("the aliases for #/built and #/showcase are gone — old links land on the front page");
  }
  void moved;
});


// ── Headings, and the contents that reads them ─────────────────────────────

Deno.test("site: every heading has an id, so the contents can list it", async () => {
  // `Contents` builds itself from `main h2[id], h3[id]`, which means a heading without an id is
  // simply absent from the navigation — no error, no blank space, nothing to notice. That is the
  // failure this catches, and it is the price of not hand-writing the list.
  const files = ["next/Home", "next/Language", "next/Stack", "next/Roadmap",
                 "next/Run", "next/Checked"];
  const missing: string[] = [];
  let total = 0;
  for (const name of files) {
    // Per file, because each of these is one page and an id only has to be unique within the
    // document it lands in — `#/showcase/ethereum` and `#/roadmap/ethereum` are different places
    // and the route says which.
    const seen = new Map<string, number>();
    const path = new URL(`../src/${name}.tsx`, import.meta.url);
    const text = await Deno.readTextFile(path);
    const live = [...text.matchAll(/<h([23]) style=\{s\.h[23]\}([^>]*)>([^<{]*)/g)];
    // `<Section id="x" title="…">` and `<Sub …>` render an h2/h3 with that id.
    const next = [...text.matchAll(/<(Section|Sub)\s+id="([^"]+)"([^>]*)/g)].map((x) => {
      const shaped = [x[0], x[1] === "Section" ? "2" : "3", ` id="${x[2]}"`, x[3]] as unknown as RegExpMatchArray;
      shaped.index = x.index;   // carried, or every message names the last line of the file
      return shaped;
    });
    for (const m of [...live, ...next]) {
      const [, level, attrs, label] = m;
      const id = attrs.match(/id="([^"]+)"/)?.[1];
      const line = text.slice(0, m.index!).split("\n").length;
      if (id === undefined) {
        missing.push(`${name}.tsx:${line}: <h${level}> ${label.trim().slice(0, 48)} — no id`);
        continue;
      }
      // Ids are anchors in a URL, so two headings sharing one makes the second unreachable.
      const before = seen.get(id);
      if (before !== undefined) missing.push(`${name}.tsx:${line}: id "${id}" is already used on line ${before}`);
      seen.set(id, line);
      total++;
    }
  }
  if (missing.length) throw new Error(`${missing.length} heading problem(s):\n  ${missing.join("\n  ")}`);
  if (total < 25) throw new Error(`only ${total} headings found — did the scan resolve?`);
});

// ── A size claim that can go stale ─────────────────────────────────────────

Deno.test("site: the compiler size the site claims is the size it is", async () => {
  // "~6,000 lines" sat on the front page for months while the compiler grew to 16,000. It is a
  // flattering direction to be wrong in, which is why nobody noticed — a smaller compiler sounds
  // better. The number is measurable, so measure it.
  const dir = new URL("../../compiler/", import.meta.url).pathname;
  let actual = 0;
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile || !e.name.endsWith(".ts") || e.name.endsWith(".test.ts")) continue;
    // The wapy surface and the CLI are not what "the compiler" means in that sentence.
    if (e.name.startsWith("wapy") || e.name.startsWith("wacx")) continue;
    actual += (await Deno.readTextFile(dir + e.name)).split("\n").length;
  }

  const claims: { where: string; k: number }[] = [];
  for (const file of ["../src/next/Home.tsx", "../src/next/Language.tsx"]) {
    const text = await Deno.readTextFile(new URL(file, import.meta.url));
    for (const m of text.matchAll(/~(\d{1,3}),?(\d{3})?k? lines|~(\d{1,3})k\b/g)) {
      const k = m[1] !== undefined ? (m[2] !== undefined ? Number(m[1]) : Number(m[1])) : Number(m[3]);
      claims.push({ where: file.replace("../", ""), k });
    }
  }
  // One page states it now, where three did while the old site was still here. Kept as a floor
  // rather than removed: a check that finds nothing to check passes, and this one has already
  // caught a wrong number twice.
  if (claims.length < 1) throw new Error(`no size claims found — has the wording changed?`);

  const wrong = claims.filter(({ k }) => Math.abs(k * 1000 - actual) / actual > 0.15);
  if (wrong.length) {
    throw new Error(
      `the compiler is ${actual.toLocaleString()} lines; these say otherwise:\n  ` +
        wrong.map(({ where, k }) => `${where}: ~${k}k`).join("\n  "),
    );
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

// ── The specification's own tag count ──────────────────────────────────────

Deno.test("site: the number of tagged claims the site quotes is the number there are", async () => {
  // Same shape as the compiler-size check above, and it caught the same class of drift: the page
  // said 409 against 366. That is the wrong direction on the page whose whole argument is that a
  // number here came from somewhere outside the sentence containing it — and 419 is the count of
  // tag *occurrences*, so the likeliest history is that somebody counted mentions rather than
  // claims. A tag written twice is one claim.
  const specDir = new URL("../../spec", import.meta.url).pathname;
  const tags = new Set<string>();
  const walk = async (dir: string): Promise<void> => {
    for await (const e of Deno.readDir(dir)) {
      const path = `${dir}/${e.name}`;
      if (e.isDirectory) await walk(path);
      else if (e.name.endsWith(".md")) {
        for (const m of (await Deno.readTextFile(path)).matchAll(/\[§(wac-[a-z0-9-]+)\]/g)) {
          tags.add(m[1]);
        }
      }
    }
  };
  await walk(specDir);
  if (tags.size < 300) throw new Error(`only ${tags.size} tags found — did the walk resolve?`);

  const page = await Deno.readTextFile(new URL("../src/next/Checked.tsx", import.meta.url).pathname);
  const claim = page.match(/<Lead>([\d,]+) of its claims carry a tag<\/Lead>/);
  if (claim === null) throw new Error("Checked.tsx no longer states a tag count — has the wording changed?");
  const said = Number(claim[1].replace(/,/g, ""));
  if (said !== tags.size) {
    throw new Error(`the site says ${said} tagged claims; spec/ has ${tags.size}`);
  }
});

// ── The bootstrap block's two figures ──────────────────────────────────────

Deno.test("site: the bootstrap block's source count and size are the tree's", async () => {
  // The block on the front page reads `B == C  17 sources, 1,059 KB, identical`, and its own comment
  // has admitted for months that both figures are typed and go stale — they said 11 sources and
  // 266,818 bytes into 2026-08-20, and 16 sources and 968 KB into 2026-08-25. Twice caught by a
  // person reading the page, which is not a method. The tag-count check above is the shape this
  // copies.
  //
  // **The count is exact and the size has a tolerance**, and the difference is how each one moves.
  // A source file is added a few times a year and is a deliberate act; the artefact's size changes
  // with every commit to the compiler, so an exact check would be red for a reason nobody caused —
  // `tools/wac/readmefigures_test.wac` argues that at length and this follows it.
  //
  // KB here is 1000 bytes, which is the unit the page has always used: it called 968,370 bytes
  // "968 KB".
  const root = new URL("../../", import.meta.url).pathname;
  const page = await Deno.readTextFile(`${root}site/src/next/Home.tsx`);
  const said = page.match(/B == C\s+([\d,]+) sources, ([\d,]+) KB, identical/);
  if (said === null) throw new Error("the bootstrap block no longer states both figures — has the wording changed?");
  const saidSources = Number(said[1].replace(/,/g, ""));
  const saidKb = Number(said[2].replace(/,/g, ""));

  let sources = 0;
  for await (const e of Deno.readDir(`${root}packages/wacc/src`)) {
    if (e.isFile && e.name.endsWith(".wac")) sources++;
  }
  if (sources < 5) throw new Error(`only ${sources} wacc sources found — did the walk resolve?`);
  if (saidSources !== sources) {
    throw new Error(`the site says ${saidSources} wacc sources; packages/wacc/src has ${sources}`);
  }

  // The seed is gitignored and one per agent, so a checkout that has never run `wac task seed` has
  // nothing to compare against. Absent is not a failure — it is a checkout that cannot answer.
  let bytes: number;
  try {
    bytes = (await Deno.stat(`${root}native/v8/seed/wacc.wasm`)).size;
  } catch {
    console.error("  (no native/v8/seed/wacc.wasm — run `wac task seed` to check the size too)");
    return;
  }
  const kb = Math.round(bytes / 1000);
  if (Math.abs(kb - saidKb) > saidKb * 0.1) {
    throw new Error(`the site says ${saidKb} KB; the seed is ${kb} KB — more than 10% out, so it has stopped being true`);
  }
});

// ── No page may carry a URL that is only right from one directory ───────────

Deno.test("site: no runtime URL is relative to the directory it was written in", async () => {
  // The site links to the demo pages, which live at the deploy root beside it rather than inside
  // it, so a page has to name them by path. Written `../shell.html` those were correct while this
  // was served at `/next/` and wrong once it moved — and nothing else can see that: it typechecks,
  // it builds, and a screenshot of the page it breaks looks like a screenshot of a page.
  //
  // The one that matters most is `coi-serviceworker.js`. It supplies the cross-origin isolation
  // `SharedArrayBuffer` needs, so losing it does not break a link — it turns every demo on the
  // site into an error message about headers.
  //
  // Module specifiers are exempt: `../snippets` is resolved by the bundler and has nothing to do
  // with where a page is served. What is checked is strings naming a file a browser will fetch.
  const dir = new URL("../src/next/", import.meta.url).pathname;
  const offenders: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (!e.name.endsWith(".tsx") && !e.name.endsWith(".ts")) continue;
    // Comments are stripped first: this file's own explanation quotes the shape it forbids, and a
    // checker that cannot tell code from prose about code will fire on the prose.
    const text = (await Deno.readTextFile(dir + e.name))
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");
    for (const m of text.matchAll(/["'`](\.\.\/[^"'`]*\.(?:html|json|svg|png|css|wasm))["'`]/g)) {
      offenders.push(`src/next/${e.name}: ${m[1]}`);
    }
  }
  // The entry document sits at the root now, so every asset it names is beside it.
  const html = await Deno.readTextFile(new URL("../index.html", import.meta.url).pathname);
  for (const m of html.matchAll(/(?:src|href)="(\.\.\/[^"]*)"/g)) {
    offenders.push(`index.html: ${m[1]}`);
  }
  if (offenders.length) {
    throw new Error(
      `${offenders.length} URL(s) that only resolve from the directory they were written in:\n  ` +
        offenders.join("\n  "),
    );
  }

  // And the redirect left where this site used to be still points somewhere.
  const moved = await Deno.readTextFile(new URL("../next/index.html", import.meta.url).pathname);
  if (!/location\.replace\("\.\.\/"/.test(moved)) {
    throw new Error("next/index.html no longer redirects to the root — old links go nowhere");
  }
});


// ── The wacc asset's contract ────────────────────────────────────────────────

Deno.test("a wacc asset the page cannot use is refused rather than written", async () => {
  // `issues/system/0146`: the published playground compiled with the *reference* for a while,
  // because `site/tools/syncWacc.ts` failed in the deploy and `wac-compile.ts` falls back when the
  // asset is absent. That fallback is right for a checkout and a silent wrong answer for a publish.
  //
  // The loud half — a script that throws — was already there. This is the quiet half: an asset that
  // is written successfully and is not one the page can use. Checked here rather than only in the
  // workflow, so a local build is held to it too.
  const { checkAsset, REQUIRED } = await import("./syncWacc.ts");

  const good = "x".repeat(200_000) + REQUIRED.join(" ");
  checkAsset(good);   // must not throw

  for (const name of REQUIRED) {
    const without = good.replaceAll(name, "renamed");
    let threw = "";
    try {
      checkAsset(without);
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    if (!threw.includes(name)) {
      throw new Error(`an asset missing ${name} was accepted, or the message did not name it: ${threw}`);
    }
  }

  // Every name present and no compiler behind them — the shape a size check alone would catch and a
  // name check alone would not, which is why both are there.
  let small = "";
  try {
    checkAsset(REQUIRED.join(" "));
  } catch (e) {
    small = e instanceof Error ? e.message : String(e);
  }
  if (!small.includes("too small")) {
    throw new Error(`an asset with no module was accepted: ${small || "(no error)"}`);
  }
});
