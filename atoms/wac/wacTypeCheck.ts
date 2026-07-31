// Type checker for wac — validates types of all function and method bodies.
// Input: ResolveResult (from wacResolve) + pre-parsed programs map.
// Output: array of type errors (structured, with file/line/col).
//
// Checks: expression types, operator rules, assignment compatibility,
// const enforcement, return-path completeness, packed type restrictions,
// struct construction, method calls, cast validity, override correctness.

import {
  type Program, type Expr, type Stmt, type Block, type WacType,
  type Lvalue, type ElseBranch, type SwitchCase,
  type FieldDecl, type StructDecl, type MatchArm, type ConstDecl,
} from "./wacParse.ts";
import {
  type ResolveResult, type FuncEntry, type StructEntry, type FileScope,
  type EnumEntry,
  funcParams, funcReturnType, commonAncestor,
} from "./wacResolve.ts";
import { wacIntLit } from "./wacIntLit.ts";

// ── Public types ──────────────────────────────────────────────────────────────

export type TypeCheckError = {
  message: string;
  file: string;
  line: number;
  col: number;
  span?: number;
  annotation?: string;
  hint?: string;
  /** First line of leading context for multi-line spans (e.g. the line the
   *  call opens on when an argument error is reported on a later line). */
  contextStart?: number;
  /** Defaults to "error" when absent. Warnings never fail the compile. */
  severity?: "error" | "warning";
};

// ── Type utilities ────────────────────────────────────────────────────────────

/** Build a synthetic primitive type (no source position needed). */
function prim(name: string): WacType {
  return { kind: "prim", name, line: 0, col: 0 };
}

// Well-known singletons
const T_I32  = prim("i32");
const T_I64  = prim("i64");
const T_U32  = prim("u32");
const T_U64  = prim("u64");
const T_F32  = prim("f32");
const T_F64  = prim("f64");
const T_BOOL = prim("bool");
const T_VOID = prim("void");
const T_STR  = prim("string");
const T_ANY  = prim("anyref");
const T_I31  = prim("i31ref");
/** Sentinel for the `null` literal — compatible with any T? */
const T_NULL = prim("null");

/** Is this the type of the `null` literal? */
function isNullT(t: WacType): boolean {
  return t.kind === "prim" && t.name === "null";
}

/**
 * `T?` for a `T` that can hold null, or null when the type has no nullable form.
 *
 * Already-nullable types come back unchanged; a numeric primitive has no nullable
 * form, so there is nothing to widen a `null` branch against.
 */
function nullableOf(t: WacType): WacType | null {
  if (t.kind === "nullable") return t;
  if (t.kind === "struct" || t.kind === "array" || t.kind === "funcref") return nullable(t);
  if (t.kind === "prim" && t.name === "string") return nullable(t);
  return null;
}

function structType(name: string, resolvedTypeIndex?: number): WacType {
  return { kind: "struct", name, resolvedTypeIndex, line: 0, col: 0 };
}

function arrayOf(elem: WacType): WacType {
  return { kind: "array", elem, line: 0, col: 0 };
}

function nullable(inner: WacType): WacType {
  return { kind: "nullable", inner, line: 0, col: 0 };
}

/** Structural type equality. */
function typeEq(a: WacType, b: WacType): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "prim":     return a.name === (b as typeof a).name;
    case "struct": {
      // Struct identity is the resolved declaration, not the written name:
      // `Box` and its import alias `BoxA` are the same type, while two files'
      // unrelated `Box`es are not. Names are only compared when resolution
      // failed (unknown type — already reported elsewhere).
      const bs = b as typeof a;
      if (a.resolvedTypeIndex !== undefined && bs.resolvedTypeIndex !== undefined) {
        return a.resolvedTypeIndex === bs.resolvedTypeIndex;
      }
      return a.name === bs.name;
    }
    case "array":    return typeEq(a.elem, (b as typeof a).elem);
    case "nullable": return typeEq(a.inner, (b as typeof a).inner);
    case "funcref": {
      const bb = b as typeof a;
      return typeEq(a.ret, bb.ret) && a.params.length === bb.params.length &&
        a.params.every((p, i) => typeEq(p, bb.params[i]));
    }
  }
}

/** Human-readable type name for error messages. */
function typeName(t: WacType): string {
  switch (t.kind) {
    case "prim":     return t.name;
    case "struct":   return t.name;
    case "array":    return `${typeName(t.elem)}[]`;
    case "nullable": return `${typeName(t.inner)}?`;
    case "funcref":  return `fn(${t.params.map(typeName).join(", ")}) -> ${typeName(t.ret)}`;
  }
}

function isNumeric(t: WacType): boolean {
  return t.kind === "prim" &&
    (t.name === "i32" || t.name === "i64" || t.name === "u32" || t.name === "u64" ||
     t.name === "f32" || t.name === "f64");
}
function isInteger(t: WacType): boolean {
  return t.kind === "prim" &&
    (t.name === "i32" || t.name === "i64" || t.name === "u32" || t.name === "u64");
}
/** True for the unsigned integer types. Signedness selects the wasm opcode
 *  (div_u vs div_s, lt_u vs lt_s, shr_u vs shr_s); it never changes storage. */
function isUnsigned(t: WacType): boolean {
  return t.kind === "prim" && (t.name === "u32" || t.name === "u64");
}

/** Can this literal be read as `target`?
 *
 *  A decimal literal is a magnitude, so it fits when it is within the type's
 *  range. A hex literal is a bit pattern of a fixed width, so it fits any type
 *  at least that wide — `0xFFFFFFFF` is -1 as i32 and 4294967295 as u32, both
 *  the same bits, and widening zero-extends because a bit pattern has no sign
 *  to extend. A hex pattern wider than the target does not fit at all. */
function literalFits(
  lit: { hex: boolean; magnitude: bigint; width: 32 | 64 },
  target: string,
): boolean {
  const targetWidth = target === "i32" || target === "u32" ? 32 : 64;
  if (lit.hex) return lit.width <= targetWidth;
  const max: Record<string, bigint> = {
    i32: 2147483647n,
    u32: 4294967295n,
    i64: 9223372036854775807n,
    u64: 18446744073709551615n,
  };
  return lit.magnitude <= max[target];
}
function isFloat(t: WacType): boolean {
  return t.kind === "prim" && (t.name === "f32" || t.name === "f64");
}
function isRefType(t: WacType): boolean {
  return t.kind === "struct" || t.kind === "array" || t.kind === "nullable" ||
    (t.kind === "prim" && (t.name === "anyref" || t.name === "i31ref" || t.name === "string"));
}
/** Packed array element types. i8/u8 and i16/u16 share their storage — one
 *  byte or two — and differ only in which array.get the read uses. */
function isPackedElem(t: WacType): boolean {
  return t.kind === "prim" &&
    (t.name === "i8" || t.name === "i16" || t.name === "u8" || t.name === "u16");
}
function isVoid(t: WacType): boolean {
  return t.kind === "prim" && t.name === "void";
}

// Struct lookup tables. `structs` is index-ordered (StructEntry.typeIndex),
// `structMap` is the bare-name fallback used only when a type reference
// failed to resolve (its "unknown type" error is reported elsewhere).
type Tables = { structMap: Map<string, StructEntry>; structs: StructEntry[] };

/** Resolve a struct-kind WacType to its StructEntry — by resolved identity
 *  when the resolver annotated it, by bare name otherwise. */
function entryOfType(
  t: { name: string; resolvedTypeIndex?: number },
  tables: Tables,
): StructEntry | undefined {
  return t.resolvedTypeIndex !== undefined
    ? tables.structs[t.resolvedTypeIndex]
    : tables.structMap.get(t.name);
}

/** Is `from` assignable to `to`? Handles subtyping and null widening. */
function isAssignable(
  from: WacType, to: WacType,
  tables: Tables,
): boolean {
  if (typeEq(from, to)) return true;
  // null literal -> any T?
  if (from.kind === "prim" && from.name === "null") {
    return to.kind === "nullable";
  }
  // T -> T? (widen non-null to nullable)
  if (to.kind === "nullable" && from.kind !== "nullable") {
    return isAssignable(from, to.inner, tables);
  }
  // T? -> S? if T -> S
  if (from.kind === "nullable" && to.kind === "nullable") {
    return isAssignable(from.inner, to.inner, tables);
  }
  // Struct subtype (Rect -> Shape)
  if (from.kind === "struct" && to.kind === "struct") {
    const fe = entryOfType(from, tables);
    const te = entryOfType(to, tables);
    return fe !== undefined && te !== undefined && isSubtype(fe, te);
  }
  // Any ref -> anyref
  if (to.kind === "prim" && to.name === "anyref" && isRefType(from)) return true;
  return false;
}

/** Is `sub` a subtype (directly or transitively) of `ancestor`? */
function isSubtype(sub: StructEntry, ancestor: StructEntry): boolean {
  for (let e: StructEntry | null = sub; e; e = e.parentEntry) {
    if (e.typeIndex === ancestor.typeIndex) return true;
  }
  return false;
}

/** Lookup a method by name, walking the inheritance chain. */
function lookupMethod(
  entry: StructEntry | undefined, methodName: string,
): FuncEntry | null {
  for (let e: StructEntry | null = entry ?? null; e; e = e.parentEntry) {
    const m = e.methods.get(methodName);
    if (m) return m;
  }
  return null;
}

/** Collect all fields of a struct including inherited ones (parent first). */
function allFields(entry: StructEntry | undefined): FieldDecl[] {
  if (!entry) return [];
  const parentFields = entry.parentEntry ? allFields(entry.parentEntry) : [];
  return [...parentFields, ...entry.structDecl.fields];
}

/** Does a type have a default value (for T[N]() and T() construction)? */
/**
 * Can a value of this type be produced with no initialiser?
 *
 * `cyclesOnly` narrows the question to "does construction fail to terminate", which is
 * what the recursive-field check wants. The two questions were the same until enums
 * arrived: a struct-typed field lacked a default only ever by recursion, so one
 * predicate served both. An enum field lacks one for an unrelated reason, and
 * answering the recursion question with it reported `struct S { E e; }` as "creates a
 * non-null recursive reference" — which is neither true nor actionable, and would have
 * made a struct with an enum field illegal to declare at all.
 */
function hasDefault(
  t: WacType, tables: Tables,
  visiting = new Set<number>(),
  cyclesOnly = false,
): boolean {
  switch (t.kind) {
    case "prim":     return t.name !== "void" && t.name !== "null";
    case "nullable": return true;
    case "array":    return true;  // non-null array defaults to an empty (zero-length) array —
                                    // unlike T[N](), there's no size here, so the element type's
                                    // own defaultability is irrelevant.
    case "struct":   return structHasDefault(entryOfType(t, tables), tables, visiting, cyclesOnly);
    case "funcref":  return cyclesOnly;
  }
}

function structHasDefault(
  entry: StructEntry | undefined, tables: Tables,
  visiting: Set<number>,
  cyclesOnly = false,
): boolean {
  if (!entry) return false;
  // An enum has no default value, and neither does a variant. The base struct's only
  // field is the tag, which does have one, so the field walk below would say an enum
  // is defaultable — and then `E[n]()` produced n bases and `S()` a struct holding
  // one, values that satisfy no variant. Matching them trapped on `illegal cast`,
  // pointing at the arm rather than at the construction that made them.
  if (!cyclesOnly && entry.enumRole !== undefined) return false;
  if (visiting.has(entry.typeIndex)) return false;  // circular non-null ref has no default
  visiting.add(entry.typeIndex);
  const fields = allFields(entry);
  for (const f of fields) {
    if (!hasDefault(f.type, tables, visiting, cyclesOnly)) {
      visiting.delete(entry.typeIndex);
      return false;
    }
  }
  visiting.delete(entry.typeIndex);  // backtrack so sibling fields can reuse this struct
  return true;
}

// ── Checker context ───────────────────────────────────────────────────────────

// isConst: the binding itself (declared `const`) — no reassignment, and deep
// const applies through it. refConst: the binding is reassignable, but the
// object it currently references was reached through a const reference (e.g.
// `Node? cur = this.head;` inside a `const this` method) — writes and
// non-const method calls THROUGH it are errors, while reassigning the cursor
// itself stays legal. This is the pointer-to-const / const-pointer split.
type VarInfo = { type: WacType; isConst: boolean; refConst?: boolean };
type VarEnv  = Map<string, VarInfo>;

