// Resolver for wac — walks the import graph, builds a flat symbol table,
// and assigns stable wasm function/type indices to every declaration.
//
// Input: entry file path + a map of pre-parsed programs (path → Program).
// The programs map must include all files reachable from the entry file.
// Import paths are resolved relative to the importing file's directory.

import {
  type Program, type FuncDecl, type StructDecl, type MethodDecl, type EnumDecl, type ConstDecl,
  type FieldDecl, type Param, type WacType, type Expr, type Stmt, type Block, type Lvalue,
} from "./wacParse.ts";

// ── Public types ──────────────────────────────────────────────────────────────

export type Pos = { file: string; line: number; col: number };

export type ResolveError = { message: string } & Pos;

// A function or method entry in the flat function table.
export type FuncOrigin =
  | { kind: "func";   decl: FuncDecl }
  // structName is the struct's own declared name — only unique within its
  // own file (see StructEntry.name). structTypeIndex is the globally-unique
  // typeIndex of the specific struct this method belongs to; use it instead
  // of re-resolving structName through a bare-name map.
  | { kind: "method"; decl: MethodDecl; structName: string; structTypeIndex: number };

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
  /** Declared struct name — only unique within its own file */
  name: string;
  /** 0-based wasm type index (globally unique — this is the struct's identity) */
  typeIndex: number;
  filePath: string;
  /** Methods of this struct, keyed by method name */
  methods: Map<string, FuncEntry>;
  /**
   * Parent struct, resolved through the declaring file's own scope (so an
   * imported or aliased parent resolves correctly, and a same-named struct in
   * an unrelated file can't be picked up by accident). null = no parent.
   * Consumers must walk this instead of re-resolving structDecl.parent
   * through a bare-name map.
   */
  parentEntry: StructEntry | null;
};

/**
 * One variant, after desugaring: the synthetic struct that represents it, plus the
 * tag value the constructor stores and `match` dispatches on.
 */
export type VariantEntry = {
  name: string;
  tag: number;
  entry: StructEntry;
  fields: Param[];
};

/**
 * An enum.
 *
 * The enum itself and each of its variants are registered as ordinary structs — the
 * base holds the tag, each variant extends it and adds its payload — so every
 * downstream stage handles them with the struct machinery it already has. This entry
 * exists so the *set* of variants survives desugaring, which is what makes
 * exhaustiveness checkable.
 */
export type EnumEntry = {
  enumDecl: EnumDecl;
  name: string;
  base: StructEntry;
  variants: VariantEntry[];
  filePath: string;
};

export type ScopeEntry =
  | { kind: "func";    entry: FuncEntry }
  | { kind: "struct";  entry: StructEntry }
  | { kind: "enum";    entry: StructEntry; enumEntry: EnumEntry }
  // `entry` is the variant's own synthetic struct, so every scope kind exposes the
  // struct a name denotes and callers that only want that need no special case.
  | { kind: "variant"; entry: StructEntry; enumEntry: EnumEntry; variant: VariantEntry }
  // A module-level constant carries its declared type and its initialiser. The
  // emitter substitutes the initialiser at each use rather than allocating
  // storage, so there is no global and no initialisation order.
  | { kind: "const";   decl: ConstDecl; exported: boolean; filePath: string };

/** Per-file scope: maps the local name used in this file → the resolved entry */
export type FileScope = Map<string, ScopeEntry>;

