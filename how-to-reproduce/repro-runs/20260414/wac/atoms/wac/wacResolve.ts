// Resolves the import graph starting from an entry file.
// Returns a flat module with all declarations merged, function names mangled,
// and per-file name environments for the type checker.
//
// Function mangling: <fileStem>$<funcName>  (e.g., geometry$distance)
// Struct names are globally unique — no mangling.
// Only the entry file's `export` functions become wasm exports.

import { wacLex, type LexError } from "./wacLex.ts";
import { wacParse, type ParseError } from "./wacParse.ts";
import type { Program, FuncDecl, StructDecl } from "./ast.ts";

// ---- Exported types ----

export type CompileError = {
  message: string;
  file: string;
  line: number;
  col: number;
  phase: "lex" | "parse" | "resolve" | "typecheck";
  span: number;
  annotation?: string;
  hint?: string;
};

export type Cap = {
  readFile(path: string): string;
};

export type ResolvedFunc = {
  decl: FuncDecl;
  mangledName: string;    // e.g., "main$factorial" or "geometry$distance"
  filePath: string;
  isWasmExport: boolean;  // only true for entry file's `export` functions
};

export type ResolvedStruct = {
  decl: StructDecl;
  filePath: string;
};

// Per-file name environment: maps local call-site identifiers to resolved forms.
export type NameEnv = {
  funcs: Map<string, string>;    // local name → mangled function name
  structs: Map<string, string>;  // local name → canonical struct name
};

export type ResolvedModule = {
  funcs: Map<string, ResolvedFunc>;    // mangledName → ResolvedFunc
  structs: Map<string, ResolvedStruct>; // canonicalName → ResolvedStruct
  envs: Map<string, NameEnv>;          // filePath → NameEnv
  entryPath: string;
  errors: CompileError[];
};

// ---- Main export ----