// Ctx structurally satisfies Tables (structMap + structs).
type Ctx = {
  file: string;
  structMap: Map<string, StructEntry>;
  structs: StructEntry[];
  fileScope: FileScope;
  /**
   * Every enum in the program, by its base struct's type index.
   *
   * `enumOfType` resolves through the file scope, which is right — naming an enum's
   * variants in patterns should require the enum to be in scope. But it cannot tell
   * "this is not an enum" from "this is an enum you did not import", and those want
   * very different diagnostics. This map answers the second question.
   */
  enumByTypeIndex: Map<number, EnumEntry>;
  errors: TypeCheckError[];
  // per-function:
  returnType: WacType;
  inLoop: number;
  // per-method:
  thisConst: boolean;
  /** While checking a var statement's initializer: `"i64 a = "` — lets nested
   *  diagnostics (e.g. redundant-cast hints) reconstruct the full statement. */
  varDeclPrefix?: string;
};

function errAt(ctx: Ctx, msg: string, line: number, col: number, span = 1, annotation?: string, hint?: string, contextStart?: number): void {
  ctx.errors.push({ message: msg, file: ctx.file, line, col, span, annotation, hint, contextStart });
}

function warnAt(ctx: Ctx, msg: string, line: number, col: number, span = 1, annotation?: string, hint?: string): void {
  ctx.errors.push({ message: msg, file: ctx.file, line, col, span, annotation, hint, severity: "warning" });
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function wacTypeCheck(
  result: ResolveResult,
  programs: Map<string, Program>,
): TypeCheckError[] {
  const allErrors: TypeCheckError[] = [];

  // Build struct name -> StructEntry for lookups
  const structMap = new Map<string, StructEntry>();
  for (const s of result.structs) structMap.set(s.name, s);
  // Also register imported aliases so `Point2d` (alias for `Point`) resolves correctly.
  // Use the entry directly (by typeIndex reference) to avoid same-name struct collisions.
  for (const scope of result.fileScopes.values()) {
    for (const [alias, entry] of scope) {
      if (entry.kind === "struct" && !structMap.has(alias)) {
        structMap.set(alias, entry.entry);  // entry.entry has the right typeIndex
      }
    }
  }

  const enumByTypeIndex = new Map<number, EnumEntry>();
  for (const e of result.enums) enumByTypeIndex.set(e.base.typeIndex, e);

  // Per-file structural checks (packed types, override, recursive default)
  for (const [filePath, fileScope] of result.fileScopes) {
    const prog = programs.get(filePath);
    if (!prog) continue;
    const ctx: Ctx = {
      file: filePath, structMap, structs: result.structs, fileScope, errors: [],
      enumByTypeIndex, returnType: T_VOID, inLoop: 0, thisConst: false,
    };
    for (const item of prog.items) {
      if (item.tag === "struct") checkStructShape(item, ctx);
      else if (item.tag === "func") checkFuncSig(item.params, item.returnType, item.line, item.col, ctx);
      else if (item.tag === "const") checkConstDecl(item, ctx);
    }
    allErrors.push(...ctx.errors);
  }

  // Type-check each function / method body
  for (const funcEntry of result.funcs) {
    const prog     = programs.get(funcEntry.filePath);
    const scope    = result.fileScopes.get(funcEntry.filePath);
    if (!prog || !scope) continue;

    const ctx: Ctx = {
      file: funcEntry.filePath, structMap, structs: result.structs, fileScope: scope, errors: [],
      enumByTypeIndex, returnType: T_VOID, inLoop: 0, thisConst: false,
    };
    const env: VarEnv = new Map();

    if (funcEntry.origin.kind === "func") {
      const decl = funcEntry.origin.decl;
      ctx.returnType = decl.returnType;
      for (const p of decl.params) env.set(p.name, { type: p.type, isConst: p.isConst });
      const returns = checkBlock(decl.body, env, ctx);
      if (!returns && !isVoid(decl.returnType)) {
        errAt(ctx, `not all code paths return a value in '${decl.name}'`,
          decl.line, decl.col);
      }
    } else {
      const decl       = funcEntry.origin.decl;
      const structName = funcEntry.origin.structName;
      const structIdx  = funcEntry.origin.structTypeIndex;
      ctx.returnType = decl.returnType;
      ctx.thisConst  = decl.thisConst;
      if (decl.hasThis) {
        env.set("this", { type: structType(structName, structIdx), isConst: decl.thisConst });
      }
      for (const p of decl.params) env.set(p.name, { type: p.type, isConst: p.isConst });
      const returns = checkBlock(decl.body, env, ctx);
      if (!returns && !isVoid(decl.returnType)) {
        errAt(ctx, `not all code paths return a value in method '${structName}.${decl.name}'`,
          decl.line, decl.col);
      }
      // Override correctness
      checkOverride(decl, result.structs[structIdx], ctx);
    }

    allErrors.push(...ctx.errors);
  }

  return allErrors;
}

// ── Structural checks ─────────────────────────────────────────────────────────

/** Check struct field types and packed-type restrictions. */
function checkStructShape(s: StructDecl, ctx: Ctx): void {
  for (const f of s.fields) {
    if (isPackedElem(f.type)) {
      errAt(ctx, `packed type '${typeName(f.type)}' cannot be used as a struct field`,
        f.line, f.col);
    }
    if (isVoid(f.type)) {
      errAt(ctx, `field type cannot be 'void'`, f.line, f.col);
    }
  }
  // Method param / return type restrictions
  for (const m of s.methods) {
    checkFuncSig(m.params, m.returnType, m.line, m.col, ctx);
  }
  // Recursive non-null field check (no default)
  checkNoRecursiveNonNull(s, ctx);
}

function checkFuncSig(
  params: { name?: string; type: WacType; line: number; col: number }[],
  returnType: WacType,
  line: number, col: number,
  ctx: Ctx,
): void {
  // Two parameters of the same name were accepted, and the second silently won: for
  // `i32 f(i32 a, i32 a)`, `f(1, 2)` returned 2 and the first parameter was
  // unreachable. Nothing warned. A duplicate *field* was already an error, and a
  // duplicate local shadowing a parameter is well defined; only this was neither.
  const seen = new Set<string>();
  for (const p of params) {
    if (p.name === undefined) continue;
    if (seen.has(p.name)) {
      errAt(ctx, `duplicate parameter '${p.name}'`, p.line, p.col, p.name.length,
        undefined, `each parameter needs its own name`);
    }
    seen.add(p.name);
  }
  for (const p of params) {
    if (isPackedElem(p.type)) {
      errAt(ctx, `packed type '${typeName(p.type)}' cannot be a parameter type`, p.line, p.col);
    }
    if (isVoid(p.type)) {
      errAt(ctx, `parameter type cannot be 'void'`, p.line, p.col);
    }
  }
  if (isPackedElem(returnType)) {
    errAt(ctx, `packed type '${typeName(returnType)}' cannot be a return type`, line, col);
  }
}

/** Report an error for struct fields that form a recursive non-null chain. */
function checkNoRecursiveNonNull(s: StructDecl, ctx: Ctx): void {
  const selfScope = ctx.fileScope.get(s.name);
  const selfEntry = selfScope?.kind === "struct" ? selfScope.entry : undefined;
  if (!selfEntry) return;
  const fields = allFields(selfEntry);
  for (const f of fields) {
    if (f.type.kind === "struct") {
      const visited = new Set<number>([selfEntry.typeIndex]);
      if (!structHasDefault(entryOfType(f.type, ctx), ctx, visited, true)) {
        errAt(ctx,
          `field '${f.name}' creates a non-null recursive reference — struct has no default value`,
          f.line, f.col);
      }
    }
  }
}

/** Check override keyword correctness for a method. */
function checkOverride(
  decl: { isOverride: boolean; name: string; hasThis: boolean; line: number; col: number },
  entry: StructEntry | undefined,
  ctx: Ctx,
): void {
  if (!entry) return;
  const parentHasMethod = entry.parentEntry
    ? lookupMethod(entry.parentEntry, decl.name) !== null
    : false;

  if (decl.isOverride && !parentHasMethod) {
    errAt(ctx, `'override' on '${decl.name}' but no parent method to override`,
      decl.line, decl.col);
  }
  if (!decl.isOverride && parentHasMethod && decl.hasThis) {
    // Instance method hiding without override
    errAt(ctx,
      `method '${decl.name}' hides parent method — use 'override'`,
      decl.line, decl.col);
  }
}

// ── Block / statement checking ────────────────────────────────────────────────

/** Check a block. Returns true if all paths in the block terminate (return/trap). */
function checkBlock(block: Block, env: VarEnv, ctx: Ctx): boolean {
  let terminated = false;
  const localEnv: VarEnv = new Map(env);
  for (const stmt of block.stmts) {
    if (terminated) break;  // unreachable statements — skip silently
    terminated = checkStmt(stmt, localEnv, ctx);
  }
  return terminated;
}

/** Is this condition the literal `true`? */
function isAlwaysTrue(cond: Expr | null): boolean {
  return cond === null || (cond.kind === "bool" && cond.value);
}

/**
 * Does this block contain a `break` that would exit the loop it is the body of?
 *
 * A `break` inside a nested loop or switch binds to that construct instead, so
 * it cannot end the outer loop and does not count here.
 */
function hasLoopBreak(block: Block): boolean {
  for (const stmt of block.stmts) {
    if (stmtHasLoopBreak(stmt)) return true;
  }
  return false;
}

function stmtHasLoopBreak(stmt: Stmt): boolean {
  switch (stmt.kind) {
    case "break": return true;
    case "block": return hasLoopBreak(stmt.block);
    case "if": {
      if (hasLoopBreak(stmt.then)) return true;
      if (stmt.els === null) return false;
      if (stmt.els.kind === "else-if") return stmtHasLoopBreak(stmt.els.stmt);
      return hasLoopBreak(stmt.els.block);
    }
    // Unlike `switch`, a `match` arm is not a break target — arms have no
    // fallthrough, so there is nothing for a `break` to mean locally and the
    // emitter lets it bind to the enclosing loop. Missing this let
    // `while (true) { match (e) { case A: break; ... } }` pass the return check as
    // an infinite loop, and then trap on the `unreachable` the emitter appends.
    case "match": return stmt.arms.some(a => a.body.some(stmtHasLoopBreak));
    // A break in any of these binds to the inner construct, not to us.
    case "while": case "for": case "dowhile": case "switch": return false;
    default: return false;
  }
}

/**
 * Does control ever get past this loop?
 *
 * A loop with a condition that is literally true (or absent, in `for (;;)`) and
 * no `break` reaching it never completes, so whatever follows is unreachable and
 * the enclosing function needs no return after it. The emitter already appends
 * an `unreachable` before a non-void function's `end`, so the wasm stays valid.
 */
function isInfiniteLoop(cond: Expr | null, body: Block): boolean {
  return isAlwaysTrue(cond) && !hasLoopBreak(body);
}

/**
 * Check a statement. Returns true if this statement always terminates
 * (returns or traps on every code path).
 */
function checkStmt(stmt: Stmt, env: VarEnv, ctx: Ctx): boolean {
  switch (stmt.kind) {

    case "var": {
      if (isPackedElem(stmt.type)) {
        errAt(ctx, `packed type '${typeName(stmt.type)}' cannot be a variable type`,
          stmt.line, stmt.col);
      }
      if (isVoid(stmt.type)) {
        errAt(ctx, `variable type cannot be 'void'`, stmt.line, stmt.col);
      }
      ctx.varDeclPrefix = `${typeName(stmt.type)} ${stmt.name} = `;
      const initType = inferExpr(stmt.init, env, ctx, stmt.type);
      ctx.varDeclPrefix = undefined;
      if (initType && initType.kind === "nullable" && stmt.type.kind !== "nullable" &&
          (stmt.type.kind === "struct" || stmt.type.kind === "array")) {
        const initName = stmt.init.kind === "ident" ? stmt.init.name : "expr";
        errAt(ctx, `cannot assign nullable to non-null`, stmt.init.line, stmt.init.col, 1,
          `expected ${typeName(stmt.type)}, found ${typeName(initType)}`,
          `unwrap with \`!\`: ${typeName(stmt.type)} ${stmt.name} = ${initName}!;`);
      } else if (initType) {
        const initSpan = (stmt.init.kind === "float" || stmt.init.kind === "int")
          ? stmt.init.value.length : 1;
        const initHint = (isNumeric(stmt.type) && isNumeric(initType) && !typeEq(stmt.type, initType))
          ? `use \`as!\` for checked conversion or \`as~\` for truncation` : undefined;
        checkAssign(stmt.type, initType, stmt.init.line, stmt.init.col, ctx,
          initSpan, undefined, initHint);
      }
      // Deep const: binding a const-rooted reference to a plain variable is
      // fine (read-only cursors need reassignment), but the binding carries
      // the object's constness — writes through it stay forbidden.
      const refConst = isMutableRefType(stmt.type) && exprIsConst(stmt.init, env, ctx);
      env.set(stmt.name, { type: stmt.type, isConst: stmt.isConst, refConst });
      return false;
    }

    case "assign": {
      const lType = checkLval(stmt.lval, env, ctx, /* writing */ true);
      const rType = inferExpr(stmt.rhs, env, ctx, lType);
      if (!lType || !rType) return false;
      if (stmt.op === "=") {
        checkAssign(lType, rType, stmt.rhs.line, stmt.rhs.col, ctx);
        // Deep const: a const-rooted reference may only flow into a slot that
        // keeps it const — a ref-const local (cursor reassignment) is fine,
        // but a plain local, field, or array element would launder it.
        if (isMutableRefType(lType) && exprIsConst(stmt.rhs, env, ctx)) {
          const targetKeepsConst = stmt.lval.kind === "lv-ident" &&
            (env.get(stmt.lval.name)?.refConst ?? false);
          if (!targetKeepsConst) {
            errAt(ctx, `cannot assign const reference to a non-const target — const is deep`,
              stmt.rhs.line, stmt.rhs.col);
          }
        }
      } else {
        // Compound assignment: extract base op, check types, result same as lType
        const baseOp = stmt.op.slice(0, -1);  // "+=" -> "+"
        const resultType = checkBinaryOp(baseOp, lType, rType, stmt.line, stmt.col, ctx);
        if (resultType && !typeEq(resultType, lType)) {
          errAt(ctx, `type mismatch in '${stmt.op}': expected ${typeName(lType)}, got ${typeName(resultType)}`,
            stmt.line, stmt.col);
        }
      }
      return false;
    }

    case "incr": {
      const lType = checkLval(stmt.lval, env, ctx, /* writing */ true);
      if (lType && !isInteger(lType)) {
        errAt(ctx, `'${stmt.op}' requires i32 or i64, got ${typeName(lType)}`,
          stmt.line, stmt.col);
      }
      return false;
    }

    case "if": {
      const cType = inferExpr(stmt.cond, env, ctx);
      if (cType && !typeEq(cType, T_BOOL)) {
        const condName = stmt.cond.kind === "ident" ? stmt.cond.name : "expr";
        const condSpan = stmt.cond.kind === "ident" ? stmt.cond.name.length : 1;
        errAt(ctx, `condition must be bool`,
          stmt.cond.line, stmt.cond.col, condSpan,
          `expected bool, found ${typeName(cType)}`,
          `use a comparison: if (${condName} != 0) { ... }`);
      }
      const thenRet = checkBlock(stmt.then, new Map(env), ctx);
      const elseRet = checkElse(stmt.els, env, ctx);
      // All paths return only if both then and else terminate
      return thenRet && elseRet !== null && elseRet;
    }

    case "while": {
      const cType = inferExpr(stmt.cond, env, ctx);
      if (cType && !typeEq(cType, T_BOOL)) {
        const condName = stmt.cond.kind === "ident" ? stmt.cond.name : "expr";
        const condSpan = stmt.cond.kind === "ident" ? stmt.cond.name.length : 1;
        errAt(ctx, `condition must be bool`,
          stmt.cond.line, stmt.cond.col, condSpan,
          `expected bool, found ${typeName(cType)}`,
          `use a comparison: if (${condName} != 0) { ... }`);
      }
      ctx.inLoop++;
      checkBlock(stmt.body, new Map(env), ctx);
      ctx.inLoop--;
      // `while (true)` with no break never finishes, so control never reaches
      // what follows. Otherwise the loop may not execute at all.
      return isInfiniteLoop(stmt.cond, stmt.body);
    }

    case "for": {
      const loopEnv: VarEnv = new Map(env);
      if (stmt.init) checkStmt(stmt.init, loopEnv, ctx);
      if (stmt.cond) {
        const cType = inferExpr(stmt.cond, loopEnv, ctx);
        if (cType && !typeEq(cType, T_BOOL)) {
          const condName = stmt.cond.kind === "ident" ? stmt.cond.name : "expr";
          const condSpan = stmt.cond.kind === "ident" ? stmt.cond.name.length : 1;
          errAt(ctx, `condition must be bool`,
            stmt.cond.line, stmt.cond.col, condSpan,
            `expected bool, found ${typeName(cType)}`,
            `use a comparison: if (${condName} != 0) { ... }`);
        }
      }
      ctx.inLoop++;
      checkBlock(stmt.body, new Map(loopEnv), ctx);
      if (stmt.update) checkStmt(stmt.update, loopEnv, ctx);
      ctx.inLoop--;
      // `for (;;)` and `for (i = 0; true; i++)` never finish without a break.
      return isInfiniteLoop(stmt.cond, stmt.body);
    }

    case "dowhile": {
      ctx.inLoop++;
      checkBlock(stmt.body, new Map(env), ctx);
      ctx.inLoop--;
      const cType = inferExpr(stmt.cond, env, ctx);
      if (cType && !typeEq(cType, T_BOOL)) {
        const condName = stmt.cond.kind === "ident" ? stmt.cond.name : "expr";
        const condSpan = stmt.cond.kind === "ident" ? stmt.cond.name.length : 1;
        errAt(ctx, `condition must be bool`,
          stmt.cond.line, stmt.cond.col, condSpan,
          `expected bool, found ${typeName(cType)}`,
          `use a comparison: if (${condName} != 0) { ... }`);
      }
      // `do { ... } while (true)` is infinite for the same reason.
      return isInfiniteLoop(stmt.cond, stmt.body);
    }

    case "match": {
      const subjType = inferExpr(stmt.subject, env, ctx);
      if (!subjType) return false;

      // A nullable subject would need a null case, which is deferred; `s!` or an
      // `is null` check first is the answer for now.
      if (subjType.kind === "nullable") {
        errAt(ctx, `match requires a non-null value, got ${typeName(subjType)}`,
          stmt.subject.line, stmt.subject.col,
          exprText(stmt.subject).length, undefined,
          `unwrap it first: match (${exprText(stmt.subject)}!)`);
        return false;
      }

      const enumEntry = enumOfType(subjType, ctx);
      if (!enumEntry) {
        // The subject may well be an enum that this file never imported — in which
        // case "match requires an enum value, got TyKind" is true, unhelpful, and
        // points at the wrong thing. Say which it is.
        const unimported = subjType.kind === "struct" &&
          subjType.resolvedTypeIndex !== undefined
            ? ctx.enumByTypeIndex.get(subjType.resolvedTypeIndex)
            : undefined;
        if (unimported) {
          errAt(ctx,
            `'${typeName(subjType)}' is an enum, but it is not in scope in this file`,
            stmt.subject.line, stmt.subject.col, exprText(stmt.subject).length,
            undefined,
            `import it: import { ${unimported.name} } from "...";`);
        } else {
          errAt(ctx, `match requires an enum value, got ${typeName(subjType)}`,
            stmt.subject.line, stmt.subject.col);
        }
        return false;
      }

      // Narrowing is a shadowing binding, so it needs a name to shadow. A subject
      // that is not a plain variable still matches; its arms just narrow nothing.
      stmt.enumBaseTypeIndex = enumEntry.base.typeIndex;

      const subjectName = stmt.subject.kind === "ident" ? stmt.subject.name : null;

      const covered = new Set<string>();
      let elseArm: MatchArm | null = null;
      let allReturn = true;

      for (const arm of stmt.arms) {
        const armEnv: VarEnv = new Map(env);

        if (arm.variant === null) {
          if (elseArm) {
            errAt(ctx, `duplicate else arm`, arm.line, arm.col);
          }
          elseArm = arm;
        } else {
          const variant = enumEntry.variants.find(v => v.name === arm.variant);
          if (!variant) {
            errAt(ctx, `'${arm.variant}' is not a variant of '${enumEntry.name}'`,
              arm.line, arm.col, arm.variant.length);
            continue;
          }
          if (covered.has(arm.variant)) {
            errAt(ctx, `duplicate case for '${arm.variant}'`, arm.line, arm.col,
              arm.variant.length);
          }
          covered.add(arm.variant);
          arm.tag = variant.tag;
          arm.variantTypeIndex = variant.entry.typeIndex;
          arm.bindingTypes = variant.fields.map(f => f.type);

          // Omitting the parentheses ignores every payload; naming any binding means
          // naming all of them, so a miscount is a mistake rather than a shorthand.
          if (arm.bindings.length > 0 && arm.bindings.length !== variant.fields.length) {
            errAt(ctx,
              `case '${arm.variant}' binds ${arm.bindings.length} name(s) but the variant has ${variant.fields.length}`,
              arm.line, arm.col, arm.variant.length);
          }

          // The subject narrows to the variant type, as a const shadowing binding.
          if (subjectName !== null) {
            armEnv.set(subjectName, {
              type: { kind: "struct", name: variant.name,
                      resolvedTypeIndex: variant.entry.typeIndex,
                      line: arm.line, col: arm.col },
              isConst: true,
            });
          }

          const bound = new Set<string>();
          for (let i = 0; i < arm.bindings.length && i < variant.fields.length; i++) {
            const name = arm.bindings[i];
            if (name === "_") continue;   // a deliberate discard, and may repeat
            if (bound.has(name)) {
              errAt(ctx, `duplicate binding '${name}' in case '${arm.variant}'`,
                arm.line, arm.col, name.length);
              continue;
            }
            if (name === subjectName) {
              errAt(ctx,
                `binding '${name}' collides with the matched subject`,
                arm.line, arm.col, name.length);
              continue;
            }
            bound.add(name);
            armEnv.set(name, { type: variant.fields[i].type, isConst: true });
          }
        }

        let terminated = false;
        for (const st of arm.body) {
          if (terminated) break;
          terminated = checkStmt(st, armEnv, ctx);
        }
        if (!terminated) allReturn = false;
      }

      const exhaustive = covered.size === enumEntry.variants.length;
      if (elseArm === null && !exhaustive) {
        const missing = enumEntry.variants
          .filter(v => !covered.has(v.name)).map(v => `'${v.name}'`);
        errAt(ctx, `match does not cover ${missing.join(", ")}`, stmt.line, stmt.col,
          5, undefined,
          missing.length === 1
            ? `add a case for it, or an else arm`
            : `add cases for them, or an else arm`);
      }
      // A covering match plus an else arm is a mistake, not dead code: either a
      // variant was removed and the else is now stale, or the arms are wrong.
      if (elseArm !== null && exhaustive) {
        errAt(ctx, `else arm is unreachable — all variants are covered`,
          elseArm.line, elseArm.col, 4);
      }

      // A match only guarantees a return if control cannot fall past it, which needs
      // every arm to terminate *and* every value to reach an arm.
      return allReturn && (elseArm !== null || exhaustive);
    }

    case "switch": {
      // br_table dispatches on a 32-bit value. Signedness plays no part in an
      // equality match, so u32 is as good as i32; the 64-bit types are not.
      const eType = inferExpr(stmt.expr, env, ctx);
      const scrutinee = eType && eType.kind === "prim" && eType.name === "u32" ? eType : T_I32;
      if (eType && !typeEq(eType, scrutinee)) {
        errAt(ctx, `switch expression must be i32 or u32, got ${typeName(eType)}`,
          stmt.expr.line, stmt.expr.col);
      }
      let hasDefault = false;
      let allReturn  = true;
      ctx.inLoop++;  // break is valid inside switch
      for (const c of stmt.cases) {
        if (c.value === "default") hasDefault = true;
        else {
          // Case values follow the scrutinee, so `case 1:` works for both.
          const vType = inferExpr(c.value, env, ctx, scrutinee);
          if (vType && !typeEq(vType, scrutinee)) {
            errAt(ctx, `case value must be ${typeName(scrutinee)}, got ${typeName(vType)}`,
              c.line, c.col);
          }
        }
        // Check if case body terminates
        const caseEnv: VarEnv = new Map(env);
        let caseTerminated = false;
        for (const s of c.body) {
          if (caseTerminated) break;
          caseTerminated = checkStmt(s, caseEnv, ctx);
        }
        if (!caseTerminated) allReturn = false;
      }
      ctx.inLoop--;
      return allReturn && hasDefault;
    }

    case "return": {
      if (stmt.value) {
        const vType = inferExpr(stmt.value, env, ctx, ctx.returnType);
        if (vType) {
          if (isVoid(ctx.returnType)) {
            errAt(ctx, `void function cannot return a value`, stmt.line, stmt.col);
          } else if (!isAssignable(vType, ctx.returnType, ctx)) {
            const valText = exprText(stmt.value);
            const retHint = typeEq(vType, T_BOOL) && typeEq(ctx.returnType, T_I32) ?
              `use \`(${valText}) as i32\` to convert` : undefined;
            errAt(ctx, `return: expected ${typeName(ctx.returnType)}, found ${typeName(vType)}`,
              stmt.value.line, stmt.value.col, valText.length,
              `expected ${typeName(ctx.returnType)}, found ${typeName(vType)}`,
              retHint);
          }
        }
      } else {
        if (!isVoid(ctx.returnType)) {
          errAt(ctx, `missing return value: expected ${typeName(ctx.returnType)}`,
            stmt.line, stmt.col);
        }
      }
      return true;
    }

    case "break": {
      if (ctx.inLoop === 0) {
        errAt(ctx, `'break' outside loop or switch`, stmt.line, stmt.col);
      }
      // Jumps out, but does not return a value — per checkStmt's own contract
      // ("returns true if ... returns or traps on every code path"), break
      // must not count as a return, or a switch case ending in break would
      // wrongly satisfy "all paths return".
      return false;
    }

    case "continue": {
      if (ctx.inLoop === 0) {
        errAt(ctx, `'continue' outside loop`, stmt.line, stmt.col);
      }
      return false;
    }

    case "trap": {
      return true;
    }

    case "block": {
      // Bare block — check with a child scope (new Map(env)) so vars don't leak
      return checkBlock(stmt.block, new Map(env), ctx);
    }

    case "expr": {
      inferExpr(stmt.expr, env, ctx);
      return false;
    }
  }
}

/**
 * Check an else branch. Returns:
 * - null if there is no else (one path doesn't terminate)
 * - false if else branch does not terminate
 * - true if else branch always terminates
 */
function checkElse(branch: ElseBranch, env: VarEnv, ctx: Ctx): boolean | null {
  if (!branch) return null;
  if (branch.kind === "else-block") return checkBlock(branch.block, new Map(env), ctx);
  // else-if: it's itself a statement
  return checkStmt(branch.stmt, env, ctx);
}

// ── Lvalue checking ───────────────────────────────────────────────────────────

/**
 * Check an lvalue and return its type. If `writing`, also validates
 * that the target is not const.
 */
function checkLval(
  lval: Lvalue, env: VarEnv, ctx: Ctx, writing: boolean,
): WacType | null {
  switch (lval.kind) {
    case "lv-ident": {
      const info = env.get(lval.name);
      if (!info) {
        const scoped = ctx.fileScope.get(lval.name);
        if (scoped?.kind === "const") {
          errAt(ctx, `cannot assign to constant '${lval.name}'`, lval.line, lval.col,
            lval.name.length, `declared at module level`,
            `module-level constants are substituted at each use and have no storage`);
          return null;
        }
        errAt(ctx, `undefined variable '${lval.name}'`, lval.line, lval.col);
        return null;
      }
      if (writing && info.isConst) {
        errAt(ctx, `cannot assign to const variable '${lval.name}'`, lval.line, lval.col);
      }
      return info.type;
    }

    case "lv-field": {
      const baseType = checkLval(lval.base, env, ctx, /* writing */ false);
      if (!baseType) return null;
      // Unwrap nullable for field access via assignment (should use ! first)
      if (baseType.kind === "nullable") {
        errAt(ctx, `cannot access field on nullable type '${typeName(baseType)}'`, lval.line, lval.col);
        return null;
      }
      if (baseType.kind !== "struct") {
        errAt(ctx, `type '${typeName(baseType)}' has no fields`, lval.line, lval.col);
        return null;
      }
      const baseEntry = entryOfType(baseType, ctx);
      const fields = allFields(baseEntry);
      const field = fields.find(f => f.name === lval.field);
      if (!field) {
        errAt(ctx, `struct '${baseType.name}' has no field '${lval.field}'`, lval.line, lval.col);
        return null;
      }
      if (writing) {
        const root = lvalRoot(lval);
        const span = lvalText(lval).length;
        // Check field const
        const structIsConst = baseEntry?.structDecl.isConst ?? false;
        if (structIsConst || field.isConst) {
          errAt(ctx, `cannot write to const field '${lval.field}'`, root.line, root.col, span);
        }
        // Check base is not const (deep const)
        if (lvalIsConst(lval.base, env, ctx)) {
          errAt(ctx, `cannot write through const reference`, root.line, root.col, span,
            `${lvalText(lval.base)} is const`);
        }
      }
      return field.type;
    }

    case "lv-index": {
      const baseType = checkLval(lval.base, env, ctx, /* writing */ false);
      if (!baseType) return null;
      // Strings are immutable — indexing for assignment is not allowed
      if (typeEq(baseType, T_STR)) {
        errAt(ctx, `strings are immutable — cannot assign to string index`, lval.line, lval.col);
        return null;
      }
      if (baseType.kind !== "array") {
        errAt(ctx, `type '${typeName(baseType)}' is not an array`, lval.line, lval.col);
        return null;
      }
      const idxType = inferExpr(lval.idx, env, ctx);
      if (idxType && !typeEq(idxType, T_I32)) {
        errAt(ctx, `array index must be i32, got ${typeName(idxType)}`, lval.line, lval.col);
      }
      // Deep const: element writes through a const reference are errors
      if (writing && lvalIsConst(lval.base, env, ctx)) {
        const root = lvalRoot(lval);
        errAt(ctx, `cannot write through const reference`, root.line, root.col,
          lvalText(lval).length, `${lvalText(lval.base)} is const`);
      }
      // Packed arrays: element type for assignment is i32 (write truncates)
      if (isPackedElem(baseType.elem)) return T_I32;
      return baseType.elem;
    }

    case "lv-unwrap": {
      const baseType = checkLval(lval.base, env, ctx, /* writing */ false);
      if (!baseType) return null;
      if (baseType.kind !== "nullable") {
        errAt(ctx, `'!' unwrap requires nullable type, got ${typeName(baseType)}`, lval.line, lval.col);
        return null;
      }
      return baseType.inner;
    }
  }
}

/** Check whether an lvalue is accessed through a const chain. Used only for
 *  writes THROUGH the binding (field/index writes), so ref-const counts;
 *  direct reassignment of the binding itself checks isConst alone. */
function lvalIsConst(lval: Lvalue, env: VarEnv, ctx: Ctx): boolean {
  switch (lval.kind) {
    case "lv-ident": {
      const v = env.get(lval.name);
      if (v) return (v.isConst || v.refConst) ?? false;
      // A module-level constant array is one object shared by every use, so a
      // write through it would be visible everywhere. Const is deep here for
      // the same reason it is deep anywhere else.
      return ctx.fileScope.get(lval.name)?.kind === "const";
    }
    case "lv-field":  return lvalIsConst(lval.base, env, ctx);
    case "lv-index":  return lvalIsConst(lval.base, env, ctx);
    case "lv-unwrap": return lvalIsConst(lval.base, env, ctx);
  }
}

/** Position of the root identifier an lvalue chain is rooted at (e.g. `p` in `p.x`). */
function lvalRoot(lval: Lvalue): { line: number; col: number } {
  let cur: Lvalue = lval;
  while (cur.kind !== "lv-ident") cur = cur.base;
  return { line: cur.line, col: cur.col };
}

/** Reconstruct an lvalue chain's source text (e.g. `p.x`), for diagnostic span/annotation. */
function lvalText(lval: Lvalue): string {
  switch (lval.kind) {
    case "lv-ident":  return lval.name;
    case "lv-field":  return `${lvalText(lval.base)}.${lval.field}`;
    case "lv-index":  return `${lvalText(lval.base)}[...]`;
    case "lv-unwrap": return `${lvalText(lval.base)}!`;
  }
}

/** Reconstruct approximate source text for an expression (diagnostics only —
 *  spacing is normalized, parentheses are not reproduced). */
function exprText(e: Expr): string {
  switch (e.kind) {
    case "int": case "float": return e.value;
    case "bool":    return String(e.value);
    case "string":  return `"${e.value}"`;
    case "null":    return "null";
    case "ident":   return e.name;
    case "unary":   return `${e.op}${exprText(e.expr)}`;
    case "binary":  return `${exprText(e.left)} ${e.op} ${exprText(e.right)}`;
    case "cast":    return `${exprText(e.expr)} ${e.op} ${typeName(e.type)}`;
    case "ternary": return `${exprText(e.cond)} ? ${exprText(e.then)} : ${exprText(e.else_)}`;
    case "field":   return `${exprText(e.expr)}.${e.name}`;
    case "index":   return `${exprText(e.expr)}[${exprText(e.idx)}]`;
    case "unwrap":  return `${exprText(e.expr)}!`;
    case "call":    return `${exprText(e.callee)}(${e.args.map(exprText).join(", ")})`;
    case "is":
      return `${exprText(e.expr)} is ${e.not ? "not " : ""}${
        e.rhs === "null" ? "null" : isWacType(e.rhs) ? typeName(e.rhs) : exprText(e.rhs)}`;
    case "construct": return `${typeName(e.ctype)}(${e.args.map(exprText).join(", ")})`;
    case "arrNew":    return `${typeName(e.elem)}[](...)`;
    case "incr-expr":
      return e.prefix ? `${e.op}${lvalText(e.lval)}` : `${lvalText(e.lval)}${e.op}`;
  }
}

/**
 * A module-level constant: its initialiser must type-check against the declared
 * type and be evaluable at compile time.
 *
 * The constant-expression rule is deliberately narrow — literals, the operators
 * over them, casts, and other constants. No calls and no construction, so there
 * is nothing to order and nothing to allocate, which is what lets the emitter
 * substitute the initialiser at each use instead of building a global.
 */
function checkConstDecl(decl: ConstDecl, ctx: Ctx): void {
  if (isVoid(decl.type)) {
    errAt(ctx, `a constant cannot have type void`, decl.line, decl.col);
    return;
  }
  const why = notCompileTimeConstant(decl.init, ctx, new Set([decl.name]));
  if (why !== null) {
    errAt(ctx, `constant '${decl.name}' needs a compile-time value`,
      decl.init.line, decl.init.col, 0, why,
      `only literals, operators over them, casts and other constants are allowed`);
    return;
  }
  const env: VarEnv = new Map();
  const t = inferExpr(decl.init, env, ctx, decl.type);
  if (t) checkAssign(decl.type, t, decl.init.line, decl.init.col, ctx);
}

/**
 * Why `expr` cannot be evaluated at compile time, or null if it can.
 *
 * `seen` carries the constants already being evaluated, so a cycle is reported
 * as a cycle rather than recursing until the stack gives out.
 */
function notCompileTimeConstant(expr: Expr, ctx: Ctx, seen: Set<string>): string | null {
  switch (expr.kind) {
    case "int": case "float": case "bool": case "string":
      return null;
    case "unary":
      return notCompileTimeConstant(expr.expr, ctx, seen);
    case "cast":
      return notCompileTimeConstant(expr.expr, ctx, seen);
    case "binary":
      return notCompileTimeConstant(expr.left, ctx, seen)
          ?? notCompileTimeConstant(expr.right, ctx, seen);
    case "ternary":
      return notCompileTimeConstant(expr.cond, ctx, seen)
          ?? notCompileTimeConstant(expr.then, ctx, seen)
          ?? notCompileTimeConstant(expr.else_, ctx, seen);
    case "arrNew": {
      // The literal form only. `T[n]()` would need the array built at run time,
      // and its elements are not written down to be evaluated.
      if (expr.size !== null) {
        return `a sized array is built at run time — write the elements out`;
      }
      for (const el of expr.fixed) {
        const why = notCompileTimeConstant(el, ctx, seen);
        if (why !== null) return why;
      }
      return null;
    }
    case "ident": {
      const e = ctx.fileScope.get(expr.name);
      if (e?.kind !== "const") return `'${expr.name}' is not a constant`;
      if (seen.has(expr.name)) return `'${expr.name}' is defined in terms of itself`;
      const next = new Set(seen);
      next.add(expr.name);
      return notCompileTimeConstant(e.decl.init, ctx, next);
    }
    default:
      return `this is computed at run time`;
  }
}

// ── Expression inference ──────────────────────────────────────────────────────

/**
 * Infer the type of an expression. Returns null and pushes an error if the
 * expression is ill-typed. Avoids cascading errors — callers should guard on null.
 */
/**
 * Does this float literal have a finite f32 reading?
 *
 * Rounding to nearest is expected and is what every decimal float literal does. Only
 * overflow to infinity is refused, since that is a value the literal plainly does not
 * denote. A literal that is already infinite or NaN cannot be written in wac, so the
 * only way to reach the false branch is a magnitude past f32's maximum.
 */
function floatLiteralFitsF32(text: string): boolean {
  const v = parseFloat(text);
  if (!Number.isFinite(v)) return false;
  return Number.isFinite(Math.fround(v));
}

function inferExpr(expr: Expr, env: VarEnv, ctx: Ctx, expected?: WacType | null): WacType | null {
  switch (expr.kind) {

    case "int": {
      const lit = wacIntLit(expr.value);
      if (!lit.ok) {
        const msg = lit.reason === "range"
          ? `integer literal out of range`
          : `invalid integer literal '${expr.value}'`;
        errAt(ctx, msg, expr.line, expr.col);
        return null;
      }
      // Contextual typing: an integer literal takes the integer type expected
      // of it whenever the value has a reading there. This is what makes
      // `u32 x = 5` and `i64 n = 5` work — without it every literal in
      // unsigned code would need a cast. Recorded on the node so the emitter
      // uses the same answer instead of re-deriving it.
      if (expected && expected.kind === "prim" && isInteger(expected)) {
        if (literalFits(lit, expected.name)) {
          expr.resolved = expected;
          return expected;
        }
        // Falls through to the intrinsic width, which then fails the normal
        // assignability check with the ordinary "expected X, got Y" message.
      }
      if (!lit.fitsI64) {
        errAt(ctx, `integer literal out of range`, expr.line, expr.col,
          expr.value.length, `${expr.value} exceeds i64 — only u64 can hold it`);
        return null;
      }
      return lit.width === 32 ? T_I32 : T_I64;
    }

    case "float": {
      // Contextual typing, by the same rule types.md already states for integers: a
      // literal takes the type expected of it when the value has a reading there.
      // Without this, no float literal could ever be an f32 — `f32 x = 1.5;` was a
      // type error, and every f32 in the language needed `as~ f32`, which is the
      // *truncating* cast and so read as though the loss were the point. The spec's own
      // f32 example omitted the cast and did not compile.
      //
      // "Has a reading there" means within range. Decimal notation loses precision for
      // f64 as readily as for f32 — `0.1` is inexact in both — so requiring exactness
      // would reject `f32 pi = 3.14159;` and make the rule useless. Overflow to
      // infinity is a different matter and is refused.
      if (expected && expected.kind === "prim" && expected.name === "f32") {
        if (floatLiteralFitsF32(expr.value)) {
          expr.resolved = expected;
          return expected;
        }
        errAt(ctx, `float literal out of range for f32`, expr.line, expr.col,
          expr.value.length, `${expr.value} overflows f32`,
          `use f64, or write the f32 value you mean`);
        return null;
      }
      return T_F64;
    }
    case "string": return T_STR;
    case "bool":   return T_BOOL;
    case "null":   return T_NULL;

    case "ident": {
      const info = env.get(expr.name);
      if (info) return info.type;
      const scopeEntry = ctx.fileScope.get(expr.name);
      if (scopeEntry) {
        if (scopeEntry.kind === "func") {
          // Function name used as a value — return its funcref type
          const params = funcParams(scopeEntry.entry).map(p => p.type);
          const ret = funcReturnType(scopeEntry.entry);
          return { kind: "funcref", params, ret, line: expr.line, col: expr.col };
        }
        // A module-level constant reads as its declared type. The emitter
        // substitutes the initialiser, so nothing is stored or looked up.
        if (scopeEntry.kind === "const") {
          expr.constRef = scopeEntry.decl;
          return scopeEntry.decl.type;
        }
        errAt(ctx, `'${expr.name}' is a ${scopeEntry.kind}, not a variable`, expr.line, expr.col);
        return null;
      }
      errAt(ctx, `undefined variable '${expr.name}'`, expr.line, expr.col);
      return null;
    }

    case "incr-expr": {
      // checkLval(writing) covers undefined names and all const rules
      const lType = checkLval(expr.lval, env, ctx, /* writing */ true);
      if (!lType) return null;
      if (!isInteger(lType)) {
        errAt(ctx, `'${expr.op}' requires i32 or i64, got ${typeName(lType)}`,
          expr.line, expr.col);
        return null;
      }
      return lType;
    }

    case "unary": {
      // `-2147483648` is unary minus over the literal 2147483648, which is one
      // past i32's positive range — so without help the operand widens to i64
      // and i32's most negative value becomes unspellable in decimal. Negation
      // of a literal against a signed target therefore allows one extra step,
      // exactly the asymmetry of two's complement.
      if (expr.op === "-" && expr.expr.kind === "int" &&
          expected?.kind === "prim" && (expected.name === "i32" || expected.name === "i64")) {
        const lit = wacIntLit(expr.expr.value);
        const limit = expected.name === "i32" ? 2147483648n : 9223372036854775808n;
        if (lit.ok && !lit.hex && lit.magnitude <= limit) {
          expr.expr.resolved = expected;
          return expected;
        }
      }
      const t = inferExpr(expr.expr, env, ctx, expected);
      if (!t) return null;
      if (expr.op === "!") {
        if (!typeEq(t, T_BOOL)) {
          errAt(ctx, `'!' requires bool, got ${typeName(t)}`, expr.line, expr.col);
          return null;
        }
        return T_BOOL;
      }
      if (expr.op === "-") {
        if (!isNumeric(t)) {
          errAt(ctx, `unary '-' requires numeric type, got ${typeName(t)}`, expr.line, expr.col);
          return null;
        }
        // An unsigned type has no negative values, so negation has no meaning
        // there. Wrapping negation is still available as `0 - x`, which says
        // what it does.
        if (isUnsigned(t)) {
          errAt(ctx, `unary '-' is not defined on ${typeName(t)}`, expr.line, expr.col,
            1, `${typeName(t)} has no negative values`, `use \`0 - x\` for wrapping negation`);
          return null;
        }
        return t;
      }
      if (expr.op === "~") {
        if (!isInteger(t)) {
          errAt(ctx, `'~' requires i32 or i64, got ${typeName(t)}`, expr.line, expr.col);
          return null;
        }
        return t;
      }
      errAt(ctx, `unknown unary operator '${expr.op}'`, expr.line, expr.col);
      return null;
    }

    case "binary": {
      // An operand that is a bare literal takes its type from the other side,
      // so `x * 2` works whatever integer type x has. Infer the left first,
      // offer it to the right, then — if the left was itself a literal and so
      // guessed its own width — re-infer it against what the right turned out
      // to be, which is what makes `2 * x` work as well as `x * 2`.
      let lt = inferExpr(expr.left, env, ctx, expected);
      const rt = inferExpr(expr.right, env, ctx, lt ?? expected);
      if (expr.left.kind === "int" && rt && isInteger(rt) && lt && !typeEq(lt, rt)) {
        lt = inferExpr(expr.left, env, ctx, rt);
      }
      if (!lt || !rt) return null;
      return checkBinaryOp(expr.op, lt, rt, expr.line, expr.col, ctx);
    }

    case "cast": {
      const t = inferExpr(expr.expr, env, ctx);
      if (!t) return null;
      return checkCast(expr.op, t, expr.type, expr.line, expr.col, ctx, expr.expr);
    }

    case "is": {
      const lt = inferExpr(expr.expr, env, ctx);
      if (!lt) return null;
      if (expr.rhs === "null") {
        // null test: expr must be nullable or a non-null ref (always false on non-null)
        if (!isRefType(lt)) {
          errAt(ctx, `'is null' requires a reference type, got ${typeName(lt)}`, expr.line, expr.col);
        }
        return T_BOOL;
      }
      if (typeof expr.rhs === "object" && "kind" in expr.rhs && isWacType(expr.rhs)) {
        // Type test: expr is WacType
        const targetType = expr.rhs as WacType;
        if (!isRefType(lt)) {
          errAt(ctx, `'is' type test requires a reference type, got ${typeName(lt)}`, expr.line, expr.col);
        }
        // Statically unrelated struct hierarchies: the test can never be true
        const ltStruct = lt.kind === "struct" ? lt : lt.kind === "nullable" && lt.inner.kind === "struct" ? lt.inner : null;
        if (ltStruct && targetType.kind === "struct") {
          const le = entryOfType(ltStruct, ctx);
          const te = entryOfType(targetType, ctx);
          if (le && te && !commonAncestor(le, te)) {
            warnAt(ctx, `'${typeName(ltStruct)} is ${typeName(targetType)}' is always false — the types share no ancestor`,
              expr.line, expr.col);
          }
        }
        return T_BOOL;
      }
      // Reference identity: expr is Expr
      const rhsType = inferExpr(expr.rhs as Expr, env, ctx);
      if (!rhsType) return null;
      if (!isRefType(lt) || !isRefType(rhsType)) {
        errAt(ctx, `'is' identity requires reference types, got ${typeName(lt)} and ${typeName(rhsType)}`,
          expr.line, expr.col);
      }
      return T_BOOL;
    }

    case "ternary": {
      const ct = inferExpr(expr.cond, env, ctx);
      if (ct && !typeEq(ct, T_BOOL)) {
        errAt(ctx, `ternary condition must be bool, got ${typeName(ct)}`, expr.cond.line, expr.cond.col);
      }
      // Both branches take the expected type, and failing that each offers
      // its own to the other, so `u32 x = c ? 1 : 2` and `c ? a : 0` work the
      // same way the operands of a binary operator do.
      let tt = inferExpr(expr.then, env, ctx, expected);
      let et = inferExpr(expr.else_, env, ctx, expected ?? tt);
      if (expr.then.kind === "int" && et && isInteger(et) && tt && !typeEq(tt, et)) {
        tt = inferExpr(expr.then, env, ctx, et);
      }
      if (!tt || !et) return tt ?? et;
      if (typeEq(tt, et)) return tt;
      // Struct branches type to their closest common ancestor — this covers
      // one branch being the other's ancestor (the result is that ancestor)
      // as well as sibling subtypes of a shared parent.
      if (tt.kind === "struct" && et.kind === "struct") {
        const te = entryOfType(tt, ctx);
        const ee = entryOfType(et, ctx);
        const lca = te && ee ? commonAncestor(te, ee) : null;
        if (lca) return structType(lca.name, lca.typeIndex);
        errAt(ctx, `ternary branches have no common ancestor: ${typeName(tt)} and ${typeName(et)}`,
          expr.line, expr.col);
        return tt;
      }
      // One branch being `null` makes the result nullable. Without this the wider
      // side never wins, because `null` is assignable to no non-nullable type and no
      // type is assignable to `null` — so `cond ? S(1) : null` was rejected outright
      // for every struct, array and funcref, not just for enums.
      if (isNullT(tt) && nullableOf(et) !== null) return nullableOf(et)!;
      if (isNullT(et) && nullableOf(tt) !== null) return nullableOf(tt)!;
      // Other widenings (null → T?, T → T?, T? → S?): the wider side wins.
      if (isAssignable(et, tt, ctx)) return tt;
      if (isAssignable(tt, et, ctx)) return et;
      errAt(ctx, `ternary branches have incompatible types: ${typeName(tt)} and ${typeName(et)}`,
        expr.line, expr.col);
      return tt;
    }

    case "call": {
      return inferCall(expr, env, ctx);
    }

    case "index": {
      const at = inferExpr(expr.expr, env, ctx);
      if (!at) return null;
      // String indexing: s[i] → string (char at byte position)
      if (typeEq(at, T_STR)) {
        const it = inferExpr(expr.idx, env, ctx);
        if (it && !typeEq(it, T_I32)) {
          errAt(ctx, `string index must be i32, got ${typeName(it)}`, expr.idx.line, expr.idx.col);
        }
        return T_STR;
      }
      if (at.kind !== "array") {
        errAt(ctx, `type '${typeName(at)}' is not an array`, expr.expr.line, expr.expr.col);
        return null;
      }
      const it = inferExpr(expr.idx, env, ctx);
      if (it && !typeEq(it, T_I32)) {
        errAt(ctx, `array index must be i32, got ${typeName(it)}`, expr.idx.line, expr.idx.col);
      }
      // Packed arrays: reads return i32
      if (isPackedElem(at.elem)) return T_I32;
      return at.elem;
    }

    case "field": {
      return inferFieldAccess(expr.expr, expr.name, expr, env, ctx);
    }

    case "unwrap": {
      const t = inferExpr(expr.expr, env, ctx);
      if (!t) return null;
      if (t.kind !== "nullable") {
        errAt(ctx, `'!' unwrap requires nullable type, got ${typeName(t)}`, expr.line, expr.col);
        return null;
      }
      return t.inner;
    }

    case "construct": {
      return inferConstruct(expr, env, ctx);
    }

    case "arrNew": {
      return inferArrNew(expr, env, ctx);
    }
  }
}

// ── Call expression inference ─────────────────────────────────────────────────

function inferCall(
  expr: Expr & { kind: "call" },
  env: VarEnv, ctx: Ctx,
): WacType | null {
  const { callee, args } = expr;

  // Direct function call: foo(args)
  if (callee.kind === "ident") {
    const name = callee.name;
    // Check local variables first (funcref types)
    const local = env.get(name);
    if (local) {
      if (local.type.kind !== "funcref") {
        errAt(ctx, `'${name}' is not callable (type: ${typeName(local.type)})`, callee.line, callee.col);
        return null;
      }
      return checkArgList(args, local.type.params, local.type.ret, expr, env, ctx);
    }
    // Check file scope for a function entry
    const se = ctx.fileScope.get(name);
    if (!se) {
      errAt(ctx, `undefined function '${name}'`, callee.line, callee.col);
      return null;
    }
    if (se.kind !== "func") {
      errAt(ctx, `'${name}' is a struct type, not a function`, callee.line, callee.col);
      return null;
    }
    const ps  = funcParams(se.entry).map(p => p.type);
    const ret = funcReturnType(se.entry);
    return checkArgList(args, ps, ret, expr, env, ctx);
  }

  // Method / static call: expr.name(args)
  if (callee.kind === "field") {
    const { expr: baseExpr, name: methodName } = callee;

    // Builtin statics on the float types: the only way to see a float's
    // representation. Reinterpretation, not conversion — the bits are unchanged,
    // and each float pairs with the unsigned integer of its own width.
    if (baseExpr.kind === "ident" && (baseExpr.name === "f64" || baseExpr.name === "f32")
        && !ctx.fileScope.has(baseExpr.name)) {
      const isF64 = baseExpr.name === "f64";
      const floatT = isF64 ? T_F64 : T_F32;
      const bitsT = isF64 ? T_U64 : T_U32;
      if (methodName !== "toBits" && methodName !== "fromBits") {
        errAt(ctx, `type '${baseExpr.name}' has no static method '${methodName}'`,
          callee.line, callee.col);
        return null;
      }
      const want = methodName === "toBits" ? floatT : bitsT;
      if (args.length !== 1) {
        errAt(ctx, `'${baseExpr.name}.${methodName}()' takes 1 argument`, expr.line, expr.col);
        return null;
      }
      const at3 = inferExpr(args[0], env, ctx, want);
      if (at3 && !typeEq(at3, want)) {
        errAt(ctx, `'${baseExpr.name}.${methodName}()' argument must be ${typeName(want)}, ` +
          `got ${typeName(at3)}`, args[0].line, args[0].col);
      }
      return methodName === "toBits" ? bitsT : floatT;
    }

    // Builtin statics on the `string` type. `string` lexes as an identifier, so
    // this has to be matched before the base expression is inferred — there is no
    // variable of that name to infer.
    if (baseExpr.kind === "ident" && baseExpr.name === "string" && !ctx.fileScope.has("string")) {
      if (methodName === "fromBytes") {
        if (args.length !== 1) {
          errAt(ctx, `'string.fromBytes()' takes 1 argument (bytes)`, expr.line, expr.col);
          return null;
        }
        const bT = inferExpr(args[0], env, ctx);
        if (bT && !(bT.kind === "array" && bT.elem.kind === "prim" && bT.elem.name === "u8")) {
          errAt(ctx, `'string.fromBytes()' argument must be u8[], got ${typeName(bT)}`,
            args[0].line, args[0].col);
        }
        return T_STR;
      }
      if (methodName === "fromCodepoint") {
        if (args.length !== 1) {
          errAt(ctx, `'string.fromCodepoint()' takes 1 argument (codepoint)`, expr.line, expr.col);
          return null;
        }
        const cpT = inferExpr(args[0], env, ctx, T_I32);
        if (cpT && !typeEq(cpT, T_I32)) {
          errAt(ctx, `'string.fromCodepoint()' argument must be i32, got ${typeName(cpT)}`,
            args[0].line, args[0].col);
        }
        return T_STR;
      }
      errAt(ctx, `type 'string' has no static method '${methodName}'`, callee.line, callee.col);
      return null;
    }

    // Variant construction: Shape.Circle(args). Checked before static methods
    // because an enum's base struct has no methods, so there is nothing to shadow.
    if (baseExpr.kind === "ident") {
      const ee = ctx.fileScope.get(baseExpr.name);
      if (ee?.kind === "enum") {
        const variant = ee.enumEntry.variants.find(v => v.name === methodName);
        if (!variant) {
          errAt(ctx, `'${methodName}' is not a variant of '${ee.enumEntry.name}'`,
            callee.line, callee.col, methodName.length);
          return null;
        }
        if (variant.fields.length === 0) {
          errAt(ctx, `'${baseExpr.name}.${methodName}' takes no payload — write it without parentheses`,
            callee.line, callee.col, methodName.length);
          return null;
        }
        const variantType: WacType = {
          kind: "struct", name: variant.name,
          resolvedTypeIndex: variant.entry.typeIndex, line: expr.line, col: expr.col,
        };
        // A variant is a struct, so argument checking is the ordinary one; the only
        // difference is that the compiler supplies the tag.
        expr.variantTypeIndex = variant.entry.typeIndex;
        return checkArgList(args, variant.fields.map(f => f.type), variantType, expr, env, ctx);
      }
    }

    // Static method: StructName.method(args)
    if (baseExpr.kind === "ident") {
      const se = ctx.fileScope.get(baseExpr.name);
      if (se?.kind === "struct") {
        const structEntry = se.entry;
        const m = structEntry.methods.get(methodName);
        if (!m) {
          errAt(ctx, `struct '${baseExpr.name}' has no static method '${methodName}'`,
            callee.line, callee.col);
          return null;
        }
        const mdecl = m.origin.kind === "method" ? m.origin.decl : null;
        if (!mdecl) return null;
        if (mdecl.hasThis) {
          // Allow Counter.inc(receiver, ...args) — receiver is the this argument
          const selfType: WacType = { kind: "struct", name: se.entry.name, resolvedTypeIndex: se.entry.typeIndex, line: 0, col: 0 };
          const allParams = [selfType, ...mdecl.params.map(p => p.type)];
          return checkArgList(args, allParams, mdecl.returnType, expr, env, ctx);
        }
        return checkArgList(args, mdecl.params.map(p => p.type), mdecl.returnType, expr, env, ctx);
      }
    }

    // Instance method call: expr.method(args)
    const baseType = inferExpr(baseExpr, env, ctx);
    if (!baseType) return null;

    // .len() on arrays and strings
    if ((baseType.kind === "array" || typeEq(baseType, T_STR)) && methodName === "len") {
      if (args.length !== 0) {
        errAt(ctx, `'len()' takes no arguments`, expr.line, expr.col);
      }
      return T_I32;
    }

    // String methods
    if (typeEq(baseType, T_STR)) {
      if (methodName === "slice") {
        if (args.length !== 2) {
          errAt(ctx, `'slice()' takes 2 arguments (start, end)`, expr.line, expr.col);
          return null;
        }
        for (const arg of args) {
          const at2 = inferExpr(arg, env, ctx);
          if (at2 && !typeEq(at2, T_I32)) {
            errAt(ctx, `'slice()' arguments must be i32, got ${typeName(at2)}`, arg.line, arg.col);
          }
        }
        return T_STR;
      }
      if (methodName === "toBytes") {
        if (args.length !== 0) {
          errAt(ctx, `'toBytes()' takes no arguments`, expr.line, expr.col);
        }
        return {
          kind: "array",
          elem: { kind: "prim", name: "u8", line: expr.line, col: expr.col },
          line: expr.line, col: expr.col,
        };
      }
      if (methodName === "indexOf") {
        if (args.length !== 1) {
          errAt(ctx, `'indexOf()' takes 1 argument (needle)`, expr.line, expr.col);
          return null;
        }
        const needleT = inferExpr(args[0], env, ctx);
        if (needleT && !typeEq(needleT, T_STR)) {
          errAt(ctx, `'indexOf()' argument must be string, got ${typeName(needleT)}`, args[0].line, args[0].col);
        }
        return T_I32;
      }
      errAt(ctx, `type 'string' has no method '${methodName}'`, callee.line, callee.col);
      return null;
    }

    if (baseType.kind === "nullable") {
      errAt(ctx,
        `cannot call method on nullable type '${typeName(baseType)}' — unwrap with '!'`,
        callee.line, callee.col);
      return null;
    }

    if (baseType.kind !== "struct") {
      errAt(ctx, `type '${typeName(baseType)}' has no method '${methodName}'`,
        callee.line, callee.col);
      return null;
    }

    // Check if it's a funcref field (e.g. h.callback("arg"))
    const fields2 = allFields(entryOfType(baseType, ctx));
    const fnField = fields2.find(f => f.name === methodName && f.type.kind === "funcref");
    if (fnField) {
      const fr = fnField.type as { kind: "funcref"; params: WacType[]; ret: WacType };
      return checkArgList(args, fr.params, fr.ret, expr, env, ctx);
    }

    const m = lookupMethod(entryOfType(baseType, ctx), methodName);
    if (!m) {
      errAt(ctx, `struct '${baseType.name}' has no method '${methodName}'`,
        callee.line, callee.col);
      return null;
    }
    const mdecl = m.origin.kind === "method" ? m.origin.decl : null;
    if (!mdecl) return null;

    if (!mdecl.hasThis) {
      errAt(ctx,
        `'${methodName}' is a static method — call with '${baseType.name}.${methodName}(...)'`,
        callee.line, callee.col);
      return null;
    }

    // Deep const: calling a non-const method through a const reference
    if (!mdecl.thisConst && exprIsConst(baseExpr, env, ctx)) {
      errAt(ctx,
        `cannot call non-const method '${methodName}' through const reference`,
        callee.line, callee.col);
    }

    return checkArgList(args, mdecl.params.map(p => p.type), mdecl.returnType, expr, env, ctx);
  }

  // Otherwise: evaluate callee as funcref
  const calleeType = inferExpr(callee, env, ctx);
  if (!calleeType) return null;
  if (calleeType.kind !== "funcref") {
    errAt(ctx, `type '${typeName(calleeType)}' is not callable`, callee.line, callee.col);
    return null;
  }
  return checkArgList(args, calleeType.params, calleeType.ret, expr, env, ctx);
}

/** Validate call arguments against expected parameter types. Returns return type. */
function checkArgList(
  args: Expr[],
  params: WacType[],
  ret: WacType,
  callExpr: { line: number; col: number },
  env: VarEnv, ctx: Ctx,
): WacType | null {
  if (args.length !== params.length) {
    errAt(ctx,
      `expected ${params.length} argument(s), got ${args.length}`,
      callExpr.line, callExpr.col);
  }
  const n = Math.min(args.length, params.length);
  for (let i = 0; i < n; i++) {
    const at = inferExpr(args[i], env, ctx, params[i]);
    if (at) {
      // If the argument sits on a later line than the call opens on, point
      // the diagnostic's leading context back at the call line.
      const contextStart = args[i].line !== callExpr.line ? callExpr.line : undefined;
      checkAssign(params[i], at, args[i].line, args[i].col, ctx,
        exprText(args[i]).length, undefined, undefined, contextStart);
    }
  }
  // Extra args still inferred (for error reporting)
  for (let i = n; i < args.length; i++) inferExpr(args[i], env, ctx);
  return ret;
}

// ── Field access inference ────────────────────────────────────────────────────

function inferFieldAccess(
  baseExpr: Expr, fieldName: string,
  // The caller passes the field node itself, which is what lets a payload-less
  // variant be recorded here for the emitter to use.
  pos: { line: number; col: number; variantTypeIndex?: number },
  env: VarEnv, ctx: Ctx,
): WacType | null {
  // Shape.Point — a payload-less variant is a value, not a call.
  if (baseExpr.kind === "ident") {
    const ee = ctx.fileScope.get(baseExpr.name);
    if (ee?.kind === "enum") {
      const variant = ee.enumEntry.variants.find(v => v.name === fieldName);
      if (!variant) {
        errAt(ctx, `'${fieldName}' is not a variant of '${ee.enumEntry.name}'`,
          pos.line, pos.col, fieldName.length);
        return null;
      }
      if (variant.fields.length > 0) {
        const names = variant.fields.map(f => f.name).join(", ");
        errAt(ctx,
          `'${baseExpr.name}.${fieldName}' needs a payload (${names})`,
          pos.line, pos.col, fieldName.length, undefined,
          `write it as ${baseExpr.name}.${fieldName}(...)`);
        return null;
      }
      pos.variantTypeIndex = variant.entry.typeIndex;
      return { kind: "struct", name: variant.name,
               resolvedTypeIndex: variant.entry.typeIndex, line: pos.line, col: pos.col };
    }
  }

  // StructName.method — either a static method ref (error) or instance method ref (funcref value)
  if (baseExpr.kind === "ident") {
    const se = ctx.fileScope.get(baseExpr.name);
    if (se?.kind === "struct") {
      const m = lookupMethod(se.entry, fieldName);
      if (m && m.origin.kind === "method") {
        // A method reference is the underlying function. An instance method
        // takes its receiver as an explicit leading parameter — there are no
        // closures, so `Counter.inc` is fn[void(Counter)]. A static method has
        // no receiver, so it is simply its declared signature
        // [see funcrefs.md].
        const mdecl = m.origin.decl;
        const params = mdecl.params.map(p => p.type);
        if (mdecl.hasThis) {
          const selfType: WacType = {
            kind: "struct", name: se.entry.name,
            resolvedTypeIndex: se.entry.typeIndex, line: 0, col: 0,
          };
          params.unshift(selfType);
        }
        return { kind: "funcref", params, ret: mdecl.returnType, line: pos.line, col: pos.col };
      }
      errAt(ctx, `cannot use static method '${baseExpr.name}.${fieldName}' as a value`,
        pos.line, pos.col);
      return null;
    }
  }

  const baseType = inferExpr(baseExpr, env, ctx);
  if (!baseType) return null;

  if (baseType.kind === "nullable") {
    errAt(ctx, `cannot access field on nullable type '${typeName(baseType)}' — unwrap with '!'`,
      pos.line, pos.col);
    return null;
  }
  if (baseType.kind !== "struct") {
    errAt(ctx, `type '${typeName(baseType)}' has no field '${fieldName}'`, pos.line, pos.col);
    return null;
  }

  const fields = allFields(entryOfType(baseType, ctx));
  const field = fields.find(f => f.name === fieldName);
  if (!field) {
    // Could be a method accessed as value
    const m = lookupMethod(entryOfType(baseType, ctx), fieldName);
    if (m) {
      errAt(ctx, `cannot use method '${fieldName}' as a value`, pos.line, pos.col);
      return null;
    }
    errAt(ctx, `struct '${baseType.name}' has no field '${fieldName}'`, pos.line, pos.col);
    return null;
  }
  return field.type;
}

// ── Construction expression inference ─────────────────────────────────────────

function inferConstruct(
  expr: Expr & { kind: "construct" },
  env: VarEnv, ctx: Ctx,
): WacType | null {
  const { ctype, args, named } = expr;
  if (ctype.kind !== "struct") {
    errAt(ctx, `construction requires a struct type, got ${typeName(ctype)}`, expr.line, expr.col);
    return null;
  }

  // The parser emits `construct { ctype: struct(Name), args }` for BOTH struct
  // constructions AND plain function calls like `helper(42)`. Disambiguate here
  // based on what Name resolves to in the file scope: the resolver annotates
  // ctype iff Name is a struct in THIS file's scope (a same-named struct in an
  // unimported file must not be constructible here).
  if (ctype.resolvedTypeIndex === undefined) {
    // Not a struct — try as a function call or funcref variable
    const local = env.get(ctype.name);
    if (local) {
      if (local.type.kind === "funcref") {
        if (named) {
          errAt(ctx, `function calls cannot use named argument syntax`, expr.line, expr.col);
          return null;
        }
        return checkArgList(args, local.type.params, local.type.ret, expr, env, ctx);
      }
      // Local variable found but it's not callable
      errAt(ctx, `'${ctype.name}' of type '${typeName(local.type)}' is not callable`,
        expr.line, expr.col);
      return null;
    }
    const se = ctx.fileScope.get(ctype.name);
    if (se?.kind === "func") {
      if (named) {
        errAt(ctx, `function calls cannot use named argument syntax`, expr.line, expr.col);
        return null;
      }
      const ps  = funcParams(se.entry).map(p => p.type);
      const ret = funcReturnType(se.entry);
      return checkArgList(args, ps, ret, expr, env, ctx);
    }
    // A struct in scope would have been annotated by the resolver, so this
    // name is neither a local, a function, nor a struct.
    errAt(ctx, `undefined function or struct '${ctype.name}'`, expr.line, expr.col);
    return null;
  }

  const fields = allFields(entryOfType(ctype, ctx));

  if (named) {
    // Named construction: Point { x: 1, y: 2 }
    const provided = new Map(named.map(n => [n.name, n]));
    for (const f of fields) {
      if (!provided.has(f.name)) {
        errAt(ctx, `missing field '${f.name}' in named construction of '${ctype.name}'`,
          expr.line, expr.col);
      }
    }
    for (const { name, val } of named) {
      const field = fields.find(f => f.name === name);
      if (!field) {
        errAt(ctx, `struct '${ctype.name}' has no field '${name}'`, expr.line, expr.col);
        continue;
      }
      const vt = inferExpr(val, env, ctx, field.type);
      if (vt) checkAssign(field.type, vt, val.line, val.col, ctx);
    }
  } else if (args.length === 0) {
    // Default construction: T()
    if (!structHasDefault(entryOfType(ctype, ctx), ctx, new Set())) {
      errAt(ctx, `struct '${ctype.name}' has no default value (contains non-null non-default fields)`,
        expr.line, expr.col);
    }
  } else {
    // Positional construction: T(a, b, c)
    if (args.length !== fields.length) {
      errAt(ctx,
        `positional construction of '${ctype.name}' expects ${fields.length} argument(s), got ${args.length}`,
        expr.line, expr.col);
    }
    const n = Math.min(args.length, fields.length);
    for (let i = 0; i < n; i++) {
      const at = inferExpr(args[i], env, ctx, fields[i].type);
      if (at) checkAssign(fields[i].type, at, args[i].line, args[i].col, ctx);
    }
    for (let i = n; i < args.length; i++) inferExpr(args[i], env, ctx);
  }

  return structType(ctype.name, ctype.resolvedTypeIndex);
}

function inferArrNew(
  expr: Expr & { kind: "arrNew" },
  env: VarEnv, ctx: Ctx,
): WacType | null {
  const { elem, size, fixed, fill } = expr;

  if (fixed.length > 0) {
    // T[](e1, e2, ...) — fixed elements.
    // Packed elements are written as i32 and truncate, exactly as indexed
    // assignment does [see checkLval lv-index and arrays.md].
    const written = isPackedElem(elem) ? T_I32 : elem;
    for (const e of fixed) {
      const et = inferExpr(e, env, ctx, written);
      if (et) checkAssign(written, et, e.line, e.col, ctx);
    }
  } else if (size !== null) {
    const st = inferExpr(size, env, ctx);
    if (st && !typeEq(st, T_I32)) {
      errAt(ctx, `array size must be i32, got ${typeName(st)}`, size.line, size.col);
    }
    if (fill !== undefined) {
      // T[size](fill: v) — every element is `v`. No default is needed, which is the
      // point: it is the only way to build a dynamically-sized array of a type that has
      // none, such as anything reachable from an enum.
      const written = isPackedElem(elem) ? T_I32 : elem;
      const ft = inferExpr(fill, env, ctx, written);
      if (ft) checkAssign(written, ft, fill.line, fill.col, ctx);
    } else if (!hasDefault(elem, ctx)) {
      // T[size]() — default construction; requires T to have a default.
      errAt(ctx, `type '${typeName(elem)}' has no default value for array construction`,
        expr.line, expr.col, 1, undefined,
        `give every element a value: ${typeName(elem)}[n](fill: ...)`);
    }
  }

  return arrayOf(elem);
}

// ── Binary operator checking ──────────────────────────────────────────────────

function checkBinaryOp(
  op: string, lt: WacType, rt: WacType,
  line: number, col: number,
  ctx: Ctx,
): WacType | null {
  // String concatenation: string + string → string
  if (op === "+" && typeEq(lt, T_STR)) {
    if (!typeEq(rt, T_STR)) {
      errAt(ctx, `type mismatch in '+': string and ${typeName(rt)} — both operands must be string`, line, col);
      return null;
    }
    return T_STR;
  }

  // String comparison: string op string → bool
  if ((op === "==" || op === "!=" || op === "<" || op === "<=" || op === ">" || op === ">=") &&
      typeEq(lt, T_STR)) {
    if (!typeEq(rt, T_STR)) {
      errAt(ctx, `type mismatch in '${op}': string and ${typeName(rt)}`, line, col);
      return null;
    }
    return T_BOOL;
  }

  // Arithmetic: same numeric type (not bool)
  if (op === "+" || op === "-" || op === "*" || op === "/" || op === "%") {
    if (!isNumeric(lt)) {
      errAt(ctx, `'${op}' requires numeric type, got ${typeName(lt)}`, line, col);
      return null;
    }
    if (!typeEq(lt, rt)) {
      errAt(ctx, `type mismatch in '${op}': ${typeName(lt)} and ${typeName(rt)}`, line, col);
      return null;
    }
    return lt;
  }

  // Comparison: same primitive type → bool
  if (op === "==" || op === "!=" || op === "<" || op === "<=" || op === ">" || op === ">=") {
    if (isRefType(lt) || isRefType(rt)) {
      errAt(ctx, `'${op}' not allowed on reference types — use 'is' for identity`, line, col);
      return null;
    }
    if (!typeEq(lt, rt)) {
      errAt(ctx, `type mismatch in '${op}': ${typeName(lt)} and ${typeName(rt)}`, line, col);
      return null;
    }
    return T_BOOL;
  }

  // Logical: bool × bool → bool
  if (op === "&&" || op === "||") {
    if (!typeEq(lt, T_BOOL)) {
      errAt(ctx, `'${op}' requires bool operands, got ${typeName(lt)}`, line, col);
      return null;
    }
    if (!typeEq(rt, T_BOOL)) {
      errAt(ctx, `'${op}' requires bool operands, got ${typeName(rt)}`, line, col);
      return null;
    }
    return T_BOOL;
  }

  // Bitwise: i32×i32 or i64×i64
  if (op === "&" || op === "|" || op === "^") {
    if (!isInteger(lt)) {
      errAt(ctx, `'${op}' requires i32 or i64, got ${typeName(lt)}`, line, col);
      return null;
    }
    if (!typeEq(lt, rt)) {
      errAt(ctx, `type mismatch in '${op}': ${typeName(lt)} and ${typeName(rt)}`, line, col);
      return null;
    }
    return lt;
  }

  // Shift: i32×i32, i64×i64, or i64×i32
  if (op === "<<" || op === ">>" || op === ">>>") {
    if (!isInteger(lt)) {
      errAt(ctx, `'${op}' requires an integer type, got ${typeName(lt)}`, line, col);
      return null;
    }
    // `>>` on an unsigned type is already the logical shift, so `>>>` there
    // asks for something it is already getting. Rejecting it keeps `>>>` a
    // signal that a signed value is deliberately being shifted as unsigned,
    // the same way the cast operators refuse a stronger form than needed.
    if (op === ">>>" && isUnsigned(lt)) {
      errAt(ctx, `'>>>' is redundant on ${typeName(lt)}`, line, col, 3,
        `'>>' on an unsigned type is already a logical shift`, `use \`>>\``);
      return null;
    }
    if (!typeEq(lt, rt)) {
      // Special: a 64-bit value may take a 32-bit shift amount.
      if (typeEq(lt, T_I64) && typeEq(rt, T_I32)) return T_I64;
      if (isUnsigned(lt) && lt.kind === "prim" && lt.name === "u64" &&
          rt.kind === "prim" && (rt.name === "i32" || rt.name === "u32")) return lt;
      errAt(ctx, `type mismatch in '${op}': ${typeName(lt)} and ${typeName(rt)}`, line, col);
      return null;
    }
    return lt;
  }

  errAt(ctx, `unknown binary operator '${op}'`, line, col);
  return null;
}

// ── Cast checking ─────────────────────────────────────────────────────────────

function checkCast(
  op: string, from: WacType, to: WacType,
  line: number, col: number,
  ctx: Ctx,
  casteeExpr?: Expr,
): WacType | null {
  const fn = typeName(from), tn = typeName(to);
  const casteeText = casteeExpr ? exprText(casteeExpr) : "expr";
  const casteeSpan = casteeText.length;

  // Reference casts (handled separately from numeric)
  if (isRefType(from) || from.kind === "prim" && from.name === "null") {
    if (op === "as" || op === "as!") {
      // as: upcast only (subtype to parent)
      // as!: downcast (may trap)
      if (!isRefType(to) && to.kind !== "prim") {
        errAt(ctx, `cannot cast reference type '${fn}' to '${tn}'`, line, col);
        return null;
      }
      // i31ref -> i32: use as (lossless; 31 bits always fit in 32)
      if (from.kind === "prim" && from.name === "i31ref" && to.kind === "prim" && to.name === "i32") {
        if (op !== "as") {
          errAt(ctx, `'i31ref -> i32' is lossless — use 'as'`, line, col);
        }
        return to;
      }
      // Upcast (from is subtype of to): use 'as'
      if (isAssignable(from, to, ctx)) {
        if (op !== "as") {
          errAt(ctx, `upcast to '${tn}' is always safe — use 'as'`, line, col);
        }
        return to;
      }
      // Downcast: use 'as!'
      if (op !== "as!") {
        errAt(ctx, `downcast to '${tn}' may fail — use 'as!'`, line, col);
      }
      // Statically unrelated struct hierarchies: the downcast always traps
      if (from.kind === "struct" && to.kind === "struct") {
        const fe2 = entryOfType(from, ctx);
        const te2 = entryOfType(to, ctx);
        if (fe2 && te2 && !commonAncestor(fe2, te2)) {
          warnAt(ctx, `'${fn} as! ${tn}' always traps — the types share no ancestor`, line, col);
        }
      }
      return to;
    }
    errAt(ctx, `reference cast requires 'as' or 'as!', got '${op}'`, line, col);
    return null;
  }

  // Numeric casts (including i31ref <-> i32)
  if (typeEq(from, to)) {
    errAt(ctx, `cast from '${fn}' to '${tn}' is redundant`, line, col);
    return to;
  }

  if (isLosslessNumericCast(fn, tn)) {
    if (op !== "as") {
      const totalSpan = casteeSpan + 1 + op.length + 1 + tn.length;
      // Inside a var initializer, spell out the whole corrected statement
      // ("use `as` instead: i64 a = x as i64;") [§wac-diag-cast-p5fn2rk].
      const hint = ctx.varDeclPrefix !== undefined
        ? `use \`as\` instead: ${ctx.varDeclPrefix}${casteeText} as ${tn};`
        : `use \`as\` instead of \`${op}\``;
      // Anchor at the castee so the caret underlines `x as~ i64` from its start
      errAt(ctx, `lossy cast not needed`, casteeExpr?.line ?? line, casteeExpr?.col ?? col,
        totalSpan, `${fn} -> ${tn} is lossless`, hint);
    }
    return to;
  }

  if (isNarrowingNumericCast(fn, tn)) {
    if (op === "as") {
      errAt(ctx, `'${fn}' -> '${tn}' is lossy — use 'as!', 'as~', or 'as@'`, line, col);
    } else if (op === "as@" && !isRawNumericCast(fn, tn)) {
      const totalSpan = casteeSpan + 1 + op.length + 1 + tn.length;
      errAt(ctx, `no raw conversion for '${fn}' -> '${tn}'`, line, col, totalSpan,
        `${fn} -> ${tn} has no distinct raw form`,
        `use \`as~\` instead`);
    }
    return to;  // as! and as~ are valid for all narrowing pairs; as@ only where isRawNumericCast
  }

  errAt(ctx, `no valid cast from '${fn}' to '${tn}'`, line, col);
  return null;
}

function isLosslessNumericCast(fn: string | null, tn: string | null): boolean {
  if (!fn || !tn) return false;
  return (fn === "i32"    && tn === "i64")   ||
         (fn === "i32"    && tn === "f64")   ||
         (fn === "f32"    && tn === "f64")   ||
         (fn === "bool"   && tn === "i32")   ||
         (fn === "bool"   && tn === "u32")   ||
         (fn === "i31ref" && tn === "i32")   ||  // 31 bits always fit in 32
         // Unsigned widenings. Every u32 fits in u64, in i64 and exactly in f64,
         // so these are zero-extend / exact and never need a checked form.
         (fn === "u32"    && tn === "u64")   ||
         (fn === "u32"    && tn === "i64")   ||
         (fn === "u32"    && tn === "f64");
  // Deliberately absent: i32 <-> u32 and i64 <-> u64. They are the same bits but
  // not the same values — a negative i32 has no u32 reading, and a u32 above
  // 2^31-1 has no i32 reading. Use `as!` to check, or `as@` to reinterpret.
}

/** Pairs where `as@` has a genuinely distinct raw/bit-level form from `as~`
 *  (int narrowing keeps bits; float->int truncates toward zero). Every other
 *  narrowing pair has no raw form — `as@` is a compile error there. */
function isRawNumericCast(fn: string | null, tn: string | null): boolean {
  if (!fn || !tn) return false;
  return (fn === "i64" && tn === "i32") ||
         (fn === "f64" && tn === "i32") ||
         (fn === "f32" && tn === "i32") ||
         // Same-width signedness changes: a pure reinterpretation of the bits,
         // emitting no instructions at all. This is what `as@` means, so it is
         // the right spelling for it — `as!` gives you the checked version.
         (fn === "i32" && tn === "u32") ||
         (fn === "u32" && tn === "i32") ||
         (fn === "i64" && tn === "u64") ||
         (fn === "u64" && tn === "i64") ||
         // Unsigned narrowing and float->unsigned, matching the signed rows.
         (fn === "u64" && tn === "u32") ||
         (fn === "u64" && tn === "i32") ||
         (fn === "i64" && tn === "u32") ||
         (fn === "f64" && tn === "u32") ||
         (fn === "f32" && tn === "u32");
}

function isNarrowingNumericCast(fn: string | null, tn: string | null): boolean {
  if (!fn || !tn) return false;
  // Narrowing / lossy conversions: may use as!, as~, or as@
  return (fn === "i64"  && tn === "i32")  ||
         (fn === "f64"  && tn === "i32")  ||
         (fn === "f64"  && tn === "i64")  ||
         (fn === "f32"  && tn === "i32")  ||
         (fn === "f32"  && tn === "i64")  ||
         (fn === "f64"  && tn === "f32")  ||
         (fn === "i64"  && tn === "f64")  ||
         (fn === "i64"  && tn === "f32")  ||
         (fn === "i32"  && tn === "f32")  ||
         (fn === "i32"  && tn === "bool") ||
         (fn === "i32"  && tn === "i31ref") ||  // 31-bit, may overflow
         // Signedness changes at the same width: same bits, different value.
         (fn === "i32"  && tn === "u32")  ||
         (fn === "u32"  && tn === "i32")  ||
         (fn === "i64"  && tn === "u64")  ||
         (fn === "u64"  && tn === "i64")  ||
         // Unsigned narrowing, mirroring the signed rows above.
         (fn === "u64"  && tn === "u32")  ||
         (fn === "u64"  && tn === "i32")  ||
         (fn === "i64"  && tn === "u32")  ||
         (fn === "u32"  && tn === "i32")  ||
         // Unsigned <-> float. u32->f32 and u64->f64/f32 lose precision;
         // float->unsigned may be fractional, negative, or out of range.
         (fn === "u32"  && tn === "f32")  ||
         (fn === "u64"  && tn === "f64")  ||
         (fn === "u64"  && tn === "f32")  ||
         (fn === "f64"  && tn === "u32")  ||
         (fn === "f64"  && tn === "u64")  ||
         (fn === "f32"  && tn === "u32")  ||
         (fn === "f32"  && tn === "u64")  ||
         (fn === "i32"  && tn === "u64")  ||  // negative has no u64 reading
         (fn === "u32"  && tn === "bool");
}

/**
 * The enum a type denotes, or null if it is not an enum's base.
 *
 * Only the base type is an enum for matching purposes: matching on a value already
 * known to be one variant has exactly one possible arm, so it is a mistake worth
 * reporting rather than a degenerate case to support.
 */
function enumOfType(t: WacType, ctx: Ctx): EnumEntry | null {
  if (t.kind !== "struct") return null;
  const found = ctx.fileScope.get(t.name);
  if (found?.kind === "enum") return found.enumEntry;
  // A *variant* is an enum value too, so it can be matched. `match (Shape.Circle(2.0))`
  // is the accidental way to reach this and `Circle c = ...; match (c)` the deliberate
  // one; both were rejected with "match requires an enum value, got Circle", which
  // names the value's type as the reason it cannot be used.
  //
  // The arms still have to cover the whole enum. Narrowing the requirement to what the
  // static type admits would need flow analysis, and an arm that cannot be reached
  // costs nothing — the tag comparison never selects it.
  if (found?.kind === "variant") return found.enumEntry;
  return null;
}

// ── Type compatibility check (assignment / argument passing) ──────────────────

function checkAssign(
  expected: WacType, actual: WacType,
  line: number, col: number,
  ctx: Ctx,
  span = 1,
  annotation?: string,
  hint?: string,
  contextStart?: number,
): void {
  if (!isAssignable(actual, expected, ctx)) {
    const ann = annotation ?? `expected ${typeName(expected)}, found ${typeName(actual)}`;
    errAt(ctx,
      `type mismatch: expected ${typeName(expected)}, got ${typeName(actual)}`,
      line, col, span, ann, hint, contextStart);
  }
}

// ── Const expression check (for deep const enforcement) ───────────────────────

/** Returns true if the expression is rooted in a const variable, const this,
 *  or a ref-const binding (a reference reached through const — see VarInfo). */
function exprIsConst(expr: Expr, env: VarEnv, ctx: Ctx): boolean {
  switch (expr.kind) {
    case "ident": {
      const v = env.get(expr.name);
      return (v?.isConst || v?.refConst) ?? false;
    }
    case "field":  return exprIsConst(expr.expr, env, ctx);
    case "unwrap": return exprIsConst(expr.expr, env, ctx);
    case "cast":   return exprIsConst(expr.expr, env, ctx);
    // Either branch const-rooted taints the result (conservative).
    case "ternary": return exprIsConst(expr.then, env, ctx) || exprIsConst(expr.else_, env, ctx);
    // A method call through a const receiver yields a const result: const is
    // deep, and anything the method hands back was reached through that
    // receiver (conservatively so — a const accessor returning a fresh object
    // is also treated as const).
    case "call":   return expr.callee.kind === "field" && exprIsConst(expr.callee.expr, env, ctx);
    default:       return false;
  }
}

/** Types through which a write could reach shared state — binding a const
 *  reference of such a type to a non-const name would launder the constness.
 *  Primitives (copies) and immutable refs (string) are exempt. */
function isMutableRefType(t: WacType): boolean {
  if (t.kind === "struct" || t.kind === "array") return true;
  if (t.kind === "nullable") return isMutableRefType(t.inner);
  return false;
}

// ── Helper: is this AST node a WacType (vs an Expr)? ─────────────────────────

// WacType kinds: "prim" | "struct" | "array" | "nullable" | "funcref"
// Expr kinds never include these (Expr uses "ident", "binary", "call", etc.)
const WAC_TYPE_KINDS = new Set(["prim", "struct", "array", "nullable", "funcref"]);

function isWacType(x: unknown): x is WacType {
  return typeof x === "object" && x !== null && "kind" in x &&
    WAC_TYPE_KINDS.has((x as { kind: string }).kind);
}
