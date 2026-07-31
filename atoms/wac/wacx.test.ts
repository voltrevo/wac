// wacx — the CLI, exercised through a fake cap.
//
// Every capability is injected, so these tests touch no filesystem and no process: the files are a
// Map, and the exit code is a return value. That is the whole reason `wacx` and `wacxMain` are
// separate atoms.

import { wacx, type WacxCap } from "./wacx.ts";

type Run = { code: number; out: string; err: string; written: Map<string, string | Uint8Array> };

/** Run wacx over an in-memory filesystem. */
async function run(argv: string[], files: Record<string, string>): Promise<Run> {
  const written = new Map<string, string | Uint8Array>();
  const outLines: string[] = [];
  const errLines: string[] = [];
  const cap: WacxCap = {
    readFile: (path) => {
      if (!(path in files)) return Promise.reject(new Error(`no such file: ${path}`));
      return Promise.resolve(files[path]);
    },
    writeFile: (path, data) => { written.set(path, data); return Promise.resolve(); },
    out: (t) => outLines.push(t),
    err: (t) => errLines.push(t),
  };
  const { code } = await wacx(argv, cap);
  return { code, out: outLines.join("\n"), err: errLines.join("\n"), written };
}

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}

const MATH = `export i32 gcd(i32 a, i32 b) { while (b != 0) { i32 t = b; b = a % b; a = t; } return a; }
export i64 big(i64 n) { return n * 2; }
export bool even(i32 n) { return n % 2 == 0; }
export string greet() { return "hi"; }
export i32[] pair() { return i32[](3, 4); }
export void nothing() { }
export i32 boom() { trap; }
export i32 nameLen(string s) { return s.len(); }
export string shout(string who) { return "hi " + who; }`;

Deno.test("[§wac-cli-check-4mkq8wp] check reports nothing and exits 0 for a valid file", async () => {
  const r = await run(["check", "math.wac"], { "math.wac": MATH });
  eq(r.code, 0, "exit code");
  eq(r.err, "", "no diagnostics");
});

Deno.test("[§wac-cli-check-4mkq8wp] check exits 1 and prints diagnostics for a broken file", async () => {
  const r = await run(["check", "bad.wac"], { "bad.wac": `export i32 f() { return "x"; }` });
  eq(r.code, 1, "exit code");
  if (!r.err.includes("bad.wac")) throw new Error(`expected the file named, got: ${r.err}`);
  if (r.err === "") throw new Error("expected a diagnostic on stderr");
});

Deno.test("[§wac-cli-check-4mkq8wp] check follows the import graph", async () => {
  // The error is in the *imported* file, which is only reached by walking imports.
  const r = await run(["check", "main.wac"], {
    "main.wac": `import { f } from "./lib.wac";\nexport i32 g() { return f(); }`,
    "lib.wac": `export i32 f() { return "x"; }`,
  });
  eq(r.code, 1, "exit code");
  if (!r.err.includes("lib.wac")) throw new Error(`expected lib.wac named, got: ${r.err}`);
});

Deno.test("[§wac-cli-check-4mkq8wp] a missing file is a usage error naming it", async () => {
  const r = await run(["check", "nope.wac"], {});
  eq(r.code, 1, "exit code");
  if (!r.err.includes("nope.wac")) throw new Error(`expected the path named, got: ${r.err}`);
});

Deno.test("[§wac-cli-run-7jnq2mv] run calls a function and prints its value", async () => {
  const r = await run(["run", "math.wac", "gcd", "48", "18"], { "math.wac": MATH });
  eq(r.code, 0, "exit code");
  eq(r.out, "6", "the spec's own example");
});

Deno.test("[§wac-cli-run-7jnq2mv] run passes a string argument as written", async () => {
  // The most ordinary thing a command line can pass, and it was a usage error: the coercion sent
  // every argument through `Number()`, so a string parameter reported "'world' is not a number,
  // but the parameter is string". A string needs no coercion at all — what it needed was a way
  // *into* the module, which `wacInstance` now builds with the module's own accessors.
  eq((await run(["run", "math.wac", "nameLen", "hello"], { "math.wac": MATH })).out, "5",
    "a string argument reaches the function");
  eq((await run(["run", "math.wac", "shout", "world"], { "math.wac": MATH })).out, "hi world",
    "and comes back out concatenated");
  eq((await run(["run", "math.wac", "nameLen", ""], { "math.wac": MATH })).out, "0", "including empty");
  eq((await run(["run", "math.wac", "nameLen", "héllo"], { "math.wac": MATH })).out, "6",
    "and the length is in UTF-8 bytes, not codepoints");
});

