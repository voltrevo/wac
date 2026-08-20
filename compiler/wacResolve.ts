// Resolver for wac — walks the import graph, builds a flat symbol table,
// and assigns stable wasm function/type indices to every declaration.
//
// Input: entry file path + a map of pre-parsed programs (key → Program).
// The programs map must include everything reachable from the entry file, `core` included when it
// is imported — wacCompile puts it there. A key is a file path for a relative import and a
// provider's module name for a prefixed one; `importKey` is the only thing that decides which.

import {
  type Program, type FuncDecl, type StructDecl, type MethodDecl, type EnumDecl, type ConstDecl,
  type FieldDecl, type Param, type WacType, type Expr, type Stmt, type Block, type Lvalue,
  type MatchArm,
} from "./wacParse.ts";
import { wacIntLit } from "./wacIntLit.ts";
import { CORE, isBuiltinSpecifier } from "./wacCore.ts";

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
  /**
   * Set when this struct was generated for an `enum` rather than written by hand:
   * `"base"` for the enum's own struct, `"variant"` for one of its variants.
   *
   * What needs it is defaultability. The base struct's only field is the i32 tag,
   * which has a default, so the ordinary rule concluded that an enum has a default —
   * but a bare base is no variant at all, and a default-constructed variant carries
   * tag 0 rather than its own. Both are values no `match` can handle, and they were
   * reachable through `S()` on a struct with an enum field and through `E[n]()`.
   */
  enumRole?: "base" | "variant";
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
  /**
   * The generic templates, kept after monomorphisation removed them from the programs.
   *
   * The type checker checks each one *once* with its parameters treated as opaque, so a mistake
   * that has nothing to do with `T` is reported at the definition rather than at each use — or
   * never, for a template nobody instantiates [issue 0043].
   */
  templates: { decl: StructDecl; filePath: string }[];
  /** The generic *function* templates, kept and checked the same way. */
  funcTemplates: { decl: FuncDecl; filePath: string }[];
  /**
   * The generic *enum* templates.
   *
   * Not checked at their definition — an enum's methods need the enum machinery, which does not
   * exist for a declaration that has not been desugared — but their names are needed, so a struct
   * or function template mentioning `Option<T>` does not report against a name that is a template
   * rather than a type.
   */
  enumTemplates: { decl: EnumDecl; filePath: string }[];
  /**
   * Every name the compiler invented, and what to show instead.
   *
   * `Vec$i32` -> `Vec<i32>` for each monomorphised generic, and `Point__p` -> `Point` for the
   * cross-file alias a substituted argument type is renamed to. Diagnostics render names through
   * this, so a message never shows one the author did not write — which is the whole difference
   * between this feature and a C++ template error.
   */
  genericDisplay: Map<string, string>;
};

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * The key an import names — the single place a specifier becomes the string a program is filed
 * under, so that "which module is this" has one answer rather than four.
 *
 * A prefixed import does not join against the importing file's directory, and that is D3 of
 * `design/0001` falling out rather than being enforced: an embedded module has no directory to be
 * relative to, and a source inside a provider cannot climb out of one it never entered.
 */
function importKey(
  baseFile: string,
  imp: { path: string; prefix?: string },
  roots?: ReadonlyMap<string, string>,
  /** The directory relative keys are measured from — see `relativeTo`. `issues/lang/0168a`. */
  base?: string,
): string {
  // **A built-in is its own key.** `core/option.wac` is a module inside the compiler, so joining it
  // to the importing file's directory would look for packages/std/src/core/option.wac — and the
  // failure surfaces as *'Option' is not generic*, because the declaration was never found and a
  // stand-in was. Three resolvers have to agree about this; `isBuiltinSpecifier` is the one answer.
  if (imp.prefix === undefined && isBuiltinSpecifier(imp.path)) return imp.path;
  if (imp.prefix === undefined) return resolveSpecifier(baseFile, imp.path, roots?.get(baseFile), base);
  return imp.path === "" ? imp.prefix : `${imp.prefix}.${imp.path}`;
}

/** Whether `spec` is a project reference — `design/lang/0009` D7. */
export function isProjectSpecifier(spec: string): boolean {
  return spec.startsWith("@/");
}

/**
 * A specifier's key: `@/…` against the importing file's **project root**, anything else against the
 * importing file's directory.
 *
 * `@/` is the root of the project containing the importing file, which is why the root is a
 * parameter rather than something this could look up: the answer depends on which project the file
 * is in and not on where the compiler was started, so a graph spanning two projects has two roots.
 * Finding it is I/O and lives with the caller that already reads files — `harness/wacFiles.ts`.
 *
 * **An unknown root answers `""`, and the caller must report it rather than pass it on.** D7 says a
 * `@/` with no manifest inside the boundary is a compile error, and the alternative is worse than an
 * error: joining `@/src/a.wac` to nothing gives `src/a.wac`, a real-looking key relative to a
 * directory nobody named, so a program would compile against the wrong file rather than be refused.
 */
/**
 * `abs` written relative to `base`, both absolute — the twin of `relativeTo` in
 * `packages/wacc/src/path.wac`, and it has to stay its twin.
 *
 * Every key in a graph is relative to the directory the command ran in, because that is what the
 * entry was relative to. A `@/` is the one specifier whose root is *discovered*, and the root can
 * sit above that directory, so joining and stopping gives `../src/a.wac` for a file an ordinary
 * import calls `src/a.wac` — one file, two keys. `issues/lang/0168a`.
 */
export function relativeTo(base: string, abs: string): string {
  if (base === "" || base === abs) return base === abs ? "." : abs;
  if (abs.startsWith(`${base}/`)) return abs.slice(base.length + 1);
  const b = base.split("/");
  const a = abs.split("/");
  let i = 0;
  while (i < b.length && i < a.length && b[i] === a[i]) i++;
  const up = new Array(b.length - i).fill("..");
  const joined = [...up, ...a.slice(i)].join("/");
  return joined === "" ? "." : joined;
}

export function resolveSpecifier(
  baseFile: string,
  spec: string,
  root?: string,
  base?: string,
): string {
  if (!isProjectSpecifier(spec)) return resolvePath(baseFile, spec);
  if (root === undefined || root === "") return "";
  const joined = resolvePath(`${root}/x`, spec.slice(2));
  // Only for a file that is itself relatively keyed: one reached through a mapping, or one whose
  // entry was given absolutely, is already in absolute key space and converting it would give that
  // file a second key. Same two clauses as the wac side, for the same two failing cases.
  const fromIsRelative = !baseFile.startsWith("/");
  if (base !== undefined && base !== "" && fromIsRelative && root.startsWith("/")) {
    return relativeTo(base, joined);
  }
  return joined;
}

/** Resolve a relative import path against an absolute base path. */
export function resolvePath(baseFile: string, rel: string): string {
  // baseFile is like "/dir/file.wac" or "dir/file.wac"
  const dir = baseFile.includes("/")
    ? baseFile.slice(0, baseFile.lastIndexOf("/"))
    : ".";
  return joinPath(dir, rel);
}

/**
 * `dir/rel` with `.` and `..` collapsed — the spelling every key in a program map is in.
 *
 * **An absolute path keeps its leading slash**, and that is about identity rather than tidiness.
 * The root used to be carried as an empty first element and `..` popped whatever was on top, so a
 * `..` with nothing left to climb removed the root itself: `/abs/a.wac` importing `"../../b.wac"`
 * came back as `b.wac`, and `/home/wac/main.wac` importing four levels up came back as
 * `../lib.wac`. Both are *relative* keys, and a relative key is one an ordinary relative import can
 * also produce — so two different specifiers named one module, which is the failure
 * `design/lang/0001` spends its longest paragraph on and `0009` D8 exists to prevent. It compiled:
 * the entry climbed above the filesystem root and was handed a file keyed `../lib.wac`.
 *
 * Absolute bases are not hypothetical here. The playground keys everything under `/home/wac/`
 * (`site/src/editor/file-store.ts`), and this file's own tests use `/main.wac`.
 *
 * `packages/wacc/src/path.wac` and `harness/wacFiles.ts` were already right, each by remembering
 * absoluteness separately from the parts — which is what this does now.
 * `packages/wacc/test/wac/files_test.wac` asserts `/abs/a.wac` + `../../b.wac` is `/../b.wac` and
 * says it holds "in both walks"; it does, and now it holds in this one too. POSIX would answer `/`,
 * and none of these is a filesystem: what they compute is an identity for a path, so two identities
 * agreeing matters more than either matching `realpath`.
 */
