// Run it like this:
//
//   deno test -A --unstable-sloppy-imports --no-check site/tools/site.test.ts
//
// Both flags are about `site/src`, which is a vite project. `./file-store` with no extension is
// what vite and `tsc --moduleResolution bundler` resolve and what Deno's resolver refuses — rewriting
// those imports would be changing the code to suit a tool that is not building it. The TypeScript is
// checked by `npx tsc -b` in `site/`, which is the checker that agrees with the bundler. The flags are
// on this one command rather than in `deno.json`, so every other test keeps strict resolution.
//
// **The playground's code, compiled and run.** The website is written in wac now and its pages are
// checked by `site/wac/test/` — every link, every heading, every snippet a page prints — so what is left
// here is the React app beside it: the playground's examples, the panel that runs them, the worker the
// bundle ships, the wacc asset it loads, and the editor's vocabulary against the spec.

import { EXAMPLES } from "../src/editor/examples.ts";
import { buildWaccAsset } from "./syncWacc.ts";
import { compileWithWacc, type WaccModule } from "../src/editor/wacc-compile.ts";

// **The compiler the page uses, which is wacc.** This test exists to catch an example that has
// stopped compiling, and asking a different compiler than the page asks would catch the wrong thing
// — an example using JSX would fail here and work in the playground, or the reverse.
const dir = await Deno.makeTempDir({ prefix: "wac-sitetest-" });
await Deno.writeTextFile(`${dir}/wacc-api.js`, await buildWaccAsset());
const wacc = await import(`${dir}/wacc-api.js`) as unknown as WaccModule;
globalThis.addEventListener("unload", () => { Deno.removeSync(dir, { recursive: true }); });

