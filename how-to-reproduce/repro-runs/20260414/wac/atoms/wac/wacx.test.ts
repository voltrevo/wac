// Tests for wacx — the unified CLI entry point.
// All platform APIs are injected via Cap so every command is fully testable.

import { main, type Cap } from "./wacx.ts";

// ---- Test helpers ----

type ExitError = { code: number };

// Build a fake Cap. Options control the sources available and what's collected.
function makeCap(opts: {
  args: string[];
  sources?: Record<string, string>;
  exitExpected?: boolean;
}): {
  cap: Cap;
  logs: string[];
  errors: string[];
  written: Record<string, Uint8Array | string>;
  exitCode: number | undefined;
} {
  const logs: string[] = [];
  const errors: string[] = [];
  const written: Record<string, Uint8Array | string> = {};
  let exitCode: number | undefined;

  const cap: Cap = {
    Deno: {
      args: opts.args,
      readTextFileSync: (p) => {
        const src = opts.sources?.[p];
        if (src === undefined) throw new Error(`file not found: ${p}`);
        return src;
      },
      writeFileSync: (p, d) => { written[p] = d; },
      writeTextFileSync: (p, d) => { written[p] = d; },
      exit: (code) => { exitCode = code; throw { code }; },
    },
    console: {
      log: (s) => logs.push(s),
      error: (s) => errors.push(s),
    },
    WebAssembly: {
      instantiate: (bytes) =>
        (WebAssembly.instantiate(bytes as any) as any) as Promise<{
          instance: { exports: Record<string, unknown> };
        }>,
    },
  };
  return { cap, logs, errors, written, exitCode: undefined as number | undefined };
}

// Run main, catching expected exits.
async function run(cap: Cap): Promise<{ exitCode: number | undefined }> {
  let exitCode: number | undefined;
  try {
    await main(cap);
  } catch (e: unknown) {
    const ex = e as { code?: number };
    if (typeof ex.code === "number") exitCode = ex.code;
    else throw e;
  }
  return { exitCode };
}

// ---- check command ----

Deno.test("wacx check: valid source exits cleanly with no output", async () => {
  const { cap, logs, errors } = makeCap({
    args: ["check", "/m.wac"],
    sources: { "/m.wac": `export i32 add(i32 a, i32 b) { return a + b; }` },
  });
  const { exitCode } = await run(cap);
  if (exitCode !== undefined) throw new Error(`expected no exit, got exit(${exitCode})`);
  if (errors.length > 0) throw new Error("expected no errors: " + errors.join("\n"));
  if (logs.length > 0) throw new Error("expected no output: " + logs.join("\n"));
});

Deno.test("wacx check: type error exits 1 and prints diagnostic to stderr", async () => {
  const { cap, errors } = makeCap({
    args: ["check", "/bad.wac"],
    sources: { "/bad.wac": `export i32 bad(i32 x) { if (x) { return 1; } return 0; }` },
  });
  const { exitCode } = await run(cap);
  if (exitCode !== 1) throw new Error(`expected exit 1, got ${exitCode}`);
  if (errors.length === 0) throw new Error("expected error output");
  const msg = errors.join("\n");
  if (!msg.includes("error:")) throw new Error("expected 'error:' in output: " + msg);
  if (!msg.includes("/bad.wac")) throw new Error("expected filename in output");
});

Deno.test("wacx check: error output includes source line and underline", async () => {
  const { cap, errors } = makeCap({
    args: ["check", "/m.wac"],
    sources: { "/m.wac": `export i32 bad(i32 x) { if (x) { return 1; } return 0; }` },
  });
  await run(cap);
  const msg = errors.join("\n");
  // Must include the source line content and the underline character.
  if (!msg.includes("if (x)")) throw new Error("source line missing from error");
  if (!msg.includes("^")) throw new Error("underline missing from error");
});

// ---- run command ----

Deno.test("wacx run: calls function and prints result", async () => {
  const { cap, logs } = makeCap({
    args: ["run", "/m.wac", "add", "3", "4"],
    sources: { "/m.wac": `export i32 add(i32 a, i32 b) { return a + b; }` },
  });
  const { exitCode } = await run(cap);
  if (exitCode !== undefined) throw new Error(`unexpected exit(${exitCode})`);
  if (logs[0] !== "7") throw new Error(`expected "7", got "${logs[0]}"`);
});

Deno.test("wacx run: gcd(48, 18) = 6", async () => {
  const { cap, logs } = makeCap({
    args: ["run", "/m.wac", "gcd", "48", "18"],
    sources: {
      "/m.wac": `export i32 gcd(i32 a, i32 b) {
  while (b != 0) { i32 t = b; b = a % b; a = t; }
  return a;
}`,
    },
  });
  await run(cap);
  if (logs[0] !== "6") throw new Error(`expected "6", got "${logs[0]}"`);
});