export function wacResolve(cap: Cap, entryPath: string): ResolvedModule {
  type FileEntry = { stem: string; program: Program };
  const files = new Map<string, FileEntry>();
  const errors: CompileError[] = [];

  // Phase 1: Load all files depth-first. Insert a placeholder before recursing
  // so that circular imports are detected and skipped safely.
  function loadFile(filePath: string): void {
    if (files.has(filePath)) return;
    const entry: FileEntry = {
      stem: fileStem(filePath),
      program: { imports: [], structs: [], funcs: [] },
    };
    files.set(filePath, entry);

    let src: string;
    try {
      src = cap.readFile(filePath);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ message: `cannot read file: ${msg}`, file: filePath, line: 1, col: 1, phase: "resolve", span: 1 });
      return;
    }

    const { tokens, errors: lexErrs } = wacLex(src);
    for (const e of lexErrs) errors.push(liftLex(e, filePath));

    const { program, errors: parseErrs } = wacParse(tokens);
    for (const e of parseErrs) errors.push(liftParse(e, filePath));

    entry.program = program;

    for (const imp of program.imports) {
      loadFile(resolvePath(filePath, imp.from));
    }
  }

  loadFile(entryPath);

  // Phase 2: Register all functions and structs in flat maps with mangled names.
  const funcs = new Map<string, ResolvedFunc>();
  const structs = new Map<string, ResolvedStruct>();

  for (const [filePath, { stem, program }] of files) {
    const isEntry = filePath === entryPath;

    // Check for duplicate fields/methods within each struct.
    for (const struct of program.structs) {
      const fieldNames = new Set<string>();
      for (const f of struct.fields) {
        if (fieldNames.has(f.name)) {
          errors.push({ message: `duplicate field '${f.name}' in struct '${struct.name}'`, file: filePath, line: f.line, col: f.col, phase: "resolve", span: f.name.length });
        }
        fieldNames.add(f.name);
      }
      const methodNames = new Set<string>();
      for (const m of struct.methods) {
        if (fieldNames.has(m.name)) {
          errors.push({ message: `'${m.name}' is both a field and method in struct '${struct.name}'`, file: filePath, line: m.line, col: m.col, phase: "resolve", span: m.name.length });
        }
        if (methodNames.has(m.name)) {
          errors.push({ message: `duplicate method '${m.name}' in struct '${struct.name}'`, file: filePath, line: m.line, col: m.col, phase: "resolve", span: m.name.length });
        }
        methodNames.add(m.name);
      }
    }

    // Track local func names per file to detect func vs struct name collisions.
    const localFuncNames = new Set(program.funcs.map(f => f.name));

    for (const struct of program.structs) {
      const mangledName = `${stem}$${struct.name}`;
      if (structs.has(mangledName)) {
        errors.push({ message: `struct '${struct.name}' declared in multiple files`, file: filePath, line: struct.line, col: struct.col, phase: "resolve", span: struct.name.length });
      } else {
        if (localFuncNames.has(struct.name)) {
          errors.push({ message: `'${struct.name}' is both a function and struct name`, file: filePath, line: struct.line, col: struct.col, phase: "resolve", span: struct.name.length });
        }
        structs.set(mangledName, { decl: struct, filePath });
      }
    }

    for (const func of program.funcs) {
      const mangledName = `${stem}$${func.name}`;
      if (funcs.has(mangledName)) {
        errors.push({ message: `duplicate function '${func.name}' in '${stem}'`, file: filePath, line: func.line, col: func.col, phase: "resolve", span: func.name.length });
      } else {
        funcs.set(mangledName, { decl: func, mangledName, filePath, isWasmExport: isEntry && func.isExport });
      }
    }
  }

  // Phase 3: Build per-file name environments (own decls + imports).
  const envs = new Map<string, NameEnv>();

  for (const [filePath, { stem, program }] of files) {
    const env: NameEnv = { funcs: new Map(), structs: new Map() };
    envs.set(filePath, env);

    for (const func of program.funcs) env.funcs.set(func.name, `${stem}$${func.name}`);
    for (const struct of program.structs) env.structs.set(struct.name, `${stem}$${struct.name}`);

    for (const imp of program.imports) {
      const importedPath = resolvePath(filePath, imp.from);
      const imported = files.get(importedPath)!;

      const exportedFuncs = new Set(imported.program.funcs.filter(f => f.isExport).map(f => f.name));
      const exportedStructs = new Set(imported.program.structs.map(s => s.name));

      for (const item of imp.items) {
        if (exportedFuncs.has(item.name)) {
          // Check for collision with existing local or imported name.
          if (env.funcs.has(item.as) || env.structs.has(item.as)) {
            errors.push({ message: `imported name '${item.as}' collides with existing name`, file: filePath, line: item.line, col: item.col, phase: "resolve", span: item.as.length });
          } else {
            env.funcs.set(item.as, `${imported.stem}$${item.name}`);
          }
        } else if (exportedStructs.has(item.name)) {
          if (env.funcs.has(item.as) || env.structs.has(item.as)) {
            errors.push({ message: `imported name '${item.as}' collides with existing name`, file: filePath, line: item.line, col: item.col, phase: "resolve", span: item.as.length });
          } else {
            env.structs.set(item.as, `${imported.stem}$${item.name}`);
          }
        } else {
          errors.push({ message: `'${item.name}' is not exported by '${imp.from}'`, file: filePath, line: item.line, col: item.col, phase: "resolve", span: item.name.length });
        }
      }
    }
  }

  return { funcs, structs, envs, entryPath, errors };
}

// ---- Helpers ----

function liftLex(e: LexError, file: string): CompileError {
  return { message: e.message, file, line: e.line, col: e.col, phase: "lex", span: e.span };
}

function liftParse(e: ParseError, file: string): CompileError {
  return { message: e.message, file, line: e.line, col: e.col, phase: "parse", span: e.span, annotation: e.annotation, hint: e.hint };
}

function fileStem(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(0, dot) : base;
}

function resolvePath(base: string, rel: string): string {
  const lastSlash = base.lastIndexOf("/");
  const dir = lastSlash >= 0 ? base.slice(0, lastSlash + 1) : "";
  return normalizePath(dir + rel);
}

function normalizePath(path: string): string {
  const parts = path.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      if (out.length > 0) out.pop();
    } else if (part !== ".") {
      out.push(part);
    }
  }
  return out.join("/");
}
