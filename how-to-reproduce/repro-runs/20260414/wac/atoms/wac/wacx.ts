// wacx — unified CLI for the wac compiler.
//
// Commands:
//   check   <file.wac>             — type-check, report errors to stderr
//   run     <file.wac> <fn> [args] — compile + instantiate + call fn
//   compile <file.wac>             — emit <file.wasm>
//   bindgen <file.wac>             — emit <file.wac.ts>

import { wacCompile } from "./wacCompile.ts";
import { wacInstance, type Cap as InstanceCap } from "./wacInstance.ts";
import { wacBindTs } from "./wacBindTs.ts";
import type { CompileError } from "./wacResolve.ts";

// ---- Cap ----

export type Cap = InstanceCap & {
  Deno: {
    args: string[];
    readTextFileSync(path: string): string;
    writeFileSync(path: string, data: Uint8Array): void;
    writeTextFileSync(path: string, data: string): void;
    exit(code: number): never;
  };
  console: {
    log(s: string): void;
    error(s: string): void;
  };
};

// ---- Main export ----

export async function main(cap: Cap): Promise<void> {
  const [cmd, file, ...rest] = cap.Deno.args;

  if (!cmd || !file) {
    cap.console.error("usage: wacx <check|run|compile|bindgen> <file.wac> [...]");
    return cap.Deno.exit(1);
  }

  const readFile = (p: string): string => {
    try { return cap.Deno.readTextFileSync(p); } catch { return ""; }
  };

  switch (cmd) {
    case "check":   return cmdCheck(cap, file, readFile);
    case "run":     return cmdRun(cap, file, rest, readFile);
    case "compile": return cmdCompile(cap, file, readFile);
    case "bindgen": return cmdBindgen(cap, file, readFile);
    default:
      cap.console.error(`error: unknown command '${cmd}'`);
      return cap.Deno.exit(1);
  }
}

// ---- Commands ----

function cmdCheck(
  cap: Cap,
  file: string,
  readFile: (p: string) => string,
): void {
  const result = wacCompile({ readFile }, file);
  if (!result.ok) {
    for (const err of result.errors) {
      cap.console.error(formatError(err, readFile));
    }
    cap.Deno.exit(1);
  }
}

async function cmdRun(
  cap: Cap,
  file: string,
  rest: string[],
  readFile: (p: string) => string,
): Promise<void> {
  const [fn, ...rawArgs] = rest;
  if (!fn) {
    cap.console.error("usage: wacx run <file.wac> <fn> [args...]");
    return cap.Deno.exit(1);
  }

  const result = wacCompile({ readFile }, file);
  if (!result.ok) {
    for (const err of result.errors) cap.console.error(formatError(err, readFile));
    return cap.Deno.exit(1);
  }

  const inst = await wacInstance(cap, result);
  const func = inst[fn];
  if (!func) {
    cap.console.error(`error: function '${fn}' not found in ${file}`);
    return cap.Deno.exit(1);
  }

  // Parse raw string args using the export's param types.
  const exp = result.exports.find(e => e.name === fn);
  const typedArgs = rawArgs.map((a, i) => parseArg(a, exp?.params[i]?.type ?? "i32"));
  const ret = func(...typedArgs);
  if (ret !== undefined) cap.console.log(String(ret));
}

function cmdCompile(
  cap: Cap,
  file: string,
  readFile: (p: string) => string,
): void {
  const result = wacCompile({ readFile }, file);
  if (!result.ok) {
    for (const err of result.errors) cap.console.error(formatError(err, readFile));
    return cap.Deno.exit(1);
  }

  const outPath = file.replace(/\.wac$/, ".wasm");
  cap.Deno.writeFileSync(outPath, result.wasm);
  cap.console.log(`wrote ${outPath}`);
}

function cmdBindgen(
  cap: Cap,
  file: string,
  readFile: (p: string) => string,
): void {
  const result = wacCompile({ readFile }, file);
  if (!result.ok) {
    for (const err of result.errors) cap.console.error(formatError(err, readFile));
    return cap.Deno.exit(1);
  }

  const ts = wacBindTs(result);
  const outPath = file + ".ts";
  cap.Deno.writeTextFileSync(outPath, ts);
  cap.console.log(`wrote ${outPath}`);
}

// ---- Helpers ----

// Format a CompileError as a human-readable diagnostic string.
function formatError(err: CompileError, readFile: (p: string) => string): string {
  const numW  = Math.max(2, String(err.line).length);
  const pad   = " ".repeat(numW);
  const line  = String(err.line).padStart(numW);
  const src   = readFile(err.file).split("\n")[err.line - 1] ?? "";
  const under = " ".repeat(err.col - 1) + "^".repeat(Math.max(1, err.span));
  const ann   = err.annotation ? ` ${err.annotation}` : "";

  let out = `error: ${err.message}\n`;
  out += `  --> ${err.file}:${err.line}:${err.col}\n`;
  out += `${pad} |\n`;
  out += `${line} | ${src}\n`;
  out += `${pad} | ${under}${ann}`;
  if (err.hint) out += `\n${pad} = help: ${err.hint}`;
  return out;
}

// Parse a CLI argument string to a wac-typed JS value.
function parseArg(raw: string, type: string): number | bigint | boolean {
  if (type === "i64")              return BigInt(raw);
  if (type === "bool")             return raw === "true";
  if (type === "f32" || type === "f64") return parseFloat(raw);
  return parseInt(raw, 10);        // i32 (and fallback)
}
