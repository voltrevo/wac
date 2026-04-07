// Resolver for wac — walks the import graph, builds a flat symbol table,
// and assigns stable wasm function/type indices to every declaration.
//
// Input: entry file path + a map of pre-parsed programs (path → Program).
// The programs map must include all files reachable from the entry file.
// Import paths are resolved relative to the importing file's directory.

import {
  type Program, type FuncDecl, type StructDecl, type MethodDecl,
  type Param, type WacType,
} from "./wacParse.ts";

// ── Public types ──────────────────────────────────────────────────────────────

export type Pos = { file: string; line: number; col: number };

export type ResolveError = { message: string } & Pos;

// A function or method entry in the flat function table.
export type FuncOrigin =
  | { kind: "func";   decl: FuncDecl }
  | { kind: "method"; decl: MethodDecl; structName: string };

export type FuncEntry = {
  origin: FuncOrigin;
  /** "stem$name" for module-level functions, "Struct$method" for methods */
  mangledName: string;
  /** Wasm export name if `export`-marked, else null */
  exportName: string | null;
  /** 0-based wasm function index */
  funcIndex: number;
  filePath: string;
};

// A struct type entry in the flat type table.
export type StructEntry = {
  structDecl: StructDecl;
  /** Canonical struct name (struct names are globally unique) */
  name: string;
  /** 0-based wasm type index */
  typeIndex: number;
  filePath: string;
  /** Methods of this struct, keyed by method name */
  methods: Map<string, FuncEntry>;
};

export type ScopeEntry =
  | { kind: "func";   entry: FuncEntry }
  | { kind: "struct"; entry: StructEntry };

/** Per-file scope: maps the local name used in this file → the resolved entry */
export type FileScope = Map<string, ScopeEntry>;

export type ResolveResult = {
  /** All functions in wasm function index order (functions first, then methods) */
  funcs: FuncEntry[];
  /** All struct types in wasm type index order */
  structs: StructEntry[];
  /** Per-file scope maps */
  fileScopes: Map<string, FileScope>;
  errors: ResolveError[];
};

// ── Implementation ────────────────────────────────────────────────────────────

/** Resolve a relative import path against an absolute base path. */
function resolvePath(baseFile: string, rel: string): string {
  // baseFile is like "/dir/file.wac" or "dir/file.wac"
  const dir = baseFile.includes("/")
    ? baseFile.slice(0, baseFile.lastIndexOf("/"))
    : ".";
  return joinPath(dir, rel);
}

function joinPath(dir: string, rel: string): string {
  const parts = (dir + "/" + rel).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" && out.length > 0) continue;
    if (p === ".") continue;
    if (p === "..") { if (out.length > 0 && out[out.length - 1] !== "..") { out.pop(); } else { out.push(".."); } }
    else out.push(p);
  }
  return out.join("/");
}

/** Extract the file stem (filename without path or extension). */
function stem(filePath: string): string {
  const base = filePath.includes("/") ? filePath.slice(filePath.lastIndexOf("/") + 1) : filePath;
  return base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
}