Deno.test("[§wac-cli-run-7jnq2mv] run coerces arguments by the declared parameter type", async () => {
  // Guessing from the text would be wrong for both of these: an i64 needs a BigInt, and `true`
  // is not a number.
  eq((await run(["run", "math.wac", "big", "21"], { "math.wac": MATH })).out, "42", "i64");
  eq((await run(["run", "math.wac", "even", "4"], { "math.wac": MATH })).out, "true", "bool return");
  const bad = await run(["run", "math.wac", "gcd", "x", "1"], { "math.wac": MATH });
  eq(bad.code, 1, "a non-numeric argument is a usage error");
  if (!bad.err.includes("not a number")) throw new Error(`expected a coercion message, got: ${bad.err}`);
});

Deno.test("[§wac-cli-run-7jnq2mv] run prints reference returns and nothing for void", async () => {
  eq((await run(["run", "math.wac", "greet"], { "math.wac": MATH })).out, "hi", "a string");
  eq((await run(["run", "math.wac", "pair"], { "math.wac": MATH })).out, "3 4", "an array");
  eq((await run(["run", "math.wac", "nothing"], { "math.wac": MATH })).out, "", "void prints nothing");
});

Deno.test("[§wac-cli-run-7jnq2mv] run distinguishes a trap from a compile failure", async () => {
  // Exit 2, not 1: a script needs to tell "did not compile" from "ran and trapped".
  const r = await run(["run", "math.wac", "boom"], { "math.wac": MATH });
  eq(r.code, 2, "a trap exits 2");
  if (!r.err.includes("trapped")) throw new Error(`expected the trap named, got: ${r.err}`);
});

Deno.test("[§wac-cli-run-7jnq2mv] run reports a wrong name or arity usefully", async () => {
  const missing = await run(["run", "math.wac", "nope"], { "math.wac": MATH });
  eq(missing.code, 1, "exit code");
  if (!missing.err.includes("available:")) {
    throw new Error(`a wrong name should list what is available, got: ${missing.err}`);
  }
  const arity = await run(["run", "math.wac", "gcd", "1"], { "math.wac": MATH });
  eq(arity.code, 1, "exit code");
  if (!arity.err.includes("signature:")) {
    throw new Error(`a wrong arity should show the signature, got: ${arity.err}`);
  }
});

Deno.test("[§wac-cli-compile-9wkn3pq] compile writes a wasm binary next to the source", async () => {
  const r = await run(["compile", "math.wac"], { "math.wac": MATH });
  eq(r.code, 0, "exit code");
  eq(r.out, "math.wasm", "the path is printed");
  const wasm = r.written.get("math.wasm");
  if (!(wasm instanceof Uint8Array)) throw new Error("expected bytes to be written");
  // The wasm magic number, so this is a real module rather than a stray string.
  eq(Array.from(wasm.slice(0, 4)).join(","), "0,97,115,109", "starts with \\0asm");
});

Deno.test("[§wac-cli-bindgen-5tqm7wn] bindgen writes a TypeScript wrapper", async () => {
  const r = await run(["bindgen", "math.wac"], { "math.wac": MATH });
  eq(r.code, 0, "exit code");
  eq(r.out, "math.wac.ts", "the path is printed");
  const ts = r.written.get("math.wac.ts");
  if (typeof ts !== "string") throw new Error("expected text to be written");
  if (!ts.includes("export function gcd")) {
    throw new Error("expected a typed wrapper for gcd");
  }
});

Deno.test("[§wac-cli-usage-3nkq8wj] usage and unknown commands", async () => {
  const none = await run([], {});
  eq(none.code, 1, "no arguments is an error");
  if (!none.out.includes("wacx check")) throw new Error("expected usage on stdout");

  const help = await run(["--help"], {});
  eq(help.code, 0, "--help is not an error");

  const unknown = await run(["frobnicate", "x.wac"], {});
  eq(unknown.code, 1, "an unknown command is an error");
  if (!unknown.err.includes("unknown command")) {
    throw new Error(`expected the command named, got: ${unknown.err}`);
  }

  const noEntry = await run(["check"], {});
  eq(noEntry.code, 1, "a missing entry file is an error");
  if (!noEntry.err.includes("entry file")) {
    throw new Error(`expected the missing entry named, got: ${noEntry.err}`);
  }
});

Deno.test("[§wac-cli-usage-3nkq8wj] warnings are shown but do not fail a build", async () => {
  // A warning nobody sees is not a warning, so they print on every command — but they must not
  // change the exit code.
  const src = `struct A { i32 x; } struct B { i32 y; }
    export i32 f(A a) { return a is B ? 1 : 0; }`;
  const r = await run(["check", "warn.wac"], { "warn.wac": src });
  eq(r.code, 0, "a warning still exits 0");
  if (r.err === "") throw new Error("expected the warning on stderr");
});