function compile(files: Record<string, string>, entry: string) {
  if (entry.endsWith(".wac")) {
    // `.wac` files and nothing else: `diagnoseFiles` lexes everything it is handed rather than only
    // what the entry imports. The page filters the same way, for the same reason.
    const only: Record<string, string> = {};
    for (const [k, v] of Object.entries(files)) {
      if (k.endsWith(".wac")) only[k] = v;
    }
    const r = compileWithWacc(wacc, only, entry);
    return r.ok
      // `wire` and `sigs` travel because the panel's runner needs them: it calls through the glue
      // wacc describes rather than through a marshalling layer of its own.
      ? { ok: true as const, compiled: r.compiled, wire: r.wire, sigs: r.sigs, diagnostics: [] }
      : { ok: false as const, diagnostics: r.diagnostics.map((d) => ({ ...d, phase: "check" })) };
  }
  // There is one compiler. This used to hand anything else to the TypeScript reference, which is
  // how a test could pass while exercising a compiler the page does not have — see the header on
  // `run` below, and `issues/system/0146`.
  throw new Error(`${entry}: not a wac file, and there is nothing else to compile it with`);
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

// ── Running, not just compiling ─────────────────────────────────────────────
//
// Compiling was not enough. The panel's runner held its own copy of the marshalling accessor
// names — `__bind_str_len` where the emitter emits `$bind$str_len` — so every export returning a
// string or taking an array failed at run time with "not a function", including the landing
// page's hello world. Nothing noticed, because nothing here had ever called one.

import { createRunner, runnable, RUN_TIMEOUT_MS } from "../src/editor/wac-compile.ts";

/**
 * The panel's own path: text in, text out.
 *
 * **Compiled by the same `compile` the rest of this file uses**, rather than by `runFunction`.
 * `runFunction` compiles with whatever `wac-compile.ts` has loaded, and what it has loaded under
 * Deno is nothing: the module fetches `wacc-api.js` from a deploy-root URL that only exists in a
 * browser, so its `wacc` stays null and it falls back to the reference. Every panel test here has
 * therefore been running the *reference's* output while claiming to be the panel's path.
 */
async function run(src: string, file: string, fn: string, args: string[]): Promise<string> {
  const checked = compile({ [file]: src }, file);
  if (!checked.ok) {
    throw new Error(`${fn}: ${checked.diagnostics.map((d) => d.message).join("; ")}`);
  }
  const runner = createRunner();
  try {
    const r = await runner.run({
      wasm: checked.compiled.wasm,
      wire: checked.wire,
      sigs: checked.sigs,
      funcName: fn,
      argStrings: args,
    });
    if (!r.success) throw new Error(`${fn}: ${r.output}`);
    return r.output;
  } finally {
    runner.dispose();
  }
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
    i32[] out = i32[].filled(xs.len(), 0);
    for (i32 i = 0; i < xs.len(); i++) { out[i] = xs[i] * 2; }
    return out;
  }`;
  for (const typed of ["1, 2, 3", "[1, 2, 3]"]) {
    const got = await run(src, "m.wac", "doubled", [typed]);
    if (got !== "[2, 4, 6]") throw new Error(`${typed} → ${got}`);
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
    // The asset this file already built, rather than a second climb of the ladder in the child.
    args: ["run", "-A", new URL("./siteDeadline.ts", import.meta.url).pathname, "700", `${dir}/wacc-api.js`],
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
  // and each call here goes through the same worker the page uses — so a future example that loops
  // fails this test rather than hanging it.
  //
  // **The deadline is not the page's, and the comment here said it was.** The page's is
  // `RUN_TIMEOUT_MS`, 5s, and this passed a hardcoded 3000 — stricter than production, and a second
  // copy of a number that had already moved once. What the deadline is *for* differs too: on the page
  // it is a UX choice about not hanging a tab, and here it is a detector for an example that never
  // terminates. A detector does not need to be tight. Every one of these snippets runs in single-digit
  // milliseconds — the whole sweep is 464ms on an idle machine — so anything that outstays a multiple
  // of the page's own deadline is looping, and nothing that finishes normally can come near it.
  //
  // It went red in the gate on 2026-08-29 for exactly the reason a tight wall-clock bound goes red on
  // this machine: three of them were killed at 3s while a four-worker suite and the coverage ratchets
  // had the five cores. The message it printed is the one that makes this expensive to diagnose —
  // *check for a loop that never reaches its condition* — which is a confident statement about the
  // snippet when the truth was about the machine.
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
          {
            wasm: r.compiled.wasm,
            wire: r.wire,
            sigs: r.sigs,
            funcName: f.name,
            argStrings: f.params.map(() => ""),
          },
          RUN_TIMEOUT_MS * 4,
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
  const dir = new URL("../dist/playground/assets/", import.meta.url);
  let chunk: string | undefined;
  try {
    for (const e of Deno.readDirSync(dir)) if (e.name.startsWith("run.worker")) chunk = e.name;
  } catch {
    console.error("  (no dist/playground/ — run `npx vite build` to check the bundle too)");
    return;
  }
  if (!chunk) throw new Error("dist/playground/assets exists but has no run.worker chunk");

  const r = compile({ "m.wac": `export string hello() { return "from the bundle"; }` }, "m.wac");
  if (!r.ok) throw new Error(r.diagnostics[0].message);

  const worker = new Worker(new URL(chunk, dir).href, { type: "module" });
  try {
    const reply = await new Promise<{ success?: boolean; output?: string }>((resolve) => {
      worker.onmessage = (e) => resolve(e.data);
      setTimeout(() => resolve({}), 10_000);
      worker.postMessage({
        wasm: r.compiled.wasm,
        wire: r.wire,
        sigs: r.sigs,
        funcName: "hello",
        argStrings: [],
      });
    });
    if (reply.output !== "from the bundle") throw new Error(JSON.stringify(reply));
  } finally {
    worker.terminate();
  }
});

// ── No page may carry a URL that is only right from one directory ───────────

Deno.test("site: no runtime URL is relative to the directory it was written in", async () => {
  // The site links to the demo pages, which live at the deploy root beside it rather than inside
  // it, so a page has to name them by path. Written `../shell.html` those were correct while this
  // was served at `/next/` and wrong once it moved — and nothing else can see that: it typechecks,
  // it builds, and a screenshot of the page it breaks looks like a screenshot of a page.
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

// ── The editor's vocabulary against the spec ─────────────────────────────────────────────────
//
// `wac-language.ts` used to import its keyword list from the TypeScript reference's lexer,
// because a copy had drifted once — written before `enum` and `match` existed, so the landing
// page's own enum example rendered them as ordinary identifiers. The reference is gone, wacc has
// no list to import (`keywordKind` is packed-integer comparisons), and a browser bundle cannot
// read a `.md` at runtime. So the copy is checked against the definition instead.
//
// The other half of this pair is packages/wacc/test/wac/speckeywords_test.wac, which holds
// *wacc's lexer* to the same fence. Neither test compares the highlighter with the compiler
// directly; they agree because both agree with the document, which is the arrangement that also
// catches the document being wrong.

import { KEYWORDS } from "../src/editor/wac-vocabulary.ts";

/** The words in the grammar appendix's `## Keywords` fence. */
function specKeywords(md: string): Set<string> {
  const m = /#+ Keywords\n+```\n([\s\S]*?)```/.exec(md);
  if (m === null) throw new Error("could not find the Keywords fence in the grammar appendix");
  return new Set(m[1].split(/\s+/).filter(Boolean));
}

Deno.test("site: the editor's keyword list is the one the spec prints", async () => {
  const md = await Deno.readTextFile(new URL("../../spec/appendices/A-grammar.md", import.meta.url));
  const spec = specKeywords(md);

  // A floor first: a fence that stopped being found, or an extraction that collapsed, would make
  // every comparison below vacuous and pass.
  if (spec.size < 28) throw new Error(`the fence gave ${spec.size} words, expected 28 or more`);

  // `as!`, `as~` and `as@` are in the fence and not in the highlighter, because the tokeniser
  // matches whole identifier-shaped words and none of those three is one. Named exactly, so a
  // fourth would fail here rather than widen the exemption.
  const POSTFIX = new Set(["as!", "as~", "as@"]);
  const want = [...spec].filter((w) => !POSTFIX.has(w)).sort();
  const got = [...KEYWORDS].sort();

  const missing = want.filter((w) => !KEYWORDS.has(w));
  const extra = got.filter((w) => !spec.has(w));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `the editor's keyword list has drifted from the grammar appendix\n` +
        `  in the spec, not highlighted: ${missing.join(", ") || "(none)"}\n` +
        `  highlighted, not in the spec: ${extra.join(", ") || "(none)"}`,
    );
  }

  // And the three really are in the fence — otherwise the exemption above is hiding their absence
  // rather than explaining it.
  for (const w of POSTFIX) {
    if (!spec.has(w)) throw new Error(`${w} is exempted here but is not in the fence at all`);
  }
});
