// wacx — the unified CLI, as `spec/cli/main.md` specifies it.
//
// Four commands: check, run, compile, bindgen. Each is a thin composition of atoms that already
// exist — the CLI's job is argument handling, file I/O and exit codes, and nothing else.
//
// Every capability it needs is injected, so the whole thing is testable without touching a real
// filesystem or process. That is why `wacx` takes a `cap` and `wacxMain` is the only part that
// reaches for `Deno`.

import { wacCompile } from "./wacCompile.ts";
import { wacInstance } from "./wacInstance.ts";
import { wacBindgen } from "./wacBindgen.ts";
import { wacDiag } from "./wacDiag.ts";
import { wacLex } from "./wacLex.ts";

/** Everything wacx does to the outside world. */
export type WacxCap = {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, data: string | Uint8Array) => Promise<void>;
  out: (text: string) => void;
  err: (text: string) => void;
};

/**
 * Read the entry file and everything it imports.
 *
 * The import graph is walked by lexing rather than by pattern-matching the text, for the reason
 * wac-mono's harness learned the hard way: a doc comment containing an import specifier otherwise
 * sends the walk off to read a file that does not exist.
 */
async function readGraph(entry: string, cap: WacxCap): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (files.has(path)) continue;
    files.set(path, await cap.readFile(path));
    for (const spec of importPaths(files.get(path)!)) {
      queue.push(resolveFrom(path, spec));
    }
  }
  return files;
}

/** Import specifiers in a source file, found by lexing so comments and strings cannot contribute. */
function importPaths(src: string): string[] {
  const { tokens } = wacLex(src);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== "import") continue;
    let j = i + 1;
    while (j < tokens.length && tokens[j].kind !== "from" && tokens[j].kind !== ";") j++;
    if (tokens[j]?.kind === "from" && tokens[j + 1]?.kind === "string") {
      out.push(tokens[j + 1].text);
      i = j + 1;
    }
  }
  return out;
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

/** Strip `.wac` so `main.wac` becomes `main`, for deriving output paths. */
function stem(path: string): string {
  return path.endsWith(".wac") ? path.slice(0, -4) : path;
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
  if (type === "i64" || type === "u64") return BigInt(text);
  if (type === "bool") return text === "true" || text === "1";
  const n = Number(text);
  if (Number.isNaN(n)) throw new Error(`'${text}' is not a number, but the parameter is ${type}`);
  return n;
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
  const [command, entry, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h") {
    cap.out(USAGE);
    return { code: command === undefined ? 1 : 0 };
  }
  if (!["check", "run", "compile", "bindgen"].includes(command)) {
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

  const result = wacCompile(files, entry);
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

  wacx check   <file.wac>              type-check the file and its imports
  wacx run     <file.wac> <fn> [args]  compile, instantiate, and call fn
  wacx compile <file.wac>              write <file>.wasm
  wacx bindgen <file.wac>              write <file>.wac.ts

Exit codes: 0 success, 1 a compile or usage error, 2 the program trapped.`;
