// wacx — the unified CLI, as `spec/cli/main.md` specifies it.
//
// Four commands: check, run, compile, bindgen. Each is a thin composition of atoms that already
// exist — the CLI's job is argument handling, file I/O and exit codes, and nothing else.
//
// Every capability it needs is injected, so the whole thing is testable without touching a real
// filesystem or process. That is why `wacx` takes a `cap` and `wacxMain` is the only part that
// reaches for `Deno`.

import { wacCompile } from "./wacCompile.ts";
import type { WacCompiled, WacExport } from "./wacCompile.ts";
import { wacInstance } from "./wacInstance.ts";
import { wacBindgen } from "./wacBindgen.ts";
import { wacDiag } from "./wacDiag.ts";
import { EXTENSIONS, frontendFor, importsOf } from "./wacFrontend.ts";

/** Everything wacx does to the outside world. */
export type WacxCap = {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, data: string | Uint8Array) => Promise<void>;
  out: (text: string) => void;
  err: (text: string) => void;
  /** Make a built program executable. Optional: without it, `build` still writes the file. */
  chmod?: (path: string, mode: number) => Promise<void>;
};

/**
 * Read the entry file and everything it imports.
 *
 * Each file is parsed by the frontend its extension selects, and the imports are read off the
 * resulting program. Walking by text instead sent the read off to files that did not exist —
 * a doc comment containing an import specifier was enough — and could only ever understand one
 * of the two surfaces.
 *
 * Parse errors are left for `wacCompile` to report; the walk only needs the specifiers, and an
 * unreadable file stops it here in any case.
 */
async function readGraph(entry: string, cap: WacxCap): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (files.has(path)) continue;
    const src = await cap.readFile(path);
    files.set(path, src);
    const frontend = frontendFor(path);
    if (!frontend) continue;                       // `wacCompile` says so, with a diagnostic
    for (const spec of importsOf(frontend(src, path).program)) {
      queue.push(resolveFrom(path, spec));
    }
  }
  return files;
}