export type ResolveResult = {
  /** All functions in wasm function index order (functions first, then methods) */
  funcs: FuncEntry[];
  /** All struct types in wasm type index order */
  structs: StructEntry[];
  /**
   * Every enum, in declaration order. The variants are also present in `structs`;
   * this exists so the variant *set* survives desugaring, which exhaustiveness
   * checking needs.
   */
  enums: EnumEntry[];
  /** Per-file scope maps */
  fileScopes: Map<string, FileScope>;
  errors: ResolveError[];
  /** Entry file path (only functions from this file are wasm-exported) */
  entryPath: string;
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

// ── Type-annotation pre-pass ──────────────────────────────────────────────────
// Every struct-kind WacType in a file's AST gets its resolvedTypeIndex set by
// looking the written name up in that file's scope. This is what gives types
// identity: downstream phases compare/key struct types by resolvedTypeIndex,
// never by the (file-local, alias-dependent) name string. Unknown names are
// left unannotated — the type checker reports them.

function annotateType(t: WacType, scope: FileScope): void {
  switch (t.kind) {
    case "prim": return;
    case "struct": {
      const found = scope.get(t.name);
      if (found?.kind === "struct") t.resolvedTypeIndex = found.entry.typeIndex;
      return;
    }
    case "array":    return annotateType(t.elem, scope);
    case "nullable": return annotateType(t.inner, scope);
    case "funcref":
      for (const p of t.params) annotateType(p, scope);
      return annotateType(t.ret, scope);
  }
}

const TYPE_KINDS = new Set(["prim", "struct", "array", "nullable", "funcref"]);

function annotateExpr(e: Expr, scope: FileScope): void {
  switch (e.kind) {
    case "int": case "float": case "string": case "bool":
    case "null": case "ident":
      return;
    case "unary":   return annotateExpr(e.expr, scope);
    case "binary":  annotateExpr(e.left, scope); return annotateExpr(e.right, scope);
    case "cast":    annotateExpr(e.expr, scope); return annotateType(e.type, scope);
    case "is":
      annotateExpr(e.expr, scope);
      if (typeof e.rhs === "string") return;               // "null"
      if (TYPE_KINDS.has(e.rhs.kind)) return annotateType(e.rhs as WacType, scope);
      return annotateExpr(e.rhs as Expr, scope);
    case "ternary":
      annotateExpr(e.cond, scope); annotateExpr(e.then, scope);
      return annotateExpr(e.else_, scope);
    case "call":
      annotateExpr(e.callee, scope);
      for (const a of e.args) annotateExpr(a, scope);
      return;
    case "index":   annotateExpr(e.expr, scope); return annotateExpr(e.idx, scope);
    case "field":   return annotateExpr(e.expr, scope);
    case "unwrap":  return annotateExpr(e.expr, scope);
    case "construct":
      annotateType(e.ctype, scope);
      for (const a of e.args) annotateExpr(a, scope);
      for (const n of e.named ?? []) annotateExpr(n.val, scope);
      return;
    case "arrNew":
      annotateType(e.elem, scope);
      if (e.size) annotateExpr(e.size, scope);
      for (const f of e.fixed) annotateExpr(f, scope);
      return;
    case "incr-expr":
      return annotateLvalue(e.lval, scope);
  }
}

function annotateLvalue(lv: Lvalue, scope: FileScope): void {
  switch (lv.kind) {
    case "lv-ident":  return;
    case "lv-field":  return annotateLvalue(lv.base, scope);
    case "lv-index":  annotateLvalue(lv.base, scope); return annotateExpr(lv.idx, scope);
    case "lv-unwrap": return annotateLvalue(lv.base, scope);
  }
}

function annotateStmt(s: Stmt, scope: FileScope): void {
  switch (s.kind) {
    case "var":     annotateType(s.type, scope); return annotateExpr(s.init, scope);
    case "assign":  annotateLvalue(s.lval, scope); return annotateExpr(s.rhs, scope);
    case "incr":    return annotateLvalue(s.lval, scope);
    case "if":
      annotateExpr(s.cond, scope); annotateBlock(s.then, scope);
      if (s.els?.kind === "else-if") annotateStmt(s.els.stmt, scope);
      else if (s.els?.kind === "else-block") annotateBlock(s.els.block, scope);
      return;
    case "while":   annotateExpr(s.cond, scope); return annotateBlock(s.body, scope);
    case "for":
      if (s.init) annotateStmt(s.init, scope);
      if (s.cond) annotateExpr(s.cond, scope);
      if (s.update) annotateStmt(s.update, scope);
      return annotateBlock(s.body, scope);
    case "dowhile": annotateBlock(s.body, scope); return annotateExpr(s.cond, scope);
    case "switch":
      annotateExpr(s.expr, scope);
      for (const c of s.cases) {
        if (c.value !== "default") annotateExpr(c.value, scope);
        for (const st of c.body) annotateStmt(st, scope);
      }
      return;
    case "return":  if (s.value) annotateExpr(s.value, scope); return;
    case "break": case "continue": case "trap": return;
    case "block":   return annotateBlock(s.block, scope);
    case "expr":    return annotateExpr(s.expr, scope);
  }
}

function annotateBlock(b: Block, scope: FileScope): void {
  for (const s of b.stmts) annotateStmt(s, scope);
}

function annotateProgram(prog: Program, scope: FileScope): void {
  for (const item of prog.items) {
    if (item.tag === "func") {
      annotateType(item.returnType, scope);
      for (const p of item.params) annotateType(p.type, scope);
      annotateBlock(item.body, scope);
    } else if (item.tag === "struct") {
      for (const f of item.fields) annotateType(f.type, scope);
      for (const m of item.methods) {
        annotateType(m.returnType, scope);
        for (const p of m.params) annotateType(p.type, scope);
        annotateBlock(m.body, scope);
      }
    }
  }
}

/**
 * The synthetic tag field's name.
 *
 * Not a legal identifier, so a payload field can never collide with it and a user
 * cannot read or write it by accident.
 */
export const ENUM_TAG_FIELD = "#tag";

/** The file a scope entry was declared in, whatever kind it is. */
function scopeEntryFile(e: ScopeEntry): string {
  if (e.kind === "const") return e.filePath;
  return e.entry.filePath;
}

/** Is a scope entry exported from its declaring file? */
function scopeEntryExported(e: ScopeEntry): boolean {
  if (e.kind === "func") return e.entry.exportName !== null;
  if (e.kind === "struct") return e.entry.structDecl.exported;
  if (e.kind === "enum") return e.enumEntry.enumDecl.exported;
  if (e.kind === "const") return e.exported;
  // A variant is exported exactly when its enum is: they are one declaration.
  return e.enumEntry.enumDecl.exported;
}

export function wacResolve(
  entryPath: string,
  programs: Map<string, Program>,
): ResolveResult {
  const errors: ResolveError[] = [];
  const funcs: FuncEntry[] = [];
  const structs: StructEntry[] = [];
  const enums: EnumEntry[] = [];
  // Keyed by "file:name" because an enum name is only unique within its own file,
  // the same reason struct identity is the type index rather than the name.
  const enumsByName = new Map<string, EnumEntry>();
  const fileScopes = new Map<string, FileScope>();
  const visited = new Set<string>();
  // Track visit-in-progress paths for cycle detection (circular is OK, just don't double-register)
  const inProgress = new Set<string>();

  function err(msg: string, file: string, line = 0, col = 0): void {
    errors.push({ message: msg, file, line, col });
  }

  function visitFile(filePath: string): void {
    if (visited.has(filePath)) return;
    visited.add(filePath);

    const prog = programs.get(filePath);
    if (!prog) {
      err(`file not found in programs map: '${filePath}'`, filePath);
      fileScopes.set(filePath, new Map());
      return;
    }

    const scope: FileScope = new Map();
    // Set scope early so circular imports can find local declarations.
    fileScopes.set(filePath, scope);

    // ── Phase 1: register local struct declarations ───────────────────────────
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
        parentEntry: null,
      };
      structs.push(structEntry);
      scope.set(name, { kind: "struct", entry: structEntry });
    }

    // ── Phase 1b: desugar enum declarations into structs ─────────────────────
    //
    // Each enum becomes a base struct holding the tag plus one subtype per variant
    // carrying its payload. Registering them as ordinary structs is what lets the
    // type checker and emitter handle enums with no new machinery: `Shape s` is a
    // struct-typed local, `s.radius` is a field read on a subtype, and the
    // subtyping the language already has makes a variant assignable to the enum.
    for (const item of prog.items) {
      if (item.tag !== "enum") continue;
      const { name, line, col } = item;
      if (scope.has(name)) {
        err(`duplicate name '${name}'`, filePath, line, col);
        continue;
      }

      // The base carries only the tag, so every variant shares one field layout
      // prefix and a match can read the tag without knowing the variant.
      const tagField: FieldDecl = {
        isConst: true,
        type: { kind: "prim", name: "i32", line, col },
        name: ENUM_TAG_FIELD,
        line, col,
      };
      const baseDecl: StructDecl = {
        tag: "struct", isConst: false, exported: item.exported, name,
        parent: null, fields: [tagField], methods: [], line, col,
      };
      const base: StructEntry = {
        structDecl: baseDecl, name, typeIndex: structs.length, filePath,
        methods: new Map(), parentEntry: null,
      };
      structs.push(base);
      const variants: VariantEntry[] = [];
      const enumEntry: EnumEntry = {
        enumDecl: item, name, base, variants, filePath,
      };
      scope.set(name, { kind: "enum", entry: base, enumEntry });

      for (let tag = 0; tag < item.variants.length; tag++) {
        const v = item.variants[tag];
        if (scope.has(v.name)) {
          err(`duplicate name '${v.name}'`, filePath, v.line, v.col);
          continue;
        }
        // A variant lists only its payload; inherited fields are computed later, so
        // the tag is not repeated here.
        const variantDecl: StructDecl = {
          tag: "struct", isConst: false, exported: item.exported, name: v.name,
          parent: name,
          fields: v.fields.map((f) => ({
            isConst: true, type: f.type, name: f.name, line: f.line, col: f.col,
          })),
          methods: [], line: v.line, col: v.col,
        };
        const vEntry: StructEntry = {
          structDecl: variantDecl, name: v.name, typeIndex: structs.length,
          filePath, methods: new Map(), parentEntry: base,
        };
        structs.push(vEntry);
        const variant: VariantEntry = {
          name: v.name, tag, entry: vEntry, fields: v.fields,
        };
        variants.push(variant);
        // Registered as a variant rather than a plain struct, so a constructor call
        // can find its tag and `Shape.Circle` can be told from a static method.
        scope.set(v.name, { kind: "variant", entry: vEntry, enumEntry, variant });
      }

      enums.push(enumEntry);
      enumsByName.set(`${filePath}:${name}`, enumEntry);
    }

    // ── Phase 2: register local function declarations ─────────────────────────
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

    // ── Constants ─────────────────────────────────────────────────────────────
    for (const item of prog.items) {
      if (item.tag !== "const") continue;
      if (scope.has(item.name)) {
        errors.push({
          message: `duplicate name '${item.name}'`,
          file: filePath, line: item.line, col: item.col,
        });
        continue;
      }
      scope.set(item.name, {
        kind: "const", decl: item, exported: item.exported, filePath,
      });
    }

    // ── Phase 3: register methods for all structs in this file ───────────────
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
        const mangledName = `${fileStem}$${item.name}$${mname}`;
        const funcIndex = funcs.length;
        const methodEntry: FuncEntry = {
          origin: { kind: "method", decl: method, structName: item.name, structTypeIndex: structEntry.typeIndex },
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

    // ── Phase 4: process imports (DFS — after locals so circular deps find us) ─
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
        // Only allow importing exported functions and structs that the named
        // file itself declares — importing a symbol does not re-export it
        // [§wac-no-reexport-f7kn4wq].
        if (scopeEntryFile(found) !== importedPath) {
          err(`'${name}' is not exported from '${importedPath}' — importing a symbol does not re-export it`,
            filePath, line, col);
          continue;
        }
        if (!scopeEntryExported(found)) {
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

    // ── Phase 5: annotate every struct-type reference with its resolved
    // identity (scope is complete now that imports are processed) ────────────
    annotateProgram(prog, scope);
  }

  visitFile(entryPath);

  // ── Final pass: resolve parent-struct names through each struct's own
  // file scope (imports are aliases, so this must NOT use a bare-name map) ───
  for (const s of structs) {
    const parentName = s.structDecl.parent;
    if (!parentName) continue;
    const found = fileScopes.get(s.filePath)?.get(parentName);
    // An enum's base is a struct registered under the "enum" kind, and a variant's
    // synthetic declaration names it as its parent, so both kinds are valid here.
    if (found?.kind === "struct" || found?.kind === "enum") {
      s.parentEntry = found.entry;
    } else {
      err(`unknown parent struct '${parentName}'`, s.filePath,
        s.structDecl.line, s.structDecl.col);
    }
  }

  return { funcs, structs, enums, fileScopes, errors, entryPath };
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

/** Closest common ancestor of two structs (walking parentEntry chains,
 *  inclusive — a struct is its own ancestor), or null if unrelated. */
export function commonAncestor(a: StructEntry, b: StructEntry): StructEntry | null {
  const aChain = new Set<number>();
  for (let e: StructEntry | null = a; e; e = e.parentEntry) aChain.add(e.typeIndex);
  for (let e: StructEntry | null = b; e; e = e.parentEntry) {
    if (aChain.has(e.typeIndex)) return e;
  }
  return null;
}