Deno.test("wacx run: i64 argument and return printed correctly", async () => {
  const { cap, logs } = makeCap({
    args: ["run", "/m.wac", "add64", "100", "200"],
    sources: { "/m.wac": `export i64 add64(i64 a, i64 b) { return a + b; }` },
  });
  await run(cap);
  // BigInt.toString() → "300"
  if (logs[0] !== "300") throw new Error(`expected "300", got "${logs[0]}"`);
});

Deno.test("wacx run: f64 function", async () => {
  const { cap, logs } = makeCap({
    args: ["run", "/m.wac", "half", "7"],
    sources: { "/m.wac": `export f64 half(f64 x) { return x * 0.5; }` },
  });
  await run(cap);
  if (logs[0] !== "3.5") throw new Error(`expected "3.5", got "${logs[0]}"`);
});

Deno.test("wacx run: bool argument and return", async () => {
  const { cap, logs } = makeCap({
    args: ["run", "/m.wac", "isPos", "5"],
    sources: { "/m.wac": `export bool isPos(i32 n) { return n > 0; }` },
  });
  await run(cap);
  if (logs[0] !== "true") throw new Error(`expected "true", got "${logs[0]}"`);
});

Deno.test("wacx run: bool param parsed from string 'true'/'false'", async () => {
  const { cap, logs } = makeCap({
    args: ["run", "/m.wac", "boolToInt", "true"],
    sources: { "/m.wac": `export i32 boolToInt(bool b) { if (b) { return 1; } return 0; }` },
  });
  await run(cap);
  if (logs[0] !== "1") throw new Error(`expected "1", got "${logs[0]}"`);
});

Deno.test("wacx run: void function prints nothing", async () => {
  const { cap, logs } = makeCap({
    args: ["run", "/m.wac", "noop"],
    sources: { "/m.wac": `export void noop() { }` },
  });
  await run(cap);
  if (logs.length !== 0) throw new Error(`expected no output, got "${logs.join("")}"`);
});

Deno.test("wacx run: unknown function exits 1", async () => {
  const { cap, errors } = makeCap({
    args: ["run", "/m.wac", "notThere"],
    sources: { "/m.wac": `export i32 x() { return 1; }` },
  });
  const { exitCode } = await run(cap);
  if (exitCode !== 1) throw new Error(`expected exit 1, got ${exitCode}`);
  if (!errors.some(e => e.includes("notThere"))) throw new Error("missing fn name in error");
});

Deno.test("wacx run: compile error exits 1", async () => {
  const { cap } = makeCap({
    args: ["run", "/m.wac", "bad"],
    sources: { "/m.wac": `export i32 bad() { return "oops"; }` },
  });
  const { exitCode } = await run(cap);
  if (exitCode !== 1) throw new Error(`expected exit 1, got ${exitCode}`);
});

// ---- compile command ----

Deno.test("wacx compile: writes .wasm file with correct wasm magic header", async () => {
  const { cap, written, logs } = makeCap({
    args: ["compile", "/m.wac"],
    sources: { "/m.wac": `export i32 add(i32 a, i32 b) { return a + b; }` },
  });
  await run(cap);
  const wasm = written["/m.wasm"] as Uint8Array;
  if (!wasm) throw new Error("no .wasm file written");
  // wasm magic: 0x00 0x61 0x73 0x6D
  if (wasm[0] !== 0x00 || wasm[1] !== 0x61 || wasm[2] !== 0x73 || wasm[3] !== 0x6d)
    throw new Error("output is not valid wasm (wrong magic header)");
  if (logs[0] !== "wrote /m.wasm") throw new Error(`expected "wrote /m.wasm", got "${logs[0]}"`);
});

Deno.test("wacx compile: .wac extension replaced with .wasm", async () => {
  const { cap, written } = makeCap({
    args: ["compile", "/path/math.wac"],
    sources: { "/path/math.wac": `export i32 x() { return 1; }` },
  });
  await run(cap);
  if (!written["/path/math.wasm"]) throw new Error("expected /path/math.wasm");
});

Deno.test("wacx compile: type error exits 1", async () => {
  const { cap } = makeCap({
    args: ["compile", "/m.wac"],
    sources: { "/m.wac": `export i32 bad() { return "oops"; }` },
  });
  const { exitCode } = await run(cap);
  if (exitCode !== 1) throw new Error(`expected exit 1, got ${exitCode}`);
});

// ---- bindgen command ----

Deno.test("wacx bindgen: writes .wac.ts file with TypeScript content", async () => {
  const { cap, written, logs } = makeCap({
    args: ["bindgen", "/m.wac"],
    sources: { "/m.wac": `export i32 add(i32 a, i32 b) { return a + b; }` },
  });
  await run(cap);
  const ts = written["/m.wac.ts"] as string;
  if (!ts) throw new Error("no .wac.ts file written");
  if (!ts.includes("export function add(")) throw new Error("expected function in output");
  if (!ts.includes("atob(")) throw new Error("expected atob in output");
  if (logs[0] !== "wrote /m.wac.ts") throw new Error(`expected "wrote /m.wac.ts", got "${logs[0]}"`);
});