/** Resolve `spec` against the directory of `from`, collapsing `.` and `..`. */
function resolveFrom(from: string, spec: string): string {
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : ".";
  const joined = `${dir}/${spec}`;
  const absolute = joined.startsWith("/");
  const parts: string[] = [];
  for (const part of joined.split("/")) {
    if (part === "." || part === "") continue;
    if (part === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
    else parts.push(part);
  }
  return (absolute ? "/" : "") + parts.join("/");
}

/** Strip the source extension so `main.wac` and `main.wapy` both become `main`. */
function stem(path: string): string {
  const ext = EXTENSIONS.find((e) => path.endsWith(e));
  return ext ? path.slice(0, -ext.length) : path;
}

/**
 * A CLI argument, coerced for the parameter it is being passed to.
 *
 * `wacx run` gets strings; the export's declared parameter types say what they mean. An i64 needs a
 * BigInt and a bool needs 0/1, so guessing from the text would be wrong for both.
 */
function coerceArg(text: string, type: string): number | bigint | boolean | string {
  // A string parameter takes the argument as written — no coercion at all, which is the whole
  // point of a command line. `wacInstance` builds the wasm string. This used to fall through to
  // `Number(text)` and report "'world' is not a number, but the parameter is string".
  if (type === "string") return text;
  // A host function is passed by a program, not typed at a shell. Saying so beats the
  // engine's "type incompatibility when transforming from/to JS", which is what a
  // funcref parameter used to produce.
  if (type.startsWith("fn[")) {
    throw new Error(
      `the parameter is ${type} — a function has to be passed from JavaScript, ` +
      `so run this export through 'wacx bindgen' output instead`,
    );
  }
  if (type === "i64" || type === "u64") return BigInt(text);
  if (type === "bool") return text === "true" || text === "1";
  const n = Number(text);
  if (Number.isNaN(n)) throw new Error(`'${text}' is not a number, but the parameter is ${type}`);
  return n;
}

/**
 * The export to run when `--call` is not given.
 *
 * `main` if there is one, otherwise the only export if there is exactly one. Anything
 * else is a question rather than a guess — picking the first of several would be a
 * program that runs the wrong thing without saying so.
 */
function defaultEntryPoint(exports: readonly WacExport[]): string | null {
  if (exports.some((e) => e.name === "main")) return "main";
  return exports.length === 1 ? exports[0].name : null;
}

/**
 * How one command-line argument becomes a value of `type`, as a JavaScript expression
 * over `a`. Null when a command line cannot express the type at all.
 *
 * Decided at build time, because the parameter types are known then: the built program
 * carries the conversion it needs rather than a table of every conversion.
 */
function argCoercion(type: string): string | null {
  if (type === "string") return "a";
  if (type === "bool") return `(a === "true" || a === "1")`;
  if (type === "i64" || type === "u64") return "BigInt(a)";
  if (["i32", "u32", "f32", "f64", "i8", "u8", "i16", "u16"].includes(type)) return "num(a)";
  return null; // arrays, structs, funcrefs — not something argv can carry
}

/**
 * A self-contained, executable program: the bindgen module, plus a runner that turns argv
 * into the export's parameters and prints what comes back.
 *
 * Deno reads TypeScript from a file with no extension, so nothing has to be bundled or
 * stripped — the shebang and the generated module are the whole of it.
 */
function buildProgram(compiled: WacCompiled, exp: WacExport): string {
  const params = exp.params.map((p) => p.name).join(", ");
  const conv = exp.params
    .map((p, i) => `  const ${p.name} = ((a) => ${argCoercion(p.type)})(_argv[${i}]);`)
    .join("\n");
  const usage = exp.params.map((p) => `<${p.name}: ${p.type}>`).join(" ");

  return `#!/usr/bin/env -S deno run
${wacBindgen(compiled)}

// ── Runner, generated by \`wacx build\` ────────────────────────────────────────
const _argv = Deno.args;
if (_argv.length !== ${exp.params.length}) {
  // The name it was invoked as, which is what the reader typed — not the export's.
  console.error(\`usage: \${import.meta.url.split("/").pop()} ${usage}\`);
  Deno.exit(2);
}
const num = (a: string): number => {
  const n = Number(a);
  if (Number.isNaN(n) && a.trim().toLowerCase() !== "nan") {
    console.error(\`'\${a}' is not a number\`);
    Deno.exit(2);
  }
  return n;
};
${conv}
try {
  const _v = ${exp.name}(${params});
  if (_v !== undefined && _v !== null) {
    console.log(
      typeof _v === "bigint" ? _v.toString()
      : _v instanceof Uint8Array || Array.isArray(_v) || ArrayBuffer.isView(_v)
        ? Array.from(_v as ArrayLike<unknown>).join(" ")
      : String(_v),
    );
  }
} catch (e) {
  // A trap carries its message when the program wrote one; otherwise this is the
  // engine's own, which is still better than a stack trace.
  console.error(\`\${e instanceof Error ? e.message : String(e)}\`);
  Deno.exit(70);
}
`;
}

/** Render a return value for stdout. An array prints as its elements, a string as itself. */
function renderValue(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map((x) => String(x)).join(" ");
  return String(v);
}

export type WacxResult = { code: number };

/**
 * Run one wacx invocation.
 *
 * Returns an exit code rather than exiting, so a test can assert on it. `wacxMain` is what turns
 * that into a process exit.
 */
export async function wacx(argv: string[], cap: WacxCap): Promise<WacxResult> {
  // `--checked` is a whole-module switch, so it is stripped wherever it appears rather
  // than having to sit in a fixed position.
  const checked = argv.includes("--checked");
  const [command, entry, ...rest] = argv.filter((a) => a !== "--checked");

  if (command === undefined || command === "--help" || command === "-h") {
    cap.out(USAGE);
    return { code: command === undefined ? 1 : 0 };
  }
  if (!["check", "run", "compile", "bindgen", "build"].includes(command)) {
    cap.err(`wacx: unknown command '${command}'\n\n${USAGE}`);
    return { code: 1 };
  }
  if (entry === undefined) {
    cap.err(`wacx ${command}: needs an entry file\n\n${USAGE}`);
    return { code: 1 };
  }

  let files: Map<string, string>;
  try {
    files = await readGraph(entry, cap);
  } catch (e) {
    // A missing import is far more common than a missing entry file, and the message should say
    // which file could not be read rather than only that something could not.
    cap.err(`wacx: ${e instanceof Error ? e.message : String(e)}`);
    return { code: 1 };
  }

  const result = wacCompile(files, entry, { checked });
  if (!result.ok) {
    cap.err(wacDiag(result.diagnostics, files));
    return { code: 1 };
  }
  // Warnings do not fail a build, but they are worth showing on every command rather than only on
  // `check` — a warning nobody sees is not a warning.
  if (result.diagnostics.length > 0) cap.err(wacDiag(result.diagnostics, files));

  if (command === "check") return { code: 0 };

  if (command === "compile") {
    const out = `${stem(entry)}.wasm`;
    await cap.writeFile(out, result.compiled.wasm as Uint8Array);
    cap.out(out);
    return { code: 0 };
  }

  if (command === "build") {
    const callAt = rest.indexOf("--call");
    const outAt = rest.indexOf("-o");
    const fnName = callAt >= 0 ? rest[callAt + 1] : defaultEntryPoint(result.compiled.exports);
    if (fnName === null) {
      cap.err(
        `wacx build: which export should run? Give --call <name>.\n` +
        `  exported: ${result.compiled.exports.map((e) => e.name).join(", ") || "(none)"}`,
      );
      return { code: 1 };
    }
    const exp = result.compiled.exports.find((e) => e.name === fnName);
    if (!exp) {
      cap.err(`wacx build: no export named '${fnName}'\n` +
        `  exported: ${result.compiled.exports.map((e) => e.name).join(", ") || "(none)"}`);
      return { code: 1 };
    }
    const bad = exp.params.find((p) => argCoercion(p.type) === null);
    if (bad) {
      cap.err(
        `wacx build: '${fnName}' takes '${bad.name}: ${bad.type}', which a command line ` +
        `cannot supply.\n  Buildable parameters are numbers, bool and string.`,
      );
      return { code: 1 };
    }
    const out = outAt >= 0 ? rest[outAt + 1] : stem(entry).replace(/^.*\//, "");
    await cap.writeFile(out, buildProgram(result.compiled, exp));
    await cap.chmod?.(out, 0o755);
    cap.out(out);
    return { code: 0 };
  }

  if (command === "bindgen") {
    const out = `${entry}.ts`;
    await cap.writeFile(out, wacBindgen(result.compiled));
    cap.out(out);
    return { code: 0 };
  }

  // run
  const [fnName, ...args] = rest;
  if (fnName === undefined) {
    cap.err(`wacx run: needs a function to call\n\n${USAGE}`);
    return { code: 1 };
  }
  const exp = result.compiled.exports.find((e) => e.name === fnName);
  if (exp === undefined) {
    const names = result.compiled.exports.map((e) => e.name).sort();
    cap.err(
      `wacx run: '${entry}' exports no function '${fnName}'` +
      (names.length > 0 ? `\n  available: ${names.join(", ")}` : `\n  it exports nothing`));
    return { code: 1 };
  }
  if (args.length !== exp.params.length) {
    const sig = exp.params.map((p) => `${p.type} ${p.name}`).join(", ");
    cap.err(
      `wacx run: '${fnName}' takes ${exp.params.length} argument(s), got ${args.length}\n` +
      `  signature: ${exp.ret} ${fnName}(${sig})`);
    return { code: 1 };
  }

  let coerced: (number | bigint | boolean | string)[];
  try {
    coerced = args.map((a, i) => coerceArg(a, exp.params[i].type));
  } catch (e) {
    cap.err(`wacx run: ${e instanceof Error ? e.message : String(e)}`);
    return { code: 1 };
  }

  const inst = await wacInstance(result.compiled);
  try {
    const value = inst.call(fnName, coerced);
    const text = renderValue(value);
    if (text !== "") cap.out(text);
    return { code: 0 };
  } catch (e) {
    // A trap is the program's own behaviour, not a compiler failure, so it is reported as such and
    // distinguished by exit code 2 — a script can tell "did not compile" from "ran and trapped".
    cap.err(`wacx run: '${fnName}' trapped: ${e instanceof Error ? e.message : String(e)}`);
    return { code: 2 };
  }
}

const USAGE = `wacx — the wac compiler CLI

  wacx check   <file>              type-check the file and its imports
  wacx run     <file> <fn> [args]  compile, instantiate, and call fn
  wacx compile <file>              write <file>.wasm
  wacx bindgen <file>              write <file>.wac.ts
  wacx build   <file> [--call fn]  write an executable program, runnable directly

  A file is .wac or .wapy — the same language in two surfaces, freely mixed in
  one import graph. The extension selects the frontend, so it is required.

  --checked   trap on integer overflow in +, - and * (experimental; default is
              to wrap, which is what SHA-256 and CRC-32 are specified to do)

Exit codes: 0 success, 1 a compile or usage error, 2 the program trapped.`;