function joinPath(dir: string, rel: string): string {
  const joined = `${dir}/${rel}`;
  const absolute = joined.startsWith("/");
  const out: string[] = [];
  for (const p of joined.split("/")) {
    if (p === "" || p === ".") continue;
    if (p === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(p);
  }
  return (absolute ? "/" : "") + out.join("/");
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
      // An enum name and a variant name are types too, and every one of those scope
      // kinds carries the struct entry the name denotes. Annotating only `struct`
      // left every enum-typed thing — a local, a field, an element type — without
      // identity, so it keyed by its name string while everything else keyed by
      // index. Two files declaring the same enum name then shared one key, and a
      // variant was not assignable to its own enum.
      if (found?.kind === "struct" || found?.kind === "enum" || found?.kind === "variant") {
        t.resolvedTypeIndex = found.entry.typeIndex;
      }
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
    case "matchExpr":
      annotateExpr(e.subject, scope);
      for (const arm of e.arms) {
        if (arm.value) annotateExpr(arm.value, scope);
      }
      return;
    case "arrNew":
      annotateType(e.elem, scope);
      if (e.size) annotateExpr(e.size, scope);
      if (e.fill) annotateExpr(e.fill, scope);
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
    case "match":
      annotateExpr(s.subject, scope);
      for (const arm of s.arms) {
        for (const st of arm.body) annotateStmt(st, scope);
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
    } else if (item.tag === "const") {
      // A constant's initialiser is an expression like any other and needs its struct
      // types annotated — without this, `const P ORIGIN = P(3, 4);` reported "undefined
      // function or struct 'P'", because the annotation pass never reached it. Harmless
      // while a constant could only be a scalar; not once it can be a struct or a
      // variant.
      annotateType(item.type, scope);
      annotateExpr(item.init, scope);
    } else if (item.tag === "enum") {
      // Payload types need annotating for the same reason struct fields do: the
      // generated variant structs (phase 1b) reuse these very type objects, and
      // they are not in `prog.items` for this walk to reach. Without this, a
      // payload of struct type keys by name while every other reference to the
      // same struct keys by index — so `P[]` interns as two array types and a
      // variant constructor fails wasm validation.
      for (const v of item.variants) {
        for (const f of v.fields) annotateType(f.type, scope);
      }
      // An enum's methods are ordinary method declarations and need the same treatment as a
      // struct's — signature and body. Without this, a struct construct or an array type
      // reachable only from inside an enum method reported "undefined function or struct",
      // which is the seventh appearance of issue 0005's shape.
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
  // The declaration, not `exportName`: those two agree everywhere except a monomorphised generic
  // function, which is importable by another wac file but deliberately not a wasm export — see
  // where `exportName` is assigned.
  if (e.kind === "func") return e.entry.origin.kind === "func" && e.entry.origin.decl.exported;
  if (e.kind === "struct") return e.entry.structDecl.exported;
  if (e.kind === "enum") return e.enumEntry.enumDecl.exported;
  if (e.kind === "const") return e.exported;
  // A variant is exported exactly when its enum is: they are one declaration.
  return e.enumEntry.enumDecl.exported;
}

// ── Monomorphisation ──────────────────────────────────────────────────────────
//
// A generic declaration is a *template*: `struct Vec<T>` is not a type, and `Vec<i32>` is.
// This pass runs before everything else in the resolver, finds every `Vec<i32>` written
// anywhere, clones the template with `T` replaced, and registers the result as an ordinary
// struct named `Vec$i32`. After it, no `typeParams` and no `typeArgs` remain, so the rest of
// the resolver, the type checker and the emitter never learn the word "generic" — the same
// containment that kept enums from touching them.
//
// The cost is here, as the design predicted: substituting types through a cloned AST. Every
// WacType in a method body has to be rewritten — locals, casts, `T[n]()` constructions,
// `is`/`as!` operands, funcref signatures — so most of this file is a deep clone.

/** How deep `Vec<Vec<Vec<...>>>` may nest before it is called a mistake. */
const MAX_INSTANTIATION_DEPTH = 24;

/**
 * A generic declaration. Structs and enums share everything monomorphisation needs — a name, type
 * parameters, methods — and differ only in what else has to be substituted, so one map holds both.
 */
type Template = { decl: StructDecl | EnumDecl; filePath: string };

/** Where an instantiation was written, for the trace an error needs. */
/** A source location as the *parser* records it — line and col, no file. */
type At = { line: number; col: number };

/**
 * Where a written type name was declared: the file, and the name as declared there.
 *
 * A name is only unique within its file, so mangling by the name *as written* was wrong in both
 * directions at once [issue 0042]: `Box<P>` and `Box<Point>` for an alias `P` produced two
 * instantiations of one type, and two different structs both called `Point` produced one
 * instantiation used for both — a type confusion rather than a diagnostic.
 *
 * This is computed from the AST alone, before any scopes exist, which is what lets it run in a
 * pre-pass. One hop is enough: importing a symbol does not re-export it, so an import must name
 * the declaring file directly.
 */
type NameOrigin = { file: string; name: string };

function buildOrigins(
  programs: Map<string, Program>,
  roots?: ReadonlyMap<string, string>,
  /** The directory relative keys are measured from — see `relativeTo`. `issues/lang/0168a`. */
  base?: string,
): Map<string, Map<string, NameOrigin>> {
  const byFile = new Map<string, Map<string, NameOrigin>>();
  for (const [filePath, prog] of programs) {
    const here = new Map<string, NameOrigin>();
    for (const item of prog.items) {
      if (item.tag === "struct" || item.tag === "enum") {
        here.set(item.name, { file: filePath, name: item.name });
      }
    }
    // Functions second, and only where the name is free. wac has one namespace for structs and
    // functions — 'undefined function or struct' is a single diagnostic — so a collision is an
    // error the resolver reports; here the struct simply wins and the error is unaffected.
    // Functions are in this map at all because a *generic function* is identified the same way a
    // generic struct is: declared name plus declaring file, following import aliases.
    for (const item of prog.items) {
      if (item.tag === "func" && !here.has(item.name)) {
        here.set(item.name, { file: filePath, name: item.name });
      }
    }
    byFile.set(filePath, here);
  }
  // Imports second, so a local declaration wins — which matches the resolver, where a duplicate
  // import is an error rather than a shadow.
  for (const [filePath, prog] of programs) {
    const here = byFile.get(filePath)!;
    for (const item of prog.items) {
      if (item.tag !== "import") continue;
      const from = importKey(filePath, item, roots, base);
      for (const it of item.items) {
        if (here.has(it.alias)) continue;
        here.set(it.alias, { file: from, name: it.name });
      }
    }
  }
  return byFile;
}

/**
 * A relative import path from one file to another, as `resolvePath` will read it back.
 *
 * Needed because a materialised struct lives in its *template's* file while its argument types were
 * named in the *referring* file. Copying `Point` into box.wac would resolve against box.wac's scope,
 * which never imported it — so the import is injected and the substituted type renamed to match.
 */
function relativeImportPath(from: string, to: string): string {
  const fromDir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")).split("/") : [];
  const toParts = to.split("/");
  let i = 0;
  while (i < fromDir.length && i < toParts.length - 1 && fromDir[i] === toParts[i]) i++;
  const up = fromDir.length - i;
  const rest = toParts.slice(i).join("/");
  return up === 0 ? `./${rest}` : `${"../".repeat(up)}${rest}`;
}

/** A file path as a mangled-name component: `packages/a/b.wac` becomes `packages_a_b`. */
function fileTag(path: string): string {
  return path.replace(/\.wac$/, "").replace(/[^A-Za-z0-9]/g, "_");
}

/**
 * The identity of a written name, as a string that is equal exactly when the types are.
 *
 * A primitive is itself. Anything else is qualified by its declaring file, so an alias collapses
 * onto its target and two same-named structs stay apart.
 */
function canonName(name: string, file: string, origins: Map<string, Map<string, NameOrigin>>): string {
  const origin = origins.get(file)?.get(name);
  // Unknown names are left alone: they are reported later by the type checker, and inventing an
  // identity for one here would only make that message stranger.
  if (origin === undefined) return name;
  return `${origin.name}__${fileTag(origin.file)}`;
}

function mangle(
  name: string, args: WacType[], file: string, origins: Map<string, Map<string, NameOrigin>>,
): string {
  // `$` is already the method-mangling separator and cannot appear in an IDENT, so a mangled
  // name can never collide with a written one — the same trick `#tag` uses for enums.
  return `${name}$${args.map((a) => mangleType(a, file, origins)).join("$")}`;
}

function mangleType(
  t: WacType, file: string, origins: Map<string, Map<string, NameOrigin>>,
): string {
  switch (t.kind) {
    case "prim":     return t.name;
    case "struct":
      if (t.typeArgs && t.typeArgs.length > 0) {
        // A nested instantiation is already canonical by construction: it was materialised under a
        // canonical name, and referring to it by that name keeps the outer key stable.
        return mangle(canonName(t.name, file, origins), t.typeArgs, file, origins);
      }
      return canonName(t.name, file, origins);
    case "array":    return `${mangleType(t.elem, file, origins)}_arr`;
    case "nullable": return `${mangleType(t.inner, file, origins)}_opt`;
    case "funcref":
      return `fn_${t.params.map((p) => mangleType(p, file, origins)).join("_")}_to_${
        mangleType(t.ret, file, origins)}`;
  }
}

/** A type as a reader would write it, demangling any instantiation inside it. */
function displayType(t: WacType, display?: Map<string, string>): string {
  switch (t.kind) {
    case "prim":     return t.name;
    case "struct":
      if (t.typeArgs && t.typeArgs.length > 0) {
        return `${t.name}<${t.typeArgs.map((a) => displayType(a, display)).join(", ")}>`;
      }
      return display?.get(t.name) ?? t.name;
    case "array":    return `${displayType(t.elem, display)}[]`;
    case "nullable": return `${displayType(t.inner, display)}?`;
    case "funcref":
      return `fn[${displayType(t.ret, display)}(${t.params.map((p) => displayType(p, display)).join(", ")})]`;
  }
}

// ── Substitution ──────────────────────────────────────────────────────────────

/**
 * Substitute type parameters, always returning *fresh* nodes.
 *
 * Never `return t`, even when nothing changed. The passes that follow rewrite a type in place —
 * that is what makes monomorphisation a pre-pass rather than a rewrite — so a node shared between
 * the template and its copies is a node one instantiation can change on another's behalf. It showed
 * up as `Vec<string>.create()` returning a `Vec<i32>`: the bare `Vec` in `return Vec(T[0](), 0)`
 * mentions no type parameter, so it was shared by every copy, and the first one to be given its
 * arguments gave them to all of them.
 */
function substType(t: WacType, sub: Map<string, WacType>): WacType {
  switch (t.kind) {
    case "prim": return { ...t };
    case "struct": {
      // A bare type-parameter name becomes the argument. It cannot itself have type
      // arguments — `T<i32>` is meaningless — so this is a straight swap.
      const bound = sub.get(t.name);
      if (bound !== undefined && (t.typeArgs === undefined || t.typeArgs.length === 0)) {
        // Keep the *use site's* position: an error inside a substituted body should point at
        // the template's own text, which is where the reader can act on it.
        return { ...bound, line: t.line, col: t.col };
      }
      if (t.typeArgs === undefined || t.typeArgs.length === 0) return { ...t };
      return { ...t, typeArgs: t.typeArgs.map((a) => substType(a, sub)) };
    }
    case "array":    return { ...t, elem: substType(t.elem, sub) };
    case "nullable": return { ...t, inner: substType(t.inner, sub) };
    case "funcref":
      return { ...t, params: t.params.map((p) => substType(p, sub)), ret: substType(t.ret, sub) };
  }
}

function substExpr(e: Expr, sub: Map<string, WacType>): Expr {
  switch (e.kind) {
    case "int": case "float": case "string": case "bool": case "null": case "ident":
      return { ...e };
    case "unary":  return { ...e, expr: substExpr(e.expr, sub) };
    case "binary": return { ...e, left: substExpr(e.left, sub), right: substExpr(e.right, sub) };
    case "cast":   return { ...e, expr: substExpr(e.expr, sub), type: substType(e.type, sub) };
    case "is": {
      const rhs = e.rhs === "null" ? "null"
        : isWacType(e.rhs) ? substType(e.rhs as WacType, sub)
        : substExpr(e.rhs as Expr, sub);
      return { ...e, expr: substExpr(e.expr, sub), rhs };
    }
    case "ternary":
      return { ...e, cond: substExpr(e.cond, sub), then: substExpr(e.then, sub), else_: substExpr(e.else_, sub) };
    case "call":
      return { ...e, callee: substExpr(e.callee, sub), args: e.args.map((a) => substExpr(a, sub)) };
    case "index":  return { ...e, expr: substExpr(e.expr, sub), idx: substExpr(e.idx, sub) };
    case "field":  return { ...e, expr: substExpr(e.expr, sub) };
    case "unwrap": return { ...e, expr: substExpr(e.expr, sub) };
    case "construct":
      return {
        ...e, ctype: substType(e.ctype, sub), args: e.args.map((a) => substExpr(a, sub)),
        named: e.named?.map((n) => ({ ...n, val: substExpr(n.val, sub) })),
      };
    case "incr-expr": return { ...e, lval: substLvalue(e.lval, sub) };
    case "arrNew":
      return {
        ...e, elem: substType(e.elem, sub),
        size: e.size ? substExpr(e.size, sub) : null,
        fill: e.fill ? substExpr(e.fill, sub) : undefined,
        fixed: e.fixed.map((x) => substExpr(x, sub)),
      };
    case "matchExpr":
      return {
        ...e, subject: substExpr(e.subject, sub),
        arms: e.arms.map((a) => ({ ...a, body: a.body.map((s) => substStmt(s, sub)),
                                   value: a.value ? substExpr(a.value, sub) : undefined })),
      };
  }
}

function substLvalue(lv: Lvalue, sub: Map<string, WacType>): Lvalue {
  switch (lv.kind) {
    case "lv-ident":  return { ...lv };
    case "lv-field":  return { ...lv, base: substLvalue(lv.base, sub) };
    case "lv-index":  return { ...lv, base: substLvalue(lv.base, sub), idx: substExpr(lv.idx, sub) };
    case "lv-unwrap": return { ...lv, base: substLvalue(lv.base, sub) };
  }
}

function substBlock(b: Block, sub: Map<string, WacType>): Block {
  return { ...b, stmts: b.stmts.map((s) => substStmt(s, sub)) };
}

function substStmt(s: Stmt, sub: Map<string, WacType>): Stmt {
  switch (s.kind) {
    case "var":
      return { ...s, type: substType(s.type, sub), init: substExpr(s.init, sub) };
    case "assign":
      return { ...s, lval: substLvalue(s.lval, sub), rhs: substExpr(s.rhs, sub) };
    case "incr": return { ...s, lval: substLvalue(s.lval, sub) };
    case "if":
      return {
        ...s, cond: substExpr(s.cond, sub), then: substBlock(s.then, sub),
        els: s.els === null ? null
          : s.els.kind === "else-if" ? { ...s.els, stmt: substStmt(s.els.stmt, sub) }
          : { ...s.els, block: substBlock(s.els.block, sub) },
      };
    case "while": case "dowhile":
      return { ...s, cond: substExpr(s.cond, sub), body: substBlock(s.body, sub) };
    case "for":
      return {
        ...s, init: s.init ? substStmt(s.init, sub) : null,
        cond: s.cond ? substExpr(s.cond, sub) : null,
        update: s.update ? substStmt(s.update, sub) : null,
        body: substBlock(s.body, sub),
      };
    case "switch":
      return {
        ...s, expr: substExpr(s.expr, sub),
        cases: s.cases.map((c) => ({
          ...c, value: c.value === "default" ? "default" : substExpr(c.value, sub),
          body: c.body.map((x) => substStmt(x, sub)),
        })),
      };
    case "match":
      return {
        ...s, subject: substExpr(s.subject, sub),
        arms: s.arms.map((a) => ({ ...a, body: a.body.map((x) => substStmt(x, sub)) })),
      };
    case "return": return { ...s, value: s.value ? substExpr(s.value, sub) : null };
    case "break": case "continue": case "trap": return { ...s };
    case "block":  return { ...s, block: substBlock(s.block, sub) };
    case "expr":   return { ...s, expr: substExpr(s.expr, sub) };
  }
}

/** Is this `is` right-hand side a type rather than an expression? */
function isWacType(v: unknown): boolean {
  return typeof v === "object" && v !== null && "kind" in v &&
    ["prim", "struct", "array", "nullable", "funcref"].includes((v as { kind: string }).kind);
}

// ── Collecting instantiation requests ─────────────────────────────────────────
//
// Every `struct` type with arguments, anywhere in any program, is a request. Walking types is
// enough — a generic can only be *named* in type position, by the bracket restriction.

/**
 * Every position where the author certainly wrote a *type*, in one program.
 *
 * Two positions look like types and are not, so the pass that is strict about type names skips
 * both. `f(x)` parses as a construction whose "type" is the name `f`, which may be a struct, a
 * function or a funcref *local* — and the resolver already reports an unknown callee as "undefined
 * function or struct". `x is Other` parses its right-hand side as a type, and it is an identity
 * test when `Other` is a variable — the type checker decides which, and reports an undefined type
 * there itself.
 */
function eachTypeInProgram(prog: Program, visit: (t: WacType) => void): void {
  writtenTypesOnly = true;
  try {
    eachTypeInPrograms(new Map([["", prog]]), (t) => visit(t));
  } finally {
    writtenTypesOnly = false;
  }
}

/**
 * Set only for the duration of `eachTypeInProgram`.
 *
 * A parameter threaded through eight recursive walks would be eight signatures changed for one
 * caller; a flag with a `finally` is smaller and the walks are synchronous.
 */
let writtenTypesOnly = false;

function eachTypeInPrograms(
  programs: Map<string, Program>, visit: (t: WacType, filePath: string) => void,
  skipTemplates = false,
): void {
  for (const [filePath, prog] of programs) {
    const t = (x: WacType) => visitType(x, (y) => visit(y, filePath));
    for (const item of prog.items) {
      // A template's own body mentions its type parameters, so `Box<T>` inside `struct Wrap<T>`
      // would be materialised as `Box$T` — with the parameter name treated as an argument.
      // Template bodies are rewritten during materialisation, once T is known, and must not be
      // visited before that.
      // A generic *function* has the same hazard, from its signature as much as its body:
      // `T unbox<T>(Box<T> b)` would materialise `Box$T` before anything knows what T is.
      if (skipTemplates && (item.tag === "struct" || item.tag === "func" || item.tag === "enum") &&
          item.typeParams.length > 0) continue;
      if (item.tag === "struct") {
        for (const f of item.fields) t(f.type);
        for (const m of item.methods) { t(m.returnType); for (const p of m.params) t(p.type); visitBlockTypes(m.body, t); }
      } else if (item.tag === "func") {
        t(item.returnType);
        for (const p of item.params) t(p.type);
        visitBlockTypes(item.body, t);
      } else if (item.tag === "enum") {
        for (const v of item.variants) for (const f of v.fields) t(f.type);
        for (const m of item.methods) { t(m.returnType); for (const p of m.params) t(p.type); visitBlockTypes(m.body, t); }
      } else if (item.tag === "const") {
        t(item.type);
        visitExprTypes(item.init, t);
      }
    }
  }
}

function visitType(t: WacType, visit: (t: WacType) => void): void {
  visit(t);
  if (t.kind === "array") visitType(t.elem, visit);
  else if (t.kind === "nullable") visitType(t.inner, visit);
  else if (t.kind === "funcref") { for (const p of t.params) visitType(p, visit); visitType(t.ret, visit); }
  else if (t.kind === "struct" && t.typeArgs) for (const a of t.typeArgs) visitType(a, visit);
}

function visitBlockTypes(b: Block, t: (x: WacType) => void): void {
  for (const s of b.stmts) visitStmtTypes(s, t);
}

function visitStmtTypes(s: Stmt, t: (x: WacType) => void): void {
  switch (s.kind) {
    case "var": t(s.type); visitExprTypes(s.init, t); return;
    case "assign": visitLvalTypes(s.lval, t); visitExprTypes(s.rhs, t); return;
    case "incr": visitLvalTypes(s.lval, t); return;
    case "if":
      visitExprTypes(s.cond, t); visitBlockTypes(s.then, t);
      if (s.els?.kind === "else-if") visitStmtTypes(s.els.stmt, t);
      else if (s.els?.kind === "else-block") visitBlockTypes(s.els.block, t);
      return;
    case "while": case "dowhile": visitExprTypes(s.cond, t); visitBlockTypes(s.body, t); return;
    case "for":
      if (s.init) visitStmtTypes(s.init, t);
      if (s.cond) visitExprTypes(s.cond, t);
      if (s.update) visitStmtTypes(s.update, t);
      visitBlockTypes(s.body, t);
      return;
    case "switch":
      visitExprTypes(s.expr, t);
      for (const c of s.cases) {
        if (c.value !== "default") visitExprTypes(c.value, t);
        for (const x of c.body) visitStmtTypes(x, t);
      }
      return;
    case "match":
      visitExprTypes(s.subject, t);
      for (const a of s.arms) for (const x of a.body) visitStmtTypes(x, t);
      return;
    case "return": if (s.value) visitExprTypes(s.value, t); return;
    case "block": visitBlockTypes(s.block, t); return;
    case "expr": visitExprTypes(s.expr, t); return;
    case "break": case "continue": case "trap": return;
  }
}

function visitLvalTypes(lv: Lvalue, t: (x: WacType) => void): void {
  if (lv.kind === "lv-index") { visitLvalTypes(lv.base, t); visitExprTypes(lv.idx, t); }
  else if (lv.kind === "lv-field" || lv.kind === "lv-unwrap") visitLvalTypes(lv.base, t);
}

function visitExprTypes(e: Expr, t: (x: WacType) => void): void {
  switch (e.kind) {
    case "cast": t(e.type); visitExprTypes(e.expr, t); return;
    case "is":
      visitExprTypes(e.expr, t);
      if (writtenTypesOnly) return;
      if (e.rhs !== "null" && isWacType(e.rhs)) t(e.rhs as WacType);
      else if (e.rhs !== "null") visitExprTypes(e.rhs as Expr, t);
      return;
    case "construct":
      if (!writtenTypesOnly) t(e.ctype);
      for (const a of e.args) visitExprTypes(a, t);
      for (const n of e.named ?? []) visitExprTypes(n.val, t);
      return;
    case "arrNew":
      t(e.elem);
      if (e.size) visitExprTypes(e.size, t);
      if (e.fill) visitExprTypes(e.fill, t);
      for (const x of e.fixed) visitExprTypes(x, t);
      return;
    case "unary": case "unwrap": case "field": visitExprTypes(e.expr, t); return;
    case "binary": visitExprTypes(e.left, t); visitExprTypes(e.right, t); return;
    case "ternary":
      visitExprTypes(e.cond, t); visitExprTypes(e.then, t); visitExprTypes(e.else_, t); return;
    case "call": visitExprTypes(e.callee, t); for (const a of e.args) visitExprTypes(a, t); return;
    case "index": visitExprTypes(e.expr, t); visitExprTypes(e.idx, t); return;
    case "incr-expr": visitLvalTypes(e.lval, t); return;
    case "matchExpr":
      visitExprTypes(e.subject, t);
      for (const a of e.arms) {
        for (const x of a.body) visitStmtTypes(x, t);
        if (a.value) visitExprTypes(a.value, t);
      }
      return;
    case "int": case "float": case "string": case "bool": case "null": case "ident": return;
  }
}


// ── Generic functions ─────────────────────────────────────────────────────────
//
// `T max<T>(T a, T b)` is a template too, but its arguments are never written at the use site:
// `max(3, 7)` infers `T = i32` from the arguments. Angle brackets in an expression are ambiguous with
// less-than, so there is no explicit form to fall back on — inference is the whole interface.
//
// That is tractable here only because **wac has no type inference for declarations**. Every local and
// parameter states its type, so an argument expression's type is almost always available
// syntactically, without a symbol table. `inferArgType` below is that reading; where it cannot see an
// answer it says so rather than guessing, because a wrong guess would silently instantiate the wrong
// function.

/** A local scope for inferring argument types: parameter and local declarations, innermost last. */
type LocalTypes = Map<string, WacType>[];

function lookupLocal(env: LocalTypes, name: string): WacType | undefined {
  for (let i = env.length - 1; i >= 0; i--) {
    const t = env[i].get(name);
    if (t !== undefined) return t;
  }
  return undefined;
}

/**
 * The type of an argument expression, or null when it cannot be read off the source.
 *
 * Deliberately incomplete. It covers what appears in practice at a call site — a literal, a named
 * value, a field, an element, a cast, a construction, or a call to something whose return type is
 * declared — and returns null for anything else so the caller can report that rather than instantiate
 * a template with a guess.
 */
function inferArgType(
  e: Expr, env: LocalTypes, filePath: string,
  origins: Map<string, Map<string, NameOrigin>>,
  funcReturns: Map<string, WacType>,
  funcParams: Map<string, Param[]>,
  structFields: Map<string, Map<string, WacType>>,
): WacType | null {
  const pos = { line: e.line, col: e.col };
  switch (e.kind) {
    case "int": {
      const lit = wacIntLit(e.value);
      return { kind: "prim", name: lit.ok && lit.width === 64 ? "i64" : "i32", ...pos };
    }
    case "float":  return { kind: "prim", name: "f64", ...pos };
    case "string": return { kind: "prim", name: "string", ...pos };
    case "bool":   return { kind: "prim", name: "bool", ...pos };
    case "ident": {
      const local = lookupLocal(env, e.name);
      if (local !== undefined) return local;
      // Not a local, so it may be a function's name used as a value — which is how a callback is
      // written: `mapOption(o, double)`. Its type is the signature it was declared with.
      const key = canonName(e.name, filePath, origins);
      const ret = funcReturns.get(key);
      const params = funcParams.get(key);
      if (ret === undefined || params === undefined) return null;
      return { kind: "funcref", params: params.map((p) => p.type), ret, ...pos };
    }
    case "cast":   return e.type;
    case "unary":  return inferArgType(e.expr, env, filePath, origins, funcReturns, funcParams, structFields);
    case "is":     return { kind: "prim", name: "bool", ...pos };
    case "unwrap": {
      const t = inferArgType(e.expr, env, filePath, origins, funcReturns, funcParams, structFields);
      return t !== null && t.kind === "nullable" ? t.inner : t;
    }
    case "binary": {
      // A comparison is bool; anything else takes the left operand's type, which is what the type
      // checker concludes for every arithmetic and bitwise operator.
      if (["==", "!=", "<", "<=", ">", ">=", "&&", "||"].includes(e.op)) {
        return { kind: "prim", name: "bool", ...pos };
      }
      return inferArgType(e.left, env, filePath, origins, funcReturns, funcParams, structFields);
    }
    case "ternary":
      return inferArgType(e.then, env, filePath, origins, funcReturns, funcParams, structFields)
        ?? inferArgType(e.else_, env, filePath, origins, funcReturns, funcParams, structFields);
    case "index": {
      const t = inferArgType(e.expr, env, filePath, origins, funcReturns, funcParams, structFields);
      if (t === null) return null;
      if (t.kind === "array") return t.elem;
      // A string index yields a one-character string.
      if (t.kind === "prim" && t.name === "string") return t;
      return null;
    }
    case "field": {
      const base = inferArgType(e.expr, env, filePath, origins, funcReturns, funcParams, structFields);
      if (base === null) return null;
      const named = base.kind === "nullable" ? base.inner : base;
      if (named.kind !== "struct") return null;
      const key = canonName(named.name, filePath, origins);
      return structFields.get(key)?.get(e.name) ?? null;
    }
    case "arrNew": return { kind: "array", elem: e.elem, ...pos };
    case "construct": {
      // The parser calls every `name(...)` a construction, so this is also how a *call* arrives.
      if (e.ctype.kind !== "struct") return null;
      const key = canonName(e.ctype.name, filePath, origins);
      const ret = funcReturns.get(key);
      if (ret !== undefined) return ret;          // a call, so its declared return type
      if (structFields.has(key)) return e.ctype;  // a construction, so the struct itself
      return null;
    }
    case "call": {
      // `max(s.get(), x)` — a method call, which is the one call shape worth reading here because
      // it is how idiomatic wac gets at a container's contents. `structFields` holds method return
      // types alongside field types, so the receiver's struct is all that is needed.
      if (e.callee.kind !== "field") return null;
      const base = inferArgType(e.callee.expr, env, filePath, origins, funcReturns, funcParams, structFields);
      if (base === null) return null;
      const named = base.kind === "nullable" ? base.inner : base;
      if (named.kind !== "struct") return null;
      return structFields.get(canonName(named.name, filePath, origins))?.get(e.callee.name) ?? null;
    }
    // A funcref call, `null`, and `++`/`--` as expressions are not read: a funcref's own type is
    // where its return type lives and this pass has not resolved names to declarations, and `null`
    // has no type of its own at all.
    default: return null;
  }
}

/**
 * An inferred type, together with the file whose scope its names were resolved in.
 *
 * The file travels with the type because a bare `Point` means whatever that file imported, and an
 * inferred binding can come from somewhere other than the call site — see `StructInst`.
 */
type Bound = { type: WacType; file: string };

/** What a monomorphised struct name was made from, so inference can take it apart again. */
type StructInst = { canon: string; args: WacType[]; file: string };

/**
 * Bind type parameters by matching a template's parameter type against an argument's actual type.
 *
 * Structural and one-directional: `T[]` against `i32[]` binds `T = i32`. `Box<T>` against a
 * monomorphised `Box$i32` binds `T = i32` too, but only by looking the name up in `inst` — by the
 * time functions are monomorphised the structs already are, so the argument's type no longer says
 * `Box<i32>` anywhere.
 */
function unifyParam(
  param: WacType, actual: Bound, params: Set<string>, out: Map<string, Bound>,
  ctx: {
    inst: Map<string, StructInst>;
    origins: Map<string, Map<string, NameOrigin>>;
    paramFile: string;
  },
): boolean {
  const rec = (p: WacType, a: WacType, file: string) =>
    unifyParam(p, { type: a, file }, params, out, ctx);

  if (param.kind === "struct" && params.has(param.name)) {
    const existing = out.get(param.name);
    if (existing === undefined) { out.set(param.name, actual); return true; }
    // Two arguments must agree: `max(1, 2.5)` has no single T, and picking one would be a guess.
    // Compared as mangled names so the two are judged by identity rather than by spelling.
    return mangleType(existing.type, existing.file, ctx.origins) ===
           mangleType(actual.type, actual.file, ctx.origins);
  }
  if (param.kind === "array" && actual.type.kind === "array") {
    return rec(param.elem, actual.type.elem, actual.file);
  }
  if (param.kind === "nullable" && actual.type.kind === "nullable") {
    return rec(param.inner, actual.type.inner, actual.file);
  }
  if (param.kind === "funcref" && actual.type.kind === "funcref") {
    // A different arity binds nothing rather than failing: `false` means "these arguments conflict",
    // and two signatures of different lengths are instead a shape mismatch, which the caller
    // reports by naming the parameter and the argument.
    if (param.params.length !== actual.type.params.length) return true;
    for (let i = 0; i < param.params.length; i++) {
      if (!rec(param.params[i], actual.type.params[i], actual.file)) return false;
    }
    return rec(param.ret, actual.type.ret, actual.file);
  }
  if (param.kind === "struct" && param.typeArgs !== undefined && param.typeArgs.length > 0 &&
      actual.type.kind === "struct") {
    // `Box<T>` against `Box$i32`. The instantiation's arguments were written in whichever file first
    // asked for it, so they carry that file rather than this one.
    const made = ctx.inst.get(actual.type.name);
    if (made === undefined) return true;
    if (made.canon !== canonName(param.name, ctx.paramFile, ctx.origins)) return true;
    if (made.args.length !== param.typeArgs.length) return true;
    for (let i = 0; i < param.typeArgs.length; i++) {
      if (!rec(param.typeArgs[i], made.args[i], made.file)) return false;
    }
    return true;
  }
  // Nothing to bind here, and no reason to reject: a mismatch between two concrete types is the type
  // checker's to report, against the substituted copy, where the message names real types.
  return true;
}

/**
 * Replace every generic reference with its monomorphised struct, materialising as it goes.
 *
 * Runs to fixpoint: substituting a template body can name further instantiations, so
 * materialising `Vec<Vec<i32>>` discovers `Vec<i32>`. `struct Rec<T> { Rec<Box<T>> next; }` never
 * terminates, so depth is capped and reported — Rust has the same limit for the same reason.
 */
export function monomorphise(
  programs: Map<string, Program>,
  err: (msg: string, file: string, line: number, col: number) => void,
  /**
   * Filled in with `Vec$i32` -> `Vec<i32>` for every instantiation.
   *
   * Diagnostics must never show a mangled name: the design calls the instantiation trace
   * first-class work, and it is the whole difference between this feature and C++ templates —
   * an error about `Box$Base` is about code the author did not write.
   */
  display?: Map<string, string>,
  /** Collects the templates, which are removed from the programs but still want checking. */
  keep?: { decl: StructDecl; filePath: string }[],
  /** The generic *function* templates, kept for the same reason. */
  keepFuncs?: { decl: FuncDecl; filePath: string }[],
  /** The generic *enum* templates. Collected for their names, which template checking defers on. */
  keepEnums?: { decl: EnumDecl; filePath: string }[],
  /** The project root each file sits in, for `@/` — see `resolveSpecifier`. */
  roots?: ReadonlyMap<string, string>,
  /** The directory relative keys are measured from — see `relativeTo`. `issues/lang/0168a`. */
  base?: string,
): void {
  const origins = buildOrigins(programs, roots, base);

  // Templates are keyed by *identity* — declared name plus declaring file — so an alias and its
  // target find the same one, and two same-named templates in different files stay apart.
  const templates = new Map<string, Template>();
  for (const [filePath, prog] of programs) {
    for (const item of prog.items) {
      if ((item.tag === "struct" || item.tag === "enum") && item.typeParams.length > 0) {
        templates.set(`${item.name}__${fileTag(filePath)}`, { decl: item, filePath });
        if (item.tag === "struct") keep?.push({ decl: item, filePath });
        else keepEnums?.push({ decl: item, filePath });
      }
    }
  }
  /** The template a name refers to *in this file*, following an import alias. */
  const templateFor = (name: string, file: string): Template | undefined =>
    templates.get(canonName(name, file, origins));
  if (templates.size === 0) {
    // Still worth checking: a generic reference to something that is not a template is an
    // error the user should see rather than a silent bare-name lookup later. In the non-empty
    // case the sweep below reports the same thing with more context, so this runs only here.
    reportStrayArgs(programs, err);
    // No early return: generic *functions* are handled further down and a file may have those
    // without a single generic struct. Every loop between here and there is a no-op on an
    // empty template set.
  }

  // Materialised structs, by mangled name, so each is built once however often it is written.
  const made = new Map<string, StructDecl | EnumDecl>();
  const structInst = new Map<string, StructInst>();
  const madeIn = new Map<string, string>();   // mangled name -> file it belongs to
  const usedIn = new Map<string, Set<string>>();  // file -> mangled names it refers to
  const noteUse = (file: string, mangled: string) => {
    let set = usedIn.get(file);
    if (set === undefined) { set = new Set(); usedIn.set(file, set); }
    set.add(mangled);
  };

  const materialise = (name: string, args: WacType[], depth: number, at: At, file: string): string | null => {
    const tpl = templateFor(name, file);
    if (tpl === undefined) return null;
    if (args.length !== tpl.decl.typeParams.length) {
      err(`'${name}' takes ${tpl.decl.typeParams.length} type argument(s), got ${args.length}`,
        file, at.line, at.col);
      return null;
    }
    if (depth > MAX_INSTANTIATION_DEPTH) {
      err(`generic instantiation of '${name}' nests more than ${MAX_INSTANTIATION_DEPTH} deep — ` +
          `a generic that instantiates itself with a larger argument never terminates`,
        file, at.line, at.col);
      return null;
    }
    // The instantiation's own name is canonical too, so `B<i32>` and `Box<i32>` agree.
    const mangled = mangle(canonName(name, file, origins), args, file, origins);
    if (made.has(mangled)) return mangled;

    const sub = new Map<string, WacType>();
    tpl.decl.typeParams.forEach((p, i) => sub.set(p, visibleFrom(args[i], file, tpl.filePath)));
    const substMethods = (ms: MethodDecl[]) => ms.map((m) => ({
      ...m, returnType: substType(m.returnType, sub),
      params: m.params.map((prm) => ({ ...prm, type: substType(prm.type, sub) })),
      body: substBlock(m.body, sub),
    }));
    // Registered before its body is walked, so a self-reference finds it rather than recursing.
    const decl: StructDecl | EnumDecl = tpl.decl.tag === "enum"
      ? {
        ...tpl.decl, name: mangled, typeParams: [],
        // A variant's payload is the only enum-specific part: everything else — the name, the
        // methods, the removal and re-insertion — is what a struct needs too.
        variants: tpl.decl.variants.map((v) => ({
          ...v, fields: v.fields.map((f) => ({ ...f, type: substType(f.type, sub) })),
        })),
        methods: substMethods(tpl.decl.methods),
      }
      : {
        ...tpl.decl, name: mangled, typeParams: [],
        fields: tpl.decl.fields.map((f) => ({ ...f, type: substType(f.type, sub) })),
        methods: substMethods(tpl.decl.methods),
      };
    made.set(mangled, decl);
    madeIn.set(mangled, tpl.filePath);
    // Kept so generic-function inference can read `Box$i32` back as `Box<i32>`: by the time
    // functions are monomorphised no argument's type says `Box<i32>` any more.
    structInst.set(mangled, { canon: canonName(name, file, origins), args, file });
    // The *written* name, not the canonical one: a diagnostic must show what the author typed.
    display?.set(mangled, `${name}<${args.map((a) => displayType(a, display)).join(", ")}>`);
    // Now rewrite any generic references the substituted copy itself contains.
    rewriteDecl(decl, depth + 1, tpl.filePath);
    return mangled;
  };

  /**
   * Rename any struct inside `t` so it resolves from `inFile`, injecting the import that makes it.
   *
   * An argument was written in `fromFile`, where a bare `Point` may be an import; the substituted
   * copy lands in `inFile`, where it may mean nothing or — worse — something else. Both are the
   * same confusion as issue 0041, arriving from the other direction.
   */
  const visibleFrom = (t: WacType, fromFile: string, inFile: string): WacType => {
    switch (t.kind) {
      case "prim": return t;
      case "array":    return { ...t, elem: visibleFrom(t.elem, fromFile, inFile) };
      case "nullable": return { ...t, inner: visibleFrom(t.inner, fromFile, inFile) };
      case "funcref":
        return {
          ...t, params: t.params.map((p) => visibleFrom(p, fromFile, inFile)),
          ret: visibleFrom(t.ret, fromFile, inFile),
        };
      case "struct": {
        // A name this pass invented earlier — an alias it minted, or a materialised instantiation.
        // `origins` was built from the *written* programs, so it has never heard of either, and
        // returning the type unchanged meant the import was not injected. That is a nested
        // instantiation losing its argument's type: `V<P>` materialises `Option<P>` into Option's
        // own file, where `P__main` then resolved to nothing, so both `Option<P>` and `Option<S>`
        // took whatever the fallback found and became one type [issue 0047, agent-b].
        const invented = aliasOrigin.get(t.name);
        if (invented !== undefined) {
          if (invented.from === inFile) return { ...t, name: invented.name };
          needImports.set(`${inFile}\u0000${t.name}`,
            { inFile, alias: t.name, name: invented.name, from: invented.from });
          return { ...t };                                  // already canonical
        }
        // A *materialised* name needs nothing here: it is registered as used in whichever file
        // referred to it, and the import-rewriting pass below turns that into an import. Tried a
        // branch for it and could not construct a shape that needed one, so there is not one.
        const origin = origins.get(fromFile)?.get(t.name);
        if (origin === undefined) return t;                 // unknown; reported later
        if (origin.file === inFile) return t;               // already local to the target
        const alias = `${origin.name}__${fileTag(origin.file)}`;
        needImports.set(`${inFile}\u0000${alias}`,
          { inFile, alias, name: origin.name, from: origin.file });
        // The alias is a name the author never wrote, so a diagnostic must not show it — the same
        // rule as for a mangled instantiation. `Vec<JsonValue>`'s element type reaches the caller
        // bearing this name, and a message about it used to read `V__v`.
        display?.set(alias, origin.name);
        aliasOrigin.set(alias, { name: origin.name, from: origin.file });
        return { ...t, name: alias };
      }
    }
  };

  /** Imports to inject so a materialised struct's argument types resolve. */
  const needImports = new Map<string, { inFile: string; alias: string; name: string; from: string }>();

  /**
   * Every canonical alias this pass has minted, and what it stands for.
   *
   * Needed because substitution is recursive: the argument of a nested instantiation may be a name
   * the pass invented for an outer one, and `origins` only knows names the author wrote.
   */
  const aliasOrigin = new Map<string, { name: string; from: string }>();

  // Rewriting a reference in place is what makes this a pre-pass: after it, `typeArgs` is gone
  // and the type is an ordinary struct reference by mangled name.
  const rewriteType = (t: WacType, depth: number, file: string): void => {
    if (t.kind === "array") return rewriteType(t.elem, depth, file);
    if (t.kind === "nullable") return rewriteType(t.inner, depth, file);
    if (t.kind === "funcref") {
      for (const p of t.params) rewriteType(p, depth, file);
      return rewriteType(t.ret, depth, file);
    }
    if (t.kind !== "struct") return;
    const args = t.typeArgs;
    if (args === undefined || args.length === 0) {
      // A bare template name is reported later, by `checkBareTemplates`, so that a construction
      // whose arguments come from an expected type is not flagged before that runs.
      return;
    }
    for (const a of args) rewriteType(a, depth, file);
    if (templateFor(t.name, file) === undefined) {
      err(`'${t.name}' is not generic, so it takes no type arguments`, file, t.line, t.col);
      delete (t as { typeArgs?: WacType[] }).typeArgs;
      return;
    }
    const mangled = materialise(t.name, args, depth, t, file);
    if (mangled === null) { delete (t as { typeArgs?: WacType[] }).typeArgs; return; }
    (t as { name: string }).name = mangled;
    delete (t as { typeArgs?: WacType[] }).typeArgs;
    noteUse(file, mangled);
  };

  const rewriteDecl = (decl: StructDecl | EnumDecl, depth: number, file: string): void => {
    const t = (x: WacType) => rewriteType(x, depth, file);
    if (decl.tag === "enum") for (const v of decl.variants) for (const f of v.fields) t(f.type);
    else for (const f of decl.fields) t(f.type);
    for (const m of decl.methods) {
      t(m.returnType);
      for (const p of m.params) t(p.type);
      visitBlockTypes(m.body, t);
      // After the types are rewritten, not before: `applyExpected` matches a construction against
      // its declared type by mangled name, and inside a template that name is still `Box<T>`. The
      // sweep at the top of the file cannot do this one, because it skips template bodies.
      inferConstructions(m.body, m.returnType, file);
    }
  };

  // The initial sweep, over everything written by hand.
  eachTypeInPrograms(programs, (t, filePath) => rewriteType(t, 0, filePath), true);

  // A construction never names its type arguments — `Vec<i32> v = Vec(...)`, not `Vec<i32>(...)`
  // — because angle brackets in an expression are ambiguous with less-than. So the arguments come
  // from the expected type, which the design calls the bracket restriction and which works because
  // every declaration in wac is explicitly typed.
  //
  // Two positions supply one without needing a symbol table: a variable's declared type and the
  // enclosing function's return type. Anything else — notably a call argument, which would need
  // the callee's signature this pass has not built yet — is an error telling the author to name
  // the type. Idiomatic wac already writes those as two statements, so the restriction costs
  // little; lifting it is Stage C's business.
  for (const [filePath, prog] of programs) {
    for (const item of prog.items) {
      if (item.tag === "func") inferConstructions(item.body, item.returnType, filePath);
      else if (item.tag === "struct" || item.tag === "enum") {
        for (const m of item.methods) inferConstructions(m.body, m.returnType, filePath);
      } else if (item.tag === "const") applyExpected(item.init, item.type, filePath);
    }
  }

  function inferConstructions(b: Block, retType: WacType, filePath: string): void {
    for (const st of b.stmts) inferInStmt(st, retType, filePath);
  }

  function inferInStmt(st: Stmt, retType: WacType, filePath: string): void {
    switch (st.kind) {
      case "var": applyExpected(st.init, st.type, filePath); return;
      case "return": if (st.value) applyExpected(st.value, retType, filePath); return;
      case "if":
        inferConstructions(st.then, retType, filePath);
        if (st.els?.kind === "else-if") inferInStmt(st.els.stmt, retType, filePath);
        else if (st.els?.kind === "else-block") inferConstructions(st.els.block, retType, filePath);
        return;
      case "while": case "dowhile": inferConstructions(st.body, retType, filePath); return;
      case "for":
        if (st.init) inferInStmt(st.init, retType, filePath);
        inferConstructions(st.body, retType, filePath);
        return;
      case "switch":
        for (const c of st.cases) for (const x of c.body) inferInStmt(x, retType, filePath);
        return;
      case "match":
        for (const a of st.arms) for (const x of a.body) inferInStmt(x, retType, filePath);
        return;
      case "block": inferConstructions(st.block, retType, filePath); return;
      default: return;
    }
  }

  /**
   * Give a construction its type arguments from the type expected of it.
   *
   * Reaches through a ternary, so `Vec<i32> v = c ? Vec(...) : Vec(...)` works — the design flags
   * that explicitly, and contextual literal typing needed the same propagation.
   */
  function applyExpected(e: Expr, expected: WacType, filePath: string): void {
    if (e.kind === "ternary") {
      applyExpected(e.then, expected, filePath);
      applyExpected(e.else_, expected, filePath);
      return;
    }
    if (e.kind === "matchExpr") {
      // Every arm of a match *expression* produces the value, so each arm is the same expected-type
      // position as a ternary branch. `return match (o) { case Some(v): Option.Some(f(v)), … }`
      // needs it, which is how Option's own map is written.
      for (const arm of e.arms) if (arm.value) applyExpected(arm.value, expected, filePath);
      return;
    }
    if (e.kind === "arrNew") {
      // The elements of an array take the element type, which the array construction names
      // explicitly — so this is propagation from a type the author already wrote.
      if (e.fill) applyExpected(e.fill, e.elem, filePath);
      for (const x of e.fixed) applyExpected(x, e.elem, filePath);
      return;
    }
    // `Option<i32> o = Option.Some(5)` — a variant construction, which is a call on a field of the
    // enum's *name* rather than a construction node, and a payload-less variant is the bare field.
    // The enum name is what has to move to the instantiation; the variant resolves through it. A
    // static method on a generic struct — `Vec.create()` — is the same shape and the same fix.
    const enumRef = e.kind === "call" && e.callee.kind === "field" && e.callee.expr.kind === "ident"
      ? e.callee.expr
      : e.kind === "field" && e.expr.kind === "ident" ? e.expr : null;
    if (enumRef !== null) {
      // Either kind of template: a variant construction on a generic enum, or a *static method* on
      // a generic struct — `Map<string, i32> m = Map.create()`, which the design lists as a
      // supported position and which is the only way to write a constructor for a container whose
      // fields the caller should not have to know.
      const tpl = templateFor(enumRef.name, filePath);
      if (tpl === undefined) return;
      const wantEnum = expected.kind === "nullable" ? expected.inner : expected;
      if (wantEnum.kind !== "struct") return;
      if (!wantEnum.name.startsWith(`${canonName(enumRef.name, filePath, origins)}$`)) return;
      (enumRef as { name: string }).name = wantEnum.name;
      return;
    }
    if (e.kind !== "construct") return;
    const ctype = e.ctype;
    if (ctype.kind !== "struct") return;
    if (templateFor(ctype.name, filePath) === undefined) return;
    if (ctype.typeArgs !== undefined && ctype.typeArgs.length > 0) return;   // already named
    // The expected type must be the same template, monomorphised by the sweep above.
    const want = expected.kind === "nullable" ? expected.inner : expected;
    if (want.kind !== "struct") return;
    // The expected type has already been rewritten to a canonical mangled name, so the prefix to
    // match is the canonical one — `Box__box$i32`, not `Box$i32`. Testing the written prefix made
    // every construction fail to find its arguments once mangling became canonical [issue 0042].
    const prefix = `${canonName(ctype.name, filePath, origins)}$`;
    if (!want.name.startsWith(prefix)) return;
    (ctype as { name: string }).name = want.name;
    if (want.resolvedTypeIndex !== undefined) {
      (ctype as { resolvedTypeIndex?: number }).resolvedTypeIndex = want.resolvedTypeIndex;
    }
  }

  // A materialised struct lives in the *template's* file, so the ordinary export and import rules
  // apply to it unchanged. A file that wrote `Vec<i32>` therefore has to import `Vec$i32`, and the
  // import item naming the template is rewritten to the instantiations that file actually uses.
  // Importing the template itself would be meaningless: after this pass it is not a declaration.
  for (const [filePath, prog] of programs) {
    for (const item of prog.items) {
      if (item.tag !== "import") continue;
      const rewritten: typeof item.items = [];
      for (const it of item.items) {
        // The item names the template as the *importing* file writes it, so resolve through the
        // declaring file to find the template regardless of alias.
        const tpl = templates.get(`${it.name}__${fileTag(importKey(filePath, item, roots, base))}`);
        if (tpl === undefined) { rewritten.push(it); continue; }
        for (const mangled of usedIn.get(filePath) ?? []) {
          // Only the instantiations of *this* template, and only if it came from this import.
          if (madeIn.get(mangled) !== tpl.filePath) continue;
          if (!mangled.startsWith(`${tpl.decl.name}__${fileTag(tpl.filePath)}$`)) continue;
          rewritten.push({ ...it, name: mangled, alias: mangled });
        }
      }
      item.items = rewritten;
    }
  }

  // Inject the imports the materialised copies need for their argument types. Registered as
  // ordinary import items, so the export rules apply — importing a type that is not exported is
  // still an error, reported against the file that asked for the instantiation.
  //
  // Idempotent, and called again after the generic *functions* are materialised: those register
  // needs of their own, and a first-cut version of this feature ran the injection only here, so a
  // generic function taking a struct from a third file compiled to `expected P__p, got P`.
  function injectNeededImports(): void {
    for (const { inFile, alias, name, from } of needImports.values()) {
      const prog = programs.get(inFile);
      if (prog === undefined) continue;
      const already = prog.items.some((it) =>
        it.tag === "import" && it.items.some((x) => x.alias === alias));
      if (already) continue;
      prog.items.unshift({
        // An injected import has to read back through `importKey` as the file it points at, and a
        // provider's module has no relative path to write — so it is injected as the prefix it is.
        ...(from === CORE.key
          ? { path: "", prefix: CORE.key }
          : { path: relativeImportPath(inFile, from) }),
        tag: "import",
        items: [{ name, alias, line: 0, col: 0, injected: true }],
        line: 0, col: 0,
      });
    }
  }
  injectNeededImports();

  // Templates themselves are removed and the materialised copies take their place.
  //
  // Called again once the generic *functions* have been monomorphised: substituting a function
  // materialises structs of its own, and an instance that no hand-written type names — one that
  // exists only as a generic function's return type — is made after this point. It was made and
  // never placed, so the checker met a struct with no methods on it and said so
  // (`struct 'Opt__main$string' has no method 'orElse'`), and writing `Opt<string>` anywhere in
  // the file made the same program compile [issue 0086].
  const placed = new Set<string>();
  function placeMadeStructs(): void {
    for (const [filePath, prog] of programs) {
      prog.items = prog.items.filter(
        (it) => !((it.tag === "struct" || it.tag === "enum") && it.typeParams.length > 0));
      for (const [mangled, decl] of made) {
        if (placed.has(mangled) || madeIn.get(mangled) !== filePath) continue;
        prog.items.push(decl);
        placed.add(mangled);
      }
    }
  }
  placeMadeStructs();

  // ── Generic functions ───────────────────────────────────────────────────────
  //
  // Collected after the struct work, so a generic function may take or return a monomorphised struct.
  const funcTemplates = new Map<string, { decl: FuncDecl; filePath: string }>();
  for (const [filePath, prog] of programs) {
    for (const item of prog.items) {
      if (item.tag === "func" && item.typeParams.length > 0) {
        funcTemplates.set(canonName(item.name, filePath, origins), { decl: item, filePath });
        keepFuncs?.push({ decl: item, filePath });
      }
    }
  }

  // Runs whether or not any function is generic: the walk below also finishes the job the
  // bracket restriction leaves — giving a construction its type arguments from the type expected
  // of it — and that needs a symbol table for locals, fields and signatures, which is exactly what
  // generic-function inference needed. With no templates of either kind every loop here is a no-op.
  {
    // What `inferArgType` needs to read a call's arguments: every function's declared return type and
    // every struct's fields, keyed canonically so an alias resolves to the same entry.
    const funcReturns = new Map<string, WacType>();
    const structFieldTypes = new Map<string, Map<string, WacType>>();
    const enumVariants = new Map<string, Map<string, WacType[]>>();
    // Parameter types, for pushing an expected type *into* a call's arguments. Fields are kept in
    // declaration order for the same reason: a positional construction matches them by position.
    const funcParams = new Map<string, Param[]>();
    const structFieldList = new Map<string, FieldDecl[]>();
    const methodParams = new Map<string, Map<string, Param[]>>();
    for (const [filePath, prog] of programs) {
      for (const item of prog.items) {
        // Keyed through `canonName`, which is what every lookup uses. A hand-written name is in
        // `origins` and canonicalises to `Name__file`; a *materialised* one is not, and
        // canonicalises to itself — so both sides agree either way. Keying on the written form
        // meant a materialised struct's fields were never found [the `this.v` case].
        if (item.tag === "func") {
          funcReturns.set(canonName(item.name, filePath, origins), item.returnType);
          funcParams.set(canonName(item.name, filePath, origins), item.params);
        } else if (item.tag === "struct") {
          const fields = new Map<string, WacType>();
          for (const f of item.fields) fields.set(f.name, f.type);
          for (const m of item.methods) fields.set(m.name, m.returnType);
          structFieldTypes.set(canonName(item.name, filePath, origins), fields);
          structFieldList.set(canonName(item.name, filePath, origins), item.fields);
          methodParams.set(canonName(item.name, filePath, origins),
            new Map(item.methods.map((m) => [m.name, m.params])));
        } else if (item.tag === "enum") {
          // Payload types per variant, so a `match` arm's bindings have types during this pass:
          // `case A(v): f(v)` has to know what `v` is. Enums have not desugared yet — generics run
          // first, by design — so the variants are still here to read.
          const variants = new Map<string, WacType[]>();
          for (const v of item.variants) variants.set(v.name, v.fields.map((f) => f.type));
          enumVariants.set(canonName(item.name, filePath, origins), variants);
          const fields = new Map<string, WacType>();
          for (const m of item.methods) fields.set(m.name, m.returnType);
          structFieldTypes.set(canonName(item.name, filePath, origins), fields);
          methodParams.set(canonName(item.name, filePath, origins),
            new Map(item.methods.map((m) => [m.name, m.params])));
        }
      }
    }

    const madeFuncs = new Map<string, FuncDecl>();
    const funcMadeIn = new Map<string, string>();
    const funcUsedIn = new Map<string, Set<string>>();

    /** Materialise a generic function for one set of inferred arguments. */
    // Nesting depth of the materialisation *in progress*, which is exactly a counter because the
    // walk is depth-first and synchronous: a call inside a copy is rewritten before the copy is
    // finished. `i32 grow<T>(T a) { Box<T> b = Box(a); return grow(b); }` recurses with a bigger
    // argument every time and would otherwise run until the stack ends.
    let funcDepth = 0;
    let cappedReported = false;

    const materialiseFunc = (
      tpl: { decl: FuncDecl; filePath: string }, bound: Map<string, Bound>,
      callFile: string, at: At,
    ): string | null => {
      if (funcDepth > MAX_INSTANTIATION_DEPTH) {
        // Reported once: every frame below the cap would say the same thing about the same call.
        if (!cappedReported) {
          cappedReported = true;
          err(`generic instantiation of '${tpl.decl.name}' nests more than ` +
              `${MAX_INSTANTIATION_DEPTH} deep — a generic function that calls itself with a ` +
              `larger argument never terminates`,
            callFile, at.line, at.col);
        }
        return null;
      }
      const args = tpl.decl.typeParams.map((p) => bound.get(p)!);
      // Mangled one argument at a time rather than through `mangle`, because each argument may have
      // been resolved in a different file — see `Bound`.
      const mangled = `${tpl.decl.name}__${fileTag(tpl.filePath)}$` +
        args.map((a) => mangleType(a.type, a.file, origins)).join("$");
      let set = funcUsedIn.get(callFile);
      if (set === undefined) { set = new Set(); funcUsedIn.set(callFile, set); }
      set.add(mangled);
      if (madeFuncs.has(mangled)) return mangled;

      const sub = new Map<string, WacType>();
      tpl.decl.typeParams.forEach((p, i) =>
        sub.set(p, visibleFrom(args[i].type, args[i].file, tpl.filePath)));
      const decl: FuncDecl = {
        // `exported` is inherited, as a materialised struct's is: a call from another file reaches
        // the instantiation through an injected import, and an import of something not exported is
        // an error. The wasm module therefore exports the mangled name too, which is why
        // `genericDisplay` carries the demangling for anything that reports it.
        ...tpl.decl, name: mangled, typeParams: [],
        returnType: substType(tpl.decl.returnType, sub),
        params: tpl.decl.params.map((prm) => ({ ...prm, type: substType(prm.type, sub) })),
        body: substBlock(tpl.decl.body, sub),
      };
      madeFuncs.set(mangled, decl);
      funcMadeIn.set(mangled, tpl.filePath);
      display?.set(mangled,
        `${tpl.decl.name}<${args.map((a) => displayType(a.type, display)).join(", ")}>`);
      // So a nested call reads back: `max(max(a, b), c)` rewrites the inner call first, and the
      // outer one then infers from `max$i32`'s declared return type.
      funcReturns.set(mangled, decl.returnType);
      // The copy may itself name generic structs, or call other generic functions.
      const t = (x: WacType) => rewriteType(x, 1, tpl.filePath);
      t(decl.returnType);
      for (const prm of decl.params) t(prm.type);
      visitBlockTypes(decl.body, t);
      inferConstructions(decl.body, decl.returnType, tpl.filePath);
      funcDepth++;
      rewriteCallsIn(decl.body, tpl.filePath, decl.params, decl.returnType);
      funcDepth--;
      return mangled;
    };

    /** An arm's bindings as locals, typed from the variant's payload. Empty if anything is unknown. */
    // Written as consts rather than declarations because they live inside a block: `deno lint`'s
    // no-inner-declarations, and the same shape every other nested helper in this file uses. They
    // are mutually recursive, which is fine — none is *called* until the walk starts below.
    const armBindings = (
      arm: MatchArm, subject: WacType | null, filePath: string,
    ): Map<string, WacType> => {
      const out = new Map<string, WacType>();
      if (subject === null || arm.variant === null) return out;
      const named = subject.kind === "nullable" ? subject.inner : subject;
      if (named.kind !== "struct") return out;
      const payload = enumVariants.get(canonName(named.name, filePath, origins))?.get(arm.variant);
      if (payload === undefined) return out;
      // `_` is the wildcard, and a pattern may bind fewer names than the variant has fields.
      arm.bindings.forEach((name, i) => {
        if (name !== "_" && i < payload.length) out.set(name, payload[i]);
      });
      return out;
    };

    /**
     * Walk a body: rewrite every call to a generic function, and give every construction the type
     * arguments its position expects.
     *
     * `retType` is threaded rather than passed around because a `return` is the one expected-type
     * position that comes from the declaration rather than from the statement.
     */
    let retType: WacType = { kind: "prim", name: "void", line: 0, col: 0 };
    const rewriteCallsIn = (
      body: Block, filePath: string, params: Param[], ret: WacType,
    ): void => {
      const outer = retType;
      retType = ret;
      const env: LocalTypes = [new Map(params.map((p) => [p.name, p.type]))];
      walkStmtsForCalls(body.stmts, env, filePath);
      retType = outer;
    };

    /** The declared type of an assignment target, so the right-hand side has an expected type. */
    const lvalueType = (lv: Lvalue, env: LocalTypes, filePath: string): WacType | null => {
      switch (lv.kind) {
        case "lv-ident": return lookupLocal(env, lv.name) ?? null;
        case "lv-unwrap": {
          const t = lvalueType(lv.base, env, filePath);
          return t !== null && t.kind === "nullable" ? t.inner : t;
        }
        case "lv-index": {
          const t = lvalueType(lv.base, env, filePath);
          return t !== null && t.kind === "array" ? t.elem : null;
        }
        case "lv-field": {
          const base = lvalueType(lv.base, env, filePath);
          if (base === null) return null;
          const named = base.kind === "nullable" ? base.inner : base;
          if (named.kind !== "struct") return null;
          return structFieldTypes.get(canonName(named.name, filePath, origins))?.get(lv.field)
            ?? null;
        }
      }
    };

    /**
     * Give a construction the type arguments its position expects.
     *
     * The pre-materialisation pass covers a declaration and a `return`, which need no symbol table.
     * The rest of the positions the design lists — assignment, a call's arguments, a construction's
     * own arguments, an array's elements — need one, so they are done here. Without this,
     * `b = Box(4)` and `f(Box(4))` were impossible to write for a *generic* struct, and a generic
     * enum was worse: `Option.Some(x)` cannot name its arguments at all, so an argument position
     * had no spelling that worked.
     */
    const applyExpectedHere = (e: Expr, expected: WacType | null, filePath: string): void => {
      if (expected === null) return;
      applyExpected(e, expected, filePath);
    };

    const walkStmtsForCalls = (stmts: Stmt[], env: LocalTypes, filePath: string): void => {
      env.push(new Map());
      for (const st of stmts) {
        // The declaration is visited before its own name is in scope, so `T x = f(x)` refers to an
        // outer `x` — which is what block scoping means and what the checker will agree with.
        visitExprsForCalls(st, env, filePath);
        if (st.kind === "var") env[env.length - 1].set(st.name, st.type);
      }
      env.pop();
    };

    const visitExprsForCalls = (st: Stmt, env: LocalTypes, filePath: string): void => {
      const expr = (e: Expr) => rewriteCallExpr(e, env, filePath);
      switch (st.kind) {
        case "var": applyExpectedHere(st.init, st.type, filePath); expr(st.init); return;
        case "assign":
          // A compound assignment (`+=`) cannot be a construction, and its expected type is the
          // operand's anyway, so the plain form is the only one that needs this.
          applyExpectedHere(st.rhs, lvalueType(st.lval, env, filePath), filePath);
          expr(st.rhs);
          return;
        case "if":
          expr(st.cond);
          walkStmtsForCalls(st.then.stmts, env, filePath);
          if (st.els?.kind === "else-if") visitExprsForCalls(st.els.stmt, env, filePath);
          else if (st.els?.kind === "else-block") walkStmtsForCalls(st.els.block.stmts, env, filePath);
          return;
        case "while": case "dowhile":
          expr(st.cond); walkStmtsForCalls(st.body.stmts, env, filePath); return;
        case "for": {
          env.push(new Map());
          if (st.init) { visitExprsForCalls(st.init, env, filePath);
            if (st.init.kind === "var") env[env.length - 1].set(st.init.name, st.init.type); }
          if (st.cond) expr(st.cond);
          if (st.update) visitExprsForCalls(st.update, env, filePath);
          walkStmtsForCalls(st.body.stmts, env, filePath);
          env.pop();
          return;
        }
        case "switch":
          expr(st.expr);
          for (const c of st.cases) {
            if (c.value !== "default") expr(c.value);
            walkStmtsForCalls(c.body, env, filePath);
          }
          return;
        case "match": {
          expr(st.subject);
          // An arm's bindings are locals for the length of the arm, and their types come from the
          // variant's payload — positionally, which is what the pattern syntax means.
          const subject = inferArgType(
            st.subject, env, filePath, origins, funcReturns, funcParams, structFieldTypes);
          for (const a of st.arms) {
            env.push(armBindings(a, subject, filePath));
            walkStmtsForCalls(a.body, env, filePath);
            env.pop();
          }
          return;
        }
        case "return":
          if (st.value) { applyExpectedHere(st.value, retType, filePath); expr(st.value); }
          return;
        case "block": walkStmtsForCalls(st.block.stmts, env, filePath); return;
        case "expr": expr(st.expr); return;
        default: return;
      }
    };

    /** Rewrite a call to a generic function, and recurse into its subexpressions. */
    const rewriteCallExpr = (e: Expr, env: LocalTypes, filePath: string): void => {
      // Depth first, so `outer(inner(1))` resolves `inner` before `outer` reads its return type.
      switch (e.kind) {
        case "construct": {
          // A construction's own arguments are an expected-type position: the fields of the struct
          // being built, by position, and by name for the `S { f: … }` form. A call parses as a
          // construction too, so the same node covers a function's parameters.
          const key = canonName(e.ctype.kind === "struct" ? e.ctype.name : "", filePath, origins);
          const fields = structFieldList.get(key);
          const params = funcParams.get(key);
          e.args.forEach((a, i) => {
            const want = fields !== undefined
              ? fields[i]?.type
              : params !== undefined ? params[i]?.type : undefined;
            if (want !== undefined) applyExpectedHere(a, want, filePath);
          });
          for (const n of e.named ?? []) {
            const want = fields?.find((f) => f.name === n.name)?.type;
            if (want !== undefined) applyExpectedHere(n.val, want, filePath);
          }
          for (const a of e.args) rewriteCallExpr(a, env, filePath);
          for (const n of e.named ?? []) rewriteCallExpr(n.val, env, filePath);
          break;
        }
        case "call": {
          // A method call, or a variant construction — `E.V(args)`, whose "parameters" are the
          // variant's payload fields. Both reach their arguments through a field callee.
          if (e.callee.kind === "field") {
            const recv = e.callee.expr;
            const variantOf = recv.kind === "ident"
              ? enumVariants.get(canonName(recv.name, filePath, origins))?.get(e.callee.name)
              : undefined;
            const method = (() => {
              const base = inferArgType(
                recv, env, filePath, origins, funcReturns, funcParams, structFieldTypes);
              if (base === null) return undefined;
              const named = base.kind === "nullable" ? base.inner : base;
              if (named.kind !== "struct") return undefined;
              return methodParams.get(canonName(named.name, filePath, origins))?.get(e.callee.name);
            })();
            e.args.forEach((a, i) => {
              const want = variantOf !== undefined ? variantOf[i] : method?.[i]?.type;
              if (want !== undefined) applyExpectedHere(a, want, filePath);
            });
          }
          rewriteCallExpr(e.callee, env, filePath);
          for (const a of e.args) rewriteCallExpr(a, env, filePath);
          return;
        }
        case "unary": case "unwrap": case "field": case "cast":
          rewriteCallExpr(e.expr, env, filePath); return;
        case "binary":
          rewriteCallExpr(e.left, env, filePath); rewriteCallExpr(e.right, env, filePath); return;
        case "ternary":
          rewriteCallExpr(e.cond, env, filePath);
          rewriteCallExpr(e.then, env, filePath);
          rewriteCallExpr(e.else_, env, filePath);
          return;
        case "index":
          rewriteCallExpr(e.expr, env, filePath); rewriteCallExpr(e.idx, env, filePath); return;
        case "arrNew":
          if (e.size) rewriteCallExpr(e.size, env, filePath);
          if (e.fill) { applyExpectedHere(e.fill, e.elem, filePath); rewriteCallExpr(e.fill, env, filePath); }
          for (const x of e.fixed) { applyExpectedHere(x, e.elem, filePath); rewriteCallExpr(x, env, filePath); }
          return;
        case "matchExpr": {
          rewriteCallExpr(e.subject, env, filePath);
          const subject = inferArgType(
            e.subject, env, filePath, origins, funcReturns, funcParams, structFieldTypes);
          for (const a of e.arms) {
            env.push(armBindings(a, subject, filePath));
            walkStmtsForCalls(a.body, env, filePath);
            if (a.value) rewriteCallExpr(a.value, env, filePath);
            env.pop();
          }
          return;
        }
        default: return;
      }

      // Only a `construct` reaches here — which is what a plain call parses as.
      if (e.kind !== "construct" || e.ctype.kind !== "struct") return;
      const tpl = funcTemplates.get(canonName(e.ctype.name, filePath, origins));
      if (tpl === undefined) return;

      if (e.args.length !== tpl.decl.params.length) {
        err(`'${tpl.decl.name}' takes ${tpl.decl.params.length} argument(s), got ${e.args.length}`,
          filePath, e.line, e.col);
        return;
      }
      const bound = new Map<string, Bound>();
      const actuals: WacType[] = [];
      const paramNames = new Set(tpl.decl.typeParams);
      const ctx = { inst: structInst, origins, paramFile: tpl.filePath };
      for (let i = 0; i < e.args.length; i++) {
        const actual = inferArgType(e.args[i], env, filePath, origins, funcReturns, funcParams, structFieldTypes);
        if (actual === null) {
          err(`cannot infer ${tpl.decl.typeParams.map((t) => `'${t}'`).join(", ")} for ` +
              `'${tpl.decl.name}': argument ${i + 1}'s type is not evident here. ` +
              `Assign it to a declared variable first.`,
            filePath, e.args[i].line, e.args[i].col);
          return;
        }
        if (!unifyParam(tpl.decl.params[i].type, { type: actual, file: filePath },
                        paramNames, bound, ctx)) {
          err(`'${tpl.decl.name}' cannot take these arguments together: ` +
              `they imply different types for the same type parameter`,
            filePath, e.line, e.col);
          return;
        }
        actuals.push(actual);
      }
      const missing = tpl.decl.typeParams.filter((t) => !bound.has(t));
      if (missing.length > 0) {
        // Two different failures, and they want different messages. A parameter no *parameter type*
        // mentions can never be determined by any call, so saying so once is the whole story. One
        // that is mentioned failed on this call's argument shapes, and the useful thing to name is
        // which argument was supposed to supply it.
        const mentions = (t: WacType, name: string): boolean => {
          switch (t.kind) {
            case "prim":     return false;
            case "array":    return mentions(t.elem, name);
            case "nullable": return mentions(t.inner, name);
            case "funcref":  return t.params.some((x) => mentions(x, name)) || mentions(t.ret, name);
            case "struct":
              return t.name === name || (t.typeArgs ?? []).some((a) => mentions(a, name));
          }
        };
        const unmentioned = missing.filter(
          (t) => !tpl.decl.params.some((prm) => mentions(prm.type, t)));
        if (unmentioned.length > 0) {
          // Terminal rather than a suggestion to write the arguments: a call cannot name them,
          // since `f<i32>(…)` would be ambiguous with less-than.
          err(`'${tpl.decl.name}' has type parameter(s) ${
                unmentioned.map((t) => `'${t}'`).join(", ")} ` +
              `that no parameter's type mentions, so a call cannot determine ${
                unmentioned.length > 1 ? "them" : "it"} — a call cannot name its type arguments`,
            filePath, e.line, e.col);
          return;
        }
        const which = missing[0];
        const at = tpl.decl.params.findIndex((prm) => mentions(prm.type, which));
        err(`cannot infer '${which}' for '${tpl.decl.name}': argument ${at + 1} is ${
              displayType(actuals[at], display)}, and the parameter is ${
              displayType(tpl.decl.params[at].type, display)} — the shapes do not match`,
          filePath, e.args[at].line, e.args[at].col);
        return;
      }
      const made = materialiseFunc(tpl, bound, filePath, e);
      // Left alone when the cap trips: the error above is the one to read, and renaming the call to
      // an instantiation that was never built would only add a second, stranger one.
      if (made !== null) (e.ctype as { name: string }).name = made;
    };

    // Every hand-written body, then the templates' own copies via materialiseFunc.
    for (const [filePath, prog] of programs) {
      for (const item of prog.items) {
        if (item.tag === "func" && item.typeParams.length === 0) {
          rewriteCallsIn(item.body, filePath, item.params, item.returnType);
        } else if (item.tag === "struct" || item.tag === "enum") {
          for (const m of item.methods) {
            const params = m.hasThis
              ? [{ isConst: m.thisConst, type: { kind: "struct" as const, name: item.name, line: m.line, col: m.col }, name: "this", line: m.line, col: m.col }, ...m.params]
              : m.params;
            rewriteCallsIn(m.body, filePath, params, m.returnType);
          }
        }
      }
    }

    // Replace the templates with their instantiations, in the template's own file.
    for (const [filePath, prog] of programs) {
      prog.items = prog.items.filter(
        (it) => !(it.tag === "func" && it.typeParams.length > 0));
      for (const [mangled, decl] of madeFuncs) {
        if (funcMadeIn.get(mangled) === filePath) prog.items.push(decl);
      }
    }
    // A call in another file reaches the instantiation by import, as a struct does.
    for (const [filePath, prog] of programs) {
      // Two `import ... from "./lib.wac"` statements in one file both resolve to the same file, so
      // the injected name has to be claimed once rather than added to each of them — importing the
      // same name twice is an error.
      const injected = new Set<string>();
      for (const item of prog.items) {
        if (item.tag !== "import") continue;
        const from = importKey(filePath, item, roots, base);
        const extra: typeof item.items = [];
        for (const mangled of funcUsedIn.get(filePath) ?? []) {
          if (funcMadeIn.get(mangled) !== from) continue;
          if (item.items.some((x) => x.alias === mangled)) continue;
          if (injected.has(mangled)) continue;
          injected.add(mangled);
          extra.push({ name: mangled, alias: mangled, line: 0, col: 0 });
        }
        item.items = [...item.items.filter((it) =>
          funcTemplates.get(`${it.name}__${fileTag(from)}`) === undefined), ...extra];
      }
    }
    injectNeededImports();
    placeMadeStructs();   // the instances the substituted function bodies asked for
  }

  // Anything still naming a template by itself could not get arguments from anywhere, which is the
  // one case the bracket restriction cannot cover. Last of all, after every expected type has had
  // its chance: a construction assigned to a local, passed to a call or nested inside another
  // construction gets its arguments in the walk above, and reporting before that ran flagged code
  // that was about to be given what it needed.
  eachTypeInPrograms(programs, (t, filePath) => {
    if (t.kind === "struct" && templateFor(t.name, filePath) !== undefined &&
        (t.typeArgs === undefined || t.typeArgs.length === 0)) {
      err(`'${t.name}' is generic and needs type arguments, as in '${t.name}<i32>' — or an ` +
          `expected type to take them from, such as a declared variable's type`,
        filePath, t.line, t.col);
    }
  }, true);

}

/** The struct a `P?` boxes into, for a primitive P. `#` cannot appear in an IDENT. */
export function boxStructName(prim: string): string {
  return `#box$${prim}`;
}

/**
 * A primitive that needs boxing to be nullable — which is every one that is not already a
 * reference. `string`, `anyref` and `i31ref` are refs, so `string?` is just a nullable ref.
 */
export function needsBoxing(t: WacType): boolean {
  return t.kind === "prim" && t.name !== "string" && t.name !== "anyref" &&
    t.name !== "i31ref" && t.name !== "void";
}

/**
 * Register one struct per primitive that appears as `P?` anywhere in the program.
 *
 * `i32?` has to hold either an i32 or null, and no wasm numeric type has a null — so the
 * value is boxed in a one-field struct and the slot holds `anyref`. The alternative,
 * `ref.i31`, is free but only holds 31 bits, so it would silently truncate exactly the i32
 * values a program is most likely to be careful about [issue 0045].
 *
 * Synthesised the same way an enum's base and variant structs are, and for the same reason:
 * everything downstream — the type section, field offsets, `struct.new` — already knows how
 * to handle a struct, and nothing else has to learn about boxing.
 *
 * Deliberately *not* added to any file scope. `#` cannot appear in an IDENT, so no program
 * can name one, and nothing but the emitter should.
 */
function registerBoxTypes(
  programs: Map<string, Program>, structs: StructEntry[], entryPath: string,
): void {
  const wanted = new Set<string>();
  eachTypeInPrograms(programs, (t) => {
    if (t.kind === "nullable" && needsBoxing(t.inner)) {
      wanted.add((t.inner as { name: string }).name);
    }
  });
  for (const prim of [...wanted].sort()) {
    const name = boxStructName(prim);
    if (structs.some((s) => s.name === name)) continue;
    const field: FieldDecl = {
      name: "v", type: { kind: "prim", name: prim, line: 0, col: 0 },
      isConst: false, line: 0, col: 0,
    };
    const decl: StructDecl = {
      tag: "struct", isConst: false, exported: false, name, parent: null,
      fields: [field], methods: [], typeParams: [], line: 0, col: 0,
    };
    structs.push({
      structDecl: decl, name, typeIndex: structs.length, filePath: entryPath,
      methods: new Map(), parentEntry: null,
    });
  }
}

/**
 * Report `Foo<i32>` when the program declares no templates at all.
 *
 * Only reached in that case, so nothing can be generic and every argument list is stray — no name
 * resolution is needed.
 */
function reportStrayArgs(
  programs: Map<string, Program>,
  err: (msg: string, file: string, line: number, col: number) => void,
): void {
  eachTypeInPrograms(programs, (t, filePath) => {
    if (t.kind === "struct" && t.typeArgs && t.typeArgs.length > 0) {
      err(`'${t.name}' is not generic, so it takes no type arguments`, filePath, t.line, t.col);
      delete (t as { typeArgs?: WacType[] }).typeArgs;
    }
  });
}

export function wacResolve(
  entryPath: string,
  programs: Map<string, Program>,
  /**
   * The project root each file sits in, for `@/` — absent for every file the caller could not find
   * one for, which is an ordinary state: the playground has no filesystem to search.
   */
  roots?: ReadonlyMap<string, string>,
  /** The directory relative keys are measured from — see `relativeTo`. `issues/lang/0168a`. */
  base?: string,
): ResolveResult {
  const errors: ResolveError[] = [];

  // Generics are substituted before anything else looks at the AST — in particular before
  // enums desugar, so `Option<i32>` becomes a concrete enum and then concrete structs. The
  // other order would leave the generated structs still carrying `T`, and substitution would
  // be rewriting generated code [see ~/notes/living/wac/generics-design.md].
  const genericDisplay = new Map<string, string>();
  const templateDecls: { decl: StructDecl; filePath: string }[] = [];
  const funcTemplateDecls: { decl: FuncDecl; filePath: string }[] = [];
  const enumTemplateDecls: { decl: EnumDecl; filePath: string }[] = [];
  monomorphise(programs,
    (msg, file, line, col) => errors.push({ message: msg, file, line, col }),
    genericDisplay, templateDecls, funcTemplateDecls, enumTemplateDecls, roots, base);
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
        // The enum's methods belong to the base struct, so `this` is the enum type and
        // `match (this)` is how a method reaches a variant.
        //
        // Phase 3 below registers the callable entries by reading the *EnumDecl*, and
        // `collectArrayTypes` reaches the bodies through `result.funcs`, so this assignment
        // is currently redundant for both. It is here because the declaration should
        // describe what the struct actually has: any walk that reads `structDecl.methods` —
        // as several do for hand-written structs — would otherwise skip an enum's methods
        // silently, which is the failure this codebase produces most often.
        parent: null, fields: [tagField], methods: item.methods, typeParams: [], line, col,
      };
      const base: StructEntry = {
        enumRole: "base",
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
        // A variant's payload becomes struct fields, and a duplicate field name was
        // already an error for a hand-written struct — but the generated ones skipped
        // that check, so `A(i32 x, i32 x)` compiled. Two variants may of course share
        // a field name; they are different structs.
        const payloadNames = new Set<string>();
        for (const f of v.fields) {
          if (payloadNames.has(f.name)) {
            err(`duplicate payload field '${f.name}' in variant '${v.name}'`,
              filePath, f.line, f.col);
          }
          payloadNames.add(f.name);
        }
        // An instantiation of a generic enum registers its variants under a *qualified* key.
        // `Option<i32>` and `Option<f64>` would otherwise both claim `Some`, and neither has a
        // better claim than the other. `case Some(v)` is unaffected — an arm resolves its variant
        // through the subject's enum, not through the file scope — so what this costs is naming
        // such a variant as a type, which is documented in spec/spec/generics.md.
        const scopeKey = genericDisplay.has(name) ? `${name}$${v.name}` : v.name;
        if (scopeKey !== v.name) {
          // So a diagnostic about it reads `Option<i32>.Some` rather than the mangled name. The
          // variant is deliberately *not* reachable under its bare name for a generic enum, so this
          // is the only spelling a message could otherwise use.
          genericDisplay.set(scopeKey, `${genericDisplay.get(name)}.${v.name}`);
        }
        if (scope.has(scopeKey)) {
          err(`duplicate name '${v.name}'`, filePath, v.line, v.col);
          continue;
        }
        // A variant lists only its payload; inherited fields are computed later, so
        // the tag is not repeated here.
        // Declared under the *qualified* name for an instantiation, so two instantiations of one
        // generic enum are two distinct types rather than one shadowing the other. What this costs
        // is naming such a variant as a type — `Some s` and `x is Some` — which has no unambiguous
        // spelling anyway. `case Some(v)` is unaffected: an arm resolves through the subject's enum.
        const variantDecl: StructDecl = {
          tag: "struct", isConst: false, exported: item.exported, name: scopeKey,
          parent: name,
          fields: v.fields.map((f) => ({
            isConst: true, type: f.type, name: f.name, line: f.line, col: f.col,
          })),
          methods: [], typeParams: [], line: v.line, col: v.col,
        };
        const vEntry: StructEntry = {
          enumRole: "variant",
          structDecl: variantDecl, name: scopeKey, typeIndex: structs.length,
          filePath, methods: new Map(), parentEntry: base,
        };
        structs.push(vEntry);
        const variant: VariantEntry = {
          name: v.name, tag, entry: vEntry, fields: v.fields,
        };
        variants.push(variant);
        // Registered as a variant rather than a plain struct, so a constructor call
        // can find its tag and `Shape.Circle` can be told from a static method.
        scope.set(scopeKey, { kind: "variant", entry: vEntry, enumEntry, variant });
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
      // A monomorphised copy is not wasm-exported even though its template said `export`: the name
      // a host would have to call is `max__m$i32`, which the author never wrote and which changes
      // with the file it lives in. `export` still governs whether another *wac* file may import it,
      // which is how the call site in that file reaches the instantiation. A stable wasm export of
      // a generic means writing a concrete wrapper — `export i32 maxI32(i32 a, i32 b)`.
      const exportName = item.exported && !genericDisplay.has(name) ? name : null;
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
      // An enum's methods live on its generated base struct, so this pass has to see enums
      // too. Registering methods only for `tag === "struct"` left an enum's methods parsed,
      // attached to the base's declaration, and invisible to every lookup — the same
      // omission as issue 0005, which is now the sixth walk to have needed an enum case.
      if (item.tag !== "struct" && item.tag !== "enum") continue;
      const structScopeEntry = scope.get(item.name);
      if (!structScopeEntry) continue;
      // A struct name resolves to `struct`, an enum name to `enum`; both carry the struct
      // entry the name denotes.
      if (structScopeEntry.kind !== "struct" && structScopeEntry.kind !== "enum") continue;
      const structEntry = structScopeEntry.entry;

      const methodNames = new Set<string>();
      for (const method of item.methods) {
        const { name: mname, line, col } = method;
        if (methodNames.has(mname)) {
          err(`duplicate method '${mname}' in struct '${item.name}'`, filePath, line, col);
          continue;
        }
        // A method may not share a name with a field. For an enum the analogous clash is
        // with a *variant*, because `E.name` would then mean two things — and it is a
        // clash worth reporting rather than resolving by precedence.
        if (item.tag === "enum") {
          if (item.variants.some(v => v.name === mname)) {
            err(`'${mname}' is already a variant of enum '${item.name}'`, filePath, line, col);
            continue;
          }
        } else if (item.fields.some(f => f.name === mname)) {
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

      // Also check for duplicate fields. An enum has none of its own — its base carries
      // only the synthetic tag, and payload fields are checked per variant where they are
      // declared.
      if (item.tag === "enum") continue;
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
      const importedPath = importKey(filePath, item, roots, base);
      // **`@/` with no project is an error here rather than a lookup that misses.** D7: *no manifest
      // within that boundary is a compile error*. `resolveSpecifier` answers "" for it, and the
      // reason this is caught rather than passed on is that the alternative resolves — joining
      // `@/src/a.wac` to nothing gives `src/a.wac`, a real-looking key relative to a directory
      // nobody named, so the program would compile against the wrong file instead of being refused.
      if (importedPath === "" && item.prefix === undefined && isProjectSpecifier(item.path)) {
        err(
          `\`${item.path}\` needs a project: no \`wac.json5\` above ${filePath}`,
          filePath, item.line, item.col,
        );
        continue;
      }
      // A quoted `"core"` joins to the same key core is filed under, which used to be the reason to
      // refuse it: the argument was that a quoted specifier says *a file lives at this path* and
      // there was no path here to be right or wrong about. `design/lang/0009` D4 removed the
      // premise. `core` is a source tree now — `core/option.wac` does name a file inside the
      // compiler, and is imported quoted like any other — so the root being the one member of that
      // tree written without quotes is the odd spelling rather than the principled one.
      //
      // Both spellings resolve here, and to the same key, which is the point: `Read` reached two
      // ways has to be one type. The unquoted form is not deprecated by this commit — 65 files use
      // it and they are swept separately — but `spec/spec/imports.md` now says which one to write.
      visitFile(importedPath); // recursive DFS

      const importedScope = fileScopes.get(importedPath);
      if (!importedScope) continue; // file not found — already reported

      for (const { name, alias, line, col, injected } of item.items) {
        const found = importedScope.get(name);
        if (!found) {
          err(`'${name}' is not exported from '${importedPath}'`, filePath, line, col);
          continue;
        }
        // A compiler-injected import is exempt from the export rule: it exists so a materialised
        // generic's field types resolve in the template's file, and the author's intent was the
        // type argument at the use site. Requiring `export` on it would mean a local struct could
        // not be a type argument of a generic declared elsewhere, which is not a rule anyone
        // stated and not one the use site can see.
        if (injected === true) {
          scope.set(alias, found);
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

  // ── Final pass: a written type name must be in scope in the file that wrote it ──
  //
  // Identity is the type index, and everything downstream keys on it — but a type whose name did
  // not resolve had no index, and every consumer then fell back to a *global* name map. So a file
  // could name a type it never imported, and when two files declared the same name one of them won
  // arbitrarily: `x is Circle` answered false about a value that was a `Circle` [issue 0048]. The
  // scope is the authority on what a name means, and this is where that is enforced.
  //
  // Reporting only, not annotating. A type in a file whose imports were injected by
  // monomorphisation could not resolve when `annotateProgram` ran — the injection happens after the
  // file is visited — so it has no index and resolves by name later. That is safe where the name is
  // one the *compiler* invented, because those are unique by construction: an alias carries its
  // declaring file and a mangled instantiation its arguments. Annotating here as well made no test
  // behave differently, so it is not done.
  for (const [filePath, prog] of programs) {
    const scope = fileScopes.get(filePath);
    if (scope === undefined) continue;
    eachTypeInProgram(prog, (t) => {
      if (t.kind !== "struct") return;
      const found = scope.get(t.name);
      if (found?.kind === "struct" || found?.kind === "enum" || found?.kind === "variant") return;
      // A *call* arrives here too: the parser reads every `name(args)` as a construction, so the
      // callee's name is a struct-kind type until something knows better. If the name is in scope
      // as anything at all, this is not the pass to complain.
      if (found !== undefined) return;
      // A generic template's name is reported by monomorphisation, with a message that says what
      // to do about it; a second one here would be noise.
      if (genericDisplay.has(t.name)) return;
      // A generic enum's variant has no bare name by design, and the type checker says so with a
      // hint naming the enum. Resolver errors carry no hint, so the better message is left to win.
      if (enumTemplateDecls.some((e) => e.decl.variants.some((v) => v.name === t.name))) return;
      err(`undefined type '${t.name}'`, filePath, t.line, t.col);
    });
  }

  registerBoxTypes(programs, structs, entryPath);

  return {
    funcs, structs, enums, fileScopes, errors, entryPath, genericDisplay,
    templates: templateDecls, funcTemplates: funcTemplateDecls,
    enumTemplates: enumTemplateDecls,
  };
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