export function wacResolve(
  entryPath: string,
  programs: Map<string, Program>,
): ResolveResult {
  const errors: ResolveError[] = [];
  const funcs: FuncEntry[] = [];
  const structs: StructEntry[] = [];
  const fileScopes = new Map<string, FileScope>();
  const visited = new Set<string>();
  // Track visit-in-progress paths for cycle detection (circular is OK, just don't double-register)
  const inProgress = new Set<string>();

  function err(msg: string, file: string, line = 0, col = 0): void {
    errors.push({ message: msg, file, line, col });
  }

  function visitFile(filePath: string): void {
    if (visited.has(filePath)) return;
    // If currently in progress (circular import), we allow it — just don't revisit.
    // Mark as visited immediately to break cycles.
    visited.add(filePath);
    inProgress.add(filePath);

    const prog = programs.get(filePath);
    if (!prog) {
      err(`file not found in programs map: '${filePath}'`, filePath);
      fileScopes.set(filePath, new Map());
      inProgress.delete(filePath);
      return;
    }

    const scope: FileScope = new Map();

    // ── Phase 1: process imports (DFS — visit imported files first) ───────────
    for (const item of prog.items) {
      if (item.tag !== "import") continue;
      const importedPath = resolvePath(filePath, item.path);
      visitFile(importedPath); // recursive DFS

      const importedScope = fileScopes.get(importedPath);
      if (!importedScope) continue; // file not found — already reported

      for (const { name, alias, line, col } of item.items) {
        const found = importedScope.get(name);
        if (!found) {
          err(`'${name}' is not exported from '${importedPath}'`, filePath, line, col);
          continue;
        }
        // Only allow importing exported functions and structs
        if (found.kind === "func" && found.entry.exportName === null) {
          err(`'${name}' is not exported from '${importedPath}'`, filePath, line, col);
          continue;
        }
        if (scope.has(alias)) {
          err(`duplicate name '${alias}' (from import)`, filePath, line, col);
          continue;
        }
        scope.set(alias, found);
      }
    }

    // ── Phase 2: register local struct declarations ───────────────────────────
    for (const item of prog.items) {
      if (item.tag !== "struct") continue;
      const { name, line, col } = item;
      if (scope.has(name)) {
        err(`duplicate name '${name}'`, filePath, line, col);
        continue;
      }
      const typeIndex = structs.length;
      const structEntry: StructEntry = {
        structDecl: item, name, typeIndex, filePath, methods: new Map(),
      };
      structs.push(structEntry);
      scope.set(name, { kind: "struct", entry: structEntry });
    }

    // ── Phase 3: register local function declarations ─────────────────────────
    const fileStem = stem(filePath);
    for (const item of prog.items) {
      if (item.tag !== "func") continue;
      const { name, line, col } = item;
      if (scope.has(name)) {
        err(`duplicate name '${name}'`, filePath, line, col);
        continue;
      }
      const mangledName = `${fileStem}$${name}`;
      const exportName = item.exported ? name : null;
      const funcIndex = funcs.length;
      const entry: FuncEntry = {
        origin: { kind: "func", decl: item },
        mangledName, exportName, funcIndex, filePath,
      };
      funcs.push(entry);
      scope.set(name, { kind: "func", entry });
    }

    // ── Phase 4: register methods for all structs in this file ───────────────
    // Methods are registered in a second pass so structs are in scope first.
    for (const item of prog.items) {
      if (item.tag !== "struct") continue;
      const structScopeEntry = scope.get(item.name);
      if (!structScopeEntry || structScopeEntry.kind !== "struct") continue;
      const structEntry = structScopeEntry.entry;

      const methodNames = new Set<string>();
      for (const method of item.methods) {
        const { name: mname, line, col } = method;
        if (methodNames.has(mname)) {
          err(`duplicate method '${mname}' in struct '${item.name}'`, filePath, line, col);
          continue;
        }
        // Check for field/method collision
        const hasField = item.fields.some(f => f.name === mname);
        if (hasField) {
          err(`'${mname}' already declared as field in struct '${item.name}'`, filePath, line, col);
          continue;
        }
        methodNames.add(mname);
        const mangledName = `${item.name}$${mname}`;
        const funcIndex = funcs.length;
        const methodEntry: FuncEntry = {
          origin: { kind: "method", decl: method, structName: item.name },
          mangledName,
          exportName: null,  // methods are never directly wasm-exported
          funcIndex, filePath,
        };
        funcs.push(methodEntry);
        structEntry.methods.set(mname, methodEntry);
      }

      // Also check for duplicate fields
      const fieldNames = new Set<string>();
      for (const field of item.fields) {
        if (fieldNames.has(field.name)) {
          err(`duplicate field '${field.name}' in struct '${item.name}'`, filePath, field.line, field.col);
        }
        fieldNames.add(field.name);
      }
    }

    fileScopes.set(filePath, scope);
    inProgress.delete(filePath);
  }

  visitFile(entryPath);
  return { funcs, structs, fileScopes, errors };
}

// ── Helpers for consumers ─────────────────────────────────────────────────────

/** Get the return type of a FuncEntry (works for both functions and methods). */
export function funcReturnType(entry: FuncEntry): WacType {
  return entry.origin.kind === "func"
    ? entry.origin.decl.returnType
    : entry.origin.decl.returnType;
}

/** Get the parameters of a FuncEntry (works for both functions and methods). */
export function funcParams(entry: FuncEntry): Param[] {
  return entry.origin.kind === "func"
    ? entry.origin.decl.params
    : entry.origin.decl.params;
}

/** Whether this FuncEntry is a method (has `this`). */
export function isMethod(entry: FuncEntry): boolean {
  return entry.origin.kind === "method";
}
