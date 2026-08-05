// Mixed .wac / .wapy import graphs.
//
// The property under test is that the extension is the *only* thing that differs: a module
// written in either form is importable from either form, and a diagnostic names the line its
// author wrote — not because anything translates coordinates afterwards, but because the wapy
// frontend never throws them away.

import { compileMixed, loadGraph } from "./wapyLoad.ts";

function assertEquals(got: unknown, want: unknown, msg = ""): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) throw new Error(`${msg}\n  got:  ${g}\n  want: ${w}`);
}

/** A temporary directory of files, cleaned up afterwards. */
async function withFiles<T>(files: Record<string, string>, f: (dir: string) => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "wapy-" });
  try {
    for (const [name, src] of Object.entries(files)) {
      await Deno.writeTextFile(`${dir}/${name}`, src);
    }
    return await f(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("a .wac file imports a .wapy file", async () => {
  await withFiles({
    "lib.wapy": `@export\ndef triple(x: i32) -> i32:\n    return x * 3\n`,
    "main.wac": `import { triple } from "./lib.wapy";\nexport i32 main() { return triple(14); }\n`,
  }, async (dir) => {
    const r = await compileMixed(`${dir}/main.wac`);
    assertEquals(r.ok, true, r.ok ? "" : JSON.stringify(r.diagnostics));
  });
});

Deno.test("a .wapy file imports a .wac file", async () => {
  await withFiles({
    "helper.wac": `export i32 add(i32 a, i32 b) { return a + b; }\n`,
    "main.wapy": `from "./helper.wac" import add\n@export\ndef go() -> i32:\n    return add(20, 22)\n`,
  }, async (dir) => {
    const r = await compileMixed(`${dir}/main.wapy`);
    assertEquals(r.ok, true, r.ok ? "" : JSON.stringify(r.diagnostics));
  });
});

Deno.test("both formats in one graph, three deep", async () => {
  await withFiles({
    "a.wapy": `@export\ndef one() -> i32:\n    return 1\n`,
    "b.wac": `import { one } from "./a.wapy";\nexport i32 two() { return one() + 1; }\n`,
    "c.wapy": `from "./b.wac" import two\n@export\ndef three() -> i32:\n    return two() + 1\n`,
  }, async (dir) => {
    const r = await compileMixed(`${dir}/c.wapy`);
    assertEquals(r.ok, true, r.ok ? "" : JSON.stringify(r.diagnostics));
  });
});

Deno.test("a diagnostic names the wapy line, not the generated one", async () => {
  await withFiles({
    // The error is on line 5 of what the author wrote, and there is no mapping step: the
    // tokens `wapyRead` produces carry the positions they were written at, so the AST — and
    // every diagnostic derived from it — is already in wapy coordinates.
    "bad.wapy": [
      "## A doc comment,",
      "## over two lines.",
      "@export",
      "def f(x: i32) -> i32:",
      `    y: i32 = "not a number"`,
      "    return y",
      "",
    ].join("\n"),
  }, async (dir) => {
    const r = await compileMixed(`${dir}/bad.wapy`);
    assertEquals(r.ok, false, "should not compile");
    if (r.ok) return;
    assertEquals(r.diagnostics[0].line, 5, `wrong line: ${JSON.stringify(r.diagnostics[0])}`);
  });
});

Deno.test("an unknown extension is refused rather than assumed to be wac", async () => {
  await withFiles({ "lib.txt": `export i32 f() { return 1; }\n` }, async (dir) => {
    let msg = "";
    try { await loadGraph(`${dir}/lib.txt`); } catch (e) { msg = (e as Error).message; }
    if (!msg.includes("unknown extension")) {
      throw new Error(`expected a refusal, got: ${msg || "no error"}`);
    }
  });
});

Deno.test("an unknown extension is refused when reached through an import too", async () => {
  await withFiles({
    "lib.txt": `export i32 f() { return 1; }\n`,
    "main.wac": `import { f } from "./lib.txt";\nexport i32 main() { return f(); }\n`,
  }, async (dir) => {
    let msg = "";
    try { await loadGraph(`${dir}/main.wac`); } catch (e) { msg = (e as Error).message; }
    if (!msg.includes("unknown extension")) {
      throw new Error(`expected a refusal, got: ${msg || "no error"}`);
    }
  });
});
