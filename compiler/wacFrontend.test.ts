// Mixed `.wac` / `.wapy` import graphs, through `wacCompile`.
//
// The claim under test is that the language does not treat either surface as special. Not that
// a translation step exists and works — that a `.wapy` file *is* a wac module: importable from
// wac, able to import wac, and diagnosed at the line its author wrote. Nothing here reaches
// past `wacCompile`; if these pass, so does everything built on it — `wacx check`, `run`,
// `compile`, `bindgen`, `build`, and the packages' harness.

import { wacCompile } from "./wacCompile.ts";
import { wacInstance } from "./wacInstance.ts";
import { EXTENSIONS, frontendFor, importsOf } from "./wacFrontend.ts";

function compile(files: Record<string, string>, entry: string) {
  return wacCompile(new Map(Object.entries(files)), entry);
}

function ok(files: Record<string, string>, entry: string): void {
  const r = compile(files, entry);
  if (!r.ok) throw new Error(r.diagnostics.map((d) => `${d.file}:${d.line}:${d.col} ${d.message}`).join("\n"));
}

Deno.test("wacFrontend: a .wac file imports a .wapy file", () => {
  ok({
    "lib.wapy": "@export\ndef triple(x: i32) -> i32:\n    return x * 3\n",
    "main.wac": `import { triple } from "./lib.wapy";\nexport i32 main() { return triple(14); }\n`,
  }, "main.wac");
});

Deno.test("wacFrontend: a .wapy file imports a .wac file", () => {
  ok({
    "helper.wac": "export i32 add(i32 a, i32 b) { return a + b; }\n",
    "main.wapy": `from "./helper.wac" import add\n@export\ndef go() -> i32:\n    return add(20, 22)\n`,
  }, "main.wapy");
});

Deno.test("wacFrontend: both formats in one graph, three deep", () => {
  ok({
    "a.wapy": "@export\ndef one() -> i32:\n    return 1\n",
    "b.wac": `import { one } from "./a.wapy";\nexport i32 two() { return one() + 1; }\n`,
    "c.wapy": `from "./b.wac" import two\n@export\ndef three() -> i32:\n    return two() + 1\n`,
  }, "c.wapy");
});

Deno.test("wacFrontend: a .wapy entry produces a working module", async () => {
  const r = compile({
    "main.wapy": "@export\ndef answer() -> i32:\n    return 6 * 7\n",
  }, "main.wapy");
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  const got = (await wacInstance(r.compiled)).call("answer", []);
  if (got !== 42) throw new Error(`got ${got}`);
});

Deno.test("wacFrontend: a type error names the wapy line, not a generated one", () => {
  const r = compile({
    // The mistake is on line 5 of what the author wrote. There is no mapping step: the wapy
    // frontend never converts to wac text, so the positions in the tree are the only ones
    // that ever existed.
    "bad.wapy": [
      "## A doc comment,",
      "## over two lines.",
      "@export",
      "def f(x: i32) -> i32:",
      `    y: i32 = "not a number"`,
      "    return y",
      "",
    ].join("\n"),
  }, "bad.wapy");
  if (r.ok) throw new Error("should not compile");
  if (r.diagnostics[0].line !== 5) throw new Error(`wrong line: ${JSON.stringify(r.diagnostics[0])}`);
});

Deno.test("wacFrontend: an unknown extension is refused rather than assumed to be wac", () => {
  const r = compile({ "lib.txt": "export i32 f() { return 1; }\n" }, "lib.txt");
  if (r.ok) throw new Error("should not compile");
  if (!r.diagnostics[0].message.includes("unknown extension")) {
    throw new Error(r.diagnostics[0].message);
  }
});

Deno.test("wacFrontend: every extension has a frontend and every frontend an extension", () => {
  for (const ext of EXTENSIONS) {
    if (!frontendFor(`x${ext}`)) throw new Error(`${ext} has no frontend`);
  }
  if (frontendFor("x")) throw new Error("a file with no extension resolved to a frontend");
  if (frontendFor("x.wacky")) throw new Error("a longer extension matched by prefix");
});

Deno.test("wacFrontend: imports are read off the program, not the text", () => {
  // A specifier inside a comment and a string, in both surfaces. Reading them would send the
  // graph walk off to files that are not there.
  const wac = frontendFor("a.wac")!(
    `// import { x } from "./ghost.wac";\nexport string s() { return "from \\"./ghost.wac\\""; }\n`,
    "a.wac",
  );
  const wapy = frontendFor("a.wapy")!(
    `# from "./ghost.wac" import x\n@export\ndef s() -> string:\n    return "./ghost.wac"\n`,
    "a.wapy",
  );
  for (const [name, r] of [["wac", wac], ["wapy", wapy]] as const) {
    if (r.errors.length) throw new Error(`${name}: ${r.errors[0].message}`);
    if (importsOf(r.program).length) throw new Error(`${name} found a phantom import`);
  }
});