Deno.test("wacx bindgen: output file path is <input>.ts", async () => {
  const { cap, written } = makeCap({
    args: ["bindgen", "/path/math.wac"],
    sources: { "/path/math.wac": `export i32 x() { return 1; }` },
  });
  await run(cap);
  if (!written["/path/math.wac.ts"]) throw new Error("expected /path/math.wac.ts");
});

Deno.test("wacx bindgen: type error exits 1", async () => {
  const { cap } = makeCap({
    args: ["bindgen", "/m.wac"],
    sources: { "/m.wac": `export i32 bad() { return "oops"; }` },
  });
  const { exitCode } = await run(cap);
  if (exitCode !== 1) throw new Error(`expected exit 1, got ${exitCode}`);
});

// ---- Argument edge cases ----

Deno.test("wacx: no args prints usage and exits 1", async () => {
  const { cap, errors } = makeCap({ args: [] });
  const { exitCode } = await run(cap);
  if (exitCode !== 1) throw new Error(`expected exit 1, got ${exitCode}`);
  if (!errors.some(e => e.includes("usage:"))) throw new Error("expected usage message");
});

Deno.test("wacx: unknown command exits 1 with error message", async () => {
  const { cap, errors } = makeCap({ args: ["frobnicate", "/m.wac"] });
  const { exitCode } = await run(cap);
  if (exitCode !== 1) throw new Error(`expected exit 1, got ${exitCode}`);
  if (!errors.some(e => e.includes("frobnicate"))) throw new Error("command name missing from error");
});

// ---- Branch coverage: readFile catch, formatError edge cases ----

Deno.test("wacx: readFile catch branch — unreadable file returns empty source, compiles cleanly", async () => {
  // readTextFileSync always throws → readFile catch branch → returns "" (empty source)
  // Empty program compiles fine, no errors, check exits cleanly.
  const errors: string[] = [];
  const cap: Cap = {
    Deno: {
      args: ["check", "/ghost.wac"],
      readTextFileSync: () => { throw new Error("not found"); },
      writeFileSync: () => {},
      writeTextFileSync: () => {},
      exit: (code) => { throw { code }; },
    },
    console: { log: () => {}, error: s => errors.push(s) },
    WebAssembly: {
      instantiate: (b) => (WebAssembly.instantiate(b as any) as any) as Promise<{
        instance: { exports: Record<string, unknown> };
      }>,
    },
  };
  const { exitCode } = await run(cap);
  if (exitCode !== undefined) throw new Error(`expected clean exit, got ${exitCode}`);
});

Deno.test("wacx: formatError with no annotation/hint and missing source file (line 2 error)", async () => {
  // Call 0 → returns 2-line source with a lex error on line 2.
  // Call 1+ → throws → readFile catch returns "" → "".split("\\n")[1] = undefined → ?? "" triggered.
  // Lex error has no annotation and no hint → covers ternary false and if-false branches.
  let callCount = 0;
  const errors: string[] = [];
  const cap: Cap = {
    Deno: {
      args: ["check", "/m.wac"],
      readTextFileSync: (_) => {
        if (callCount++ === 0) return "export i32 bad() {\n  return @invalid;\n}";
        throw new Error("gone");
      },
      writeFileSync: () => {},
      writeTextFileSync: () => {},
      exit: (code) => { throw { code }; },
    },
    console: { log: () => {}, error: s => errors.push(s) },
    WebAssembly: {
      instantiate: (b) => (WebAssembly.instantiate(b as any) as any) as Promise<{
        instance: { exports: Record<string, unknown> };
      }>,
    },
  };
  const { exitCode } = await run(cap);
  if (exitCode !== 1) throw new Error(`expected exit 1, got ${exitCode}`);
  if (errors.length === 0) throw new Error("expected error output");
  // Error output should still contain the message even without source line
  if (!errors.some(e => e.includes("error:"))) throw new Error("missing 'error:' in output");
});

Deno.test("wacx run: extra args beyond param count (exp?.params[i] undefined → ?? 'i32')", async () => {
  // Call a 0-param function with one extra arg. rawArgs[0] maps to params[0] which is undefined.
  // parseArg("42", "i32") → 42; wasm ignores the extra arg.
  const { cap, logs } = makeCap({
    args: ["run", "/m.wac", "val", "999"],  // "999" is the extra arg
    sources: { "/m.wac": `export i32 val() { return 7; }` },
  });
  await run(cap);
  if (logs[0] !== "7") throw new Error(`expected "7", got "${logs[0]}"`);
});

Deno.test("wacx run: missing fn arg exits 1 with usage", async () => {
  const { cap, errors } = makeCap({
    args: ["run", "/m.wac"],
    sources: { "/m.wac": `export i32 x() { return 1; }` },
  });
  const { exitCode } = await run(cap);
  if (exitCode !== 1) throw new Error(`expected exit 1, got ${exitCode}`);
  if (!errors.some(e => e.includes("usage:"))) throw new Error("expected usage message");
});
