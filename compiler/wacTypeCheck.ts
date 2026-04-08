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
  type FieldDecl, type StructDecl,
} from "./wacParse.ts";
import {
  type ResolveResult, type FuncEntry, type StructEntry, type FileScope,
  funcParams, funcReturnType,
} from "./wacResolve.ts";

// ── Public types ──────────────────────────────────────────────────────────────

export type TypeCheckError = {
  message: string;
  file: string;
  line: number;
  col: number;
  span?: number;
  annotation?: string;
  hint?: string;
};

// ── Type utilities ────────────────────────────────────────────────────────────

/** Build a synthetic primitive type (no source position needed). */
function prim(name: string): WacType {
  return { kind: "prim", name, line: 0, col: 0 };
}

// Well-known singletons
const T_I32  = prim("i32");
const T_I64  = prim("i64");
const T_F32  = prim("f32");
const T_F64  = prim("f64");
const T_BOOL = prim("bool");
const T_VOID = prim("void");
const T_STR  = prim("string");
const T_ANY  = prim("anyref");
const T_I31  = prim("i31ref");
/** Sentinel for the `null` literal — compatible with any T? */
const T_NULL = prim("null");

function structType(name: string): WacType {
  return { kind: "struct", name, line: 0, col: 0 };
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
    case "struct":   return a.name === (b as typeof a).name;
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
    (t.name === "i32" || t.name === "i64" || t.name === "f32" || t.name === "f64");
}
function isInteger(t: WacType): boolean {
  return t.kind === "prim" && (t.name === "i32" || t.name === "i64");
}
function isFloat(t: WacType): boolean {
  return t.kind === "prim" && (t.name === "f32" || t.name === "f64");
}
function isRefType(t: WacType): boolean {
  return t.kind === "struct" || t.kind === "array" || t.kind === "nullable" ||
    (t.kind === "prim" && (t.name === "anyref" || t.name === "i31ref" || t.name === "string"));
}
function isPackedElem(t: WacType): boolean {
  return t.kind === "prim" && (t.name === "i8" || t.name === "i16");
}
function isVoid(t: WacType): boolean {
  return t.kind === "prim" && t.name === "void";
}

/** Is `from` assignable to `to`? Handles subtyping and null widening. */
function isAssignable(
  from: WacType, to: WacType,
  structMap: Map<string, StructEntry>,
): boolean {
  if (typeEq(from, to)) return true;
  // null literal -> any T?
  if (from.kind === "prim" && from.name === "null") {
    return to.kind === "nullable";
  }
  // T -> T? (widen non-null to nullable)
  if (to.kind === "nullable" && from.kind !== "nullable") {
    return isAssignable(from, to.inner, structMap);
  }
  // T? -> S? if T -> S
  if (from.kind === "nullable" && to.kind === "nullable") {
    return isAssignable(from.inner, to.inner, structMap);
  }
  // Struct subtype (Rect -> Shape)
  if (from.kind === "struct" && to.kind === "struct") {
    return isSubtype(from.name, to.name, structMap);
  }
  // Any ref -> anyref
  if (to.kind === "prim" && to.name === "anyref" && isRefType(from)) return true;
  return false;
}

/** Is `sub` a subtype (directly or transitively) of `ancestor`? */
function isSubtype(
  sub: string, ancestor: string,
  structMap: Map<string, StructEntry>,
): boolean {
  if (sub === ancestor) return true;
  const entry = structMap.get(sub);
  if (!entry?.structDecl.parent) return false;
  return isSubtype(entry.structDecl.parent, ancestor, structMap);
}

/** Lookup a method by name, walking the inheritance chain. */
function lookupMethod(
  structName: string, methodName: string,
  structMap: Map<string, StructEntry>,
): FuncEntry | null {
  const entry = structMap.get(structName);
  if (!entry) return null;
  const m = entry.methods.get(methodName);
  if (m) return m;
  const parent = entry.structDecl.parent;
  if (!parent) return null;
  return lookupMethod(parent, methodName, structMap);
}

/** Collect all fields of a struct including inherited ones (parent first). */
function allFields(
  structName: string, structMap: Map<string, StructEntry>,
): FieldDecl[] {
  const entry = structMap.get(structName);
  if (!entry) return [];
  const parentFields = entry.structDecl.parent
    ? allFields(entry.structDecl.parent, structMap) : [];
  return [...parentFields, ...entry.structDecl.fields];
}

/** Does a type have a default value (for T[N]() and T() construction)? */
function hasDefault(
  t: WacType, structMap: Map<string, StructEntry>,
  visiting = new Set<string>(),
): boolean {
  switch (t.kind) {
    case "prim":     return t.name !== "void" && t.name !== "null";
    case "nullable": return true;
    case "array":    return true;  // array of T defaults to all-null/zero
    case "struct":   return structHasDefault(t.name, structMap, visiting);
    case "funcref":  return false;
  }
}

function structHasDefault(
  name: string, structMap: Map<string, StructEntry>,
  visiting: Set<string>,
): boolean {
  if (visiting.has(name)) return false;  // circular non-null ref has no default
  visiting.add(name);
  const entry = structMap.get(name);
  if (!entry) { visiting.delete(name); return false; }
  const fields = allFields(name, structMap);
  for (const f of fields) {
    if (!hasDefault(f.type, structMap, visiting)) { visiting.delete(name); return false; }
  }
  visiting.delete(name);  // backtrack so sibling fields can reuse this struct
  return true;
}

// ── Checker context ───────────────────────────────────────────────────────────

type VarInfo = { type: WacType; isConst: boolean };
type VarEnv  = Map<string, VarInfo>;

type Ctx = {
  file: string;
  structMap: Map<string, StructEntry>;
  fileScope: FileScope;
  errors: TypeCheckError[];
  // per-function:
  returnType: WacType;
  inLoop: number;
  // per-method:
  thisConst: boolean;
};

function errAt(ctx: Ctx, msg: string, line: number, col: number, span = 1, annotation?: string, hint?: string): void {
  ctx.errors.push({ message: msg, file: ctx.file, line, col, span, annotation, hint });
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

  // Per-file structural checks (packed types, override, recursive default)
  for (const [filePath, fileScope] of result.fileScopes) {
    const prog = programs.get(filePath);
    if (!prog) continue;
    const ctx: Ctx = {
      file: filePath, structMap, fileScope, errors: [],
      returnType: T_VOID, inLoop: 0, thisConst: false,
    };
    for (const item of prog.items) {
      if (item.tag === "struct") checkStructShape(item, ctx);
      else if (item.tag === "func") checkFuncSig(item.params, item.returnType, item.line, item.col, ctx);
    }
    allErrors.push(...ctx.errors);
  }

  // Type-check each function / method body
  for (const funcEntry of result.funcs) {
    const prog     = programs.get(funcEntry.filePath);
    const scope    = result.fileScopes.get(funcEntry.filePath);
    if (!prog || !scope) continue;

    const ctx: Ctx = {
      file: funcEntry.filePath, structMap, fileScope: scope, errors: [],
      returnType: T_VOID, inLoop: 0, thisConst: false,
    };
    const env: VarEnv = new Map();

    if (funcEntry.origin.kind === "func") {
      const decl = funcEntry.origin.decl;
      ctx.returnType = decl.returnType;
      for (const p of decl.params) env.set(p.name, { type: p.type, isConst: false });
      const returns = checkBlock(decl.body, env, ctx);
      if (!returns && !isVoid(decl.returnType)) {
        errAt(ctx, `not all code paths return a value in '${decl.name}'`,
          decl.line, decl.col);
      }
    } else {
      const decl       = funcEntry.origin.decl;
      const structName = funcEntry.origin.structName;
      ctx.returnType = decl.returnType;
      ctx.thisConst  = decl.thisConst;
      if (decl.hasThis) {
        env.set("this", { type: structType(structName), isConst: decl.thisConst });
      }
      for (const p of decl.params) env.set(p.name, { type: p.type, isConst: false });
      const returns = checkBlock(decl.body, env, ctx);
      if (!returns && !isVoid(decl.returnType)) {
        errAt(ctx, `not all code paths return a value in method '${structName}.${decl.name}'`,
          decl.line, decl.col);
      }
      // Override correctness
      checkOverride(decl, structName, ctx);
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
  params: { type: WacType; line: number; col: number }[],
  returnType: WacType,
  line: number, col: number,
  ctx: Ctx,
): void {
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
  const fields = allFields(s.name, ctx.structMap);
  for (const f of fields) {
    if (f.type.kind === "struct") {
      const visited = new Set<string>([s.name]);
      if (!structHasDefault(f.type.name, ctx.structMap, visited)) {
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
  structName: string,
  ctx: Ctx,
): void {
  const entry = ctx.structMap.get(structName);
  if (!entry) return;
  const parentName = entry.structDecl.parent;
  const parentHasMethod = parentName
    ? lookupMethod(parentName, decl.name, ctx.structMap) !== null
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
      const initType = inferExpr(stmt.init, env, ctx);
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
      env.set(stmt.name, { type: stmt.type, isConst: stmt.isConst });
      return false;
    }

    case "assign": {
      const lType = checkLval(stmt.lval, env, ctx, /* writing */ true);
      const rType = inferExpr(stmt.rhs, env, ctx);
      if (!lType || !rType) return false;
      if (stmt.op === "=") {
        checkAssign(lType, rType, stmt.rhs.line, stmt.rhs.col, ctx);
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
      return false;  // loop may not execute
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
      return false;
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
      return false;
    }

    case "switch": {
      const eType = inferExpr(stmt.expr, env, ctx);
      if (eType && !typeEq(eType, T_I32)) {
        errAt(ctx, `switch expression must be i32, got ${typeName(eType)}`,
          stmt.expr.line, stmt.expr.col);
      }
      let hasDefault = false;
      let allReturn  = true;
      ctx.inLoop++;  // break is valid inside switch
      for (const c of stmt.cases) {
        if (c.value === "default") hasDefault = true;
        else {
          const vType = inferExpr(c.value, env, ctx);
          if (vType && !typeEq(vType, T_I32)) {
            errAt(ctx, `case value must be i32, got ${typeName(vType)}`, c.line, c.col);
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
        const vType = inferExpr(stmt.value, env, ctx);
        if (vType) {
          if (isVoid(ctx.returnType)) {
            errAt(ctx, `void function cannot return a value`, stmt.line, stmt.col);
          } else if (!isAssignable(vType, ctx.returnType, ctx.structMap)) {
            const valSpan = stmt.value.kind === "binary" ?
              (stmt.value.left.kind === "ident" ? stmt.value.left.name.length : 1) + (stmt.value.op.length + 2) + (stmt.value.right.kind === "int" ? stmt.value.right.value.length : 1) :
              (stmt.value.kind === "ident" ? stmt.value.name.length : 1);
            const retHint = typeEq(vType, T_BOOL) && typeEq(ctx.returnType, T_I32) ?
              `use \`(${stmt.value.kind === "ident" ? (stmt.value as {name:string}).name : "expr"} > 0) as i32\` to convert` : undefined;
            errAt(ctx, `return: expected ${typeName(ctx.returnType)}, found ${typeName(vType)}`,
              stmt.value.line, stmt.value.col, valSpan,
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
      return true;  // terminates current path (jumps out)
    }

    case "continue": {
      if (ctx.inLoop === 0) {
        errAt(ctx, `'continue' outside loop`, stmt.line, stmt.col);
      }
      return true;
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
      const fields = allFields(baseType.name, ctx.structMap);
      const field = fields.find(f => f.name === lval.field);
      if (!field) {
        errAt(ctx, `struct '${baseType.name}' has no field '${lval.field}'`, lval.line, lval.col);
        return null;
      }
      if (writing) {
        // Check field const
        const entry = ctx.structMap.get(baseType.name);
        const structIsConst = entry?.structDecl.isConst ?? false;
        if (structIsConst || field.isConst) {
          errAt(ctx, `cannot write to const field '${lval.field}'`, lval.line, lval.col);
        }
        // Check base is not const (deep const)
        if (lvalIsConst(lval.base, env, ctx)) {
          errAt(ctx, `cannot write through const reference`, lval.line, lval.col);
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

/** Check whether an lvalue is accessed through a const chain. */
function lvalIsConst(lval: Lvalue, env: VarEnv, ctx: Ctx): boolean {
  switch (lval.kind) {
    case "lv-ident":  return env.get(lval.name)?.isConst ?? false;
    case "lv-field":  return lvalIsConst(lval.base, env, ctx);
    case "lv-index":  return lvalIsConst(lval.base, env, ctx);
    case "lv-unwrap": return lvalIsConst(lval.base, env, ctx);
  }
}

// ── Expression inference ──────────────────────────────────────────────────────

/**
 * Infer the type of an expression. Returns null and pushes an error if the
 * expression is ill-typed. Avoids cascading errors — callers should guard on null.
 */
function inferExpr(expr: Expr, env: VarEnv, ctx: Ctx): WacType | null {
  switch (expr.kind) {

    case "int": {
      try {
        const n = BigInt(expr.value);
        const I32_MAX =  2147483647n, I32_MIN = -2147483648n;
        const I64_MAX =  9223372036854775807n, I64_MIN = -9223372036854775808n;
        if (n >= I32_MIN && n <= I32_MAX) return T_I32;
        if (n >= I64_MIN && n <= I64_MAX) return T_I64;
        errAt(ctx, `integer literal out of range`, expr.line, expr.col);
        return null;
      } catch {
        errAt(ctx, `invalid integer literal '${expr.value}'`, expr.line, expr.col);
        return null;
      }
    }

    case "float": return T_F64;
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
        errAt(ctx, `'${expr.name}' is a ${scopeEntry.kind}, not a variable`, expr.line, expr.col);
        return null;
      }
      errAt(ctx, `undefined variable '${expr.name}'`, expr.line, expr.col);
      return null;
    }

    case "unary": {
      const t = inferExpr(expr.expr, env, ctx);
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
      const lt = inferExpr(expr.left, env, ctx);
      const rt = inferExpr(expr.right, env, ctx);
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
      const tt = inferExpr(expr.then, env, ctx);
      const et = inferExpr(expr.else_, env, ctx);
      if (!tt || !et) return tt ?? et;
      if (!typeEq(tt, et) && !isAssignable(et, tt, ctx.structMap) && !isAssignable(tt, et, ctx.structMap)) {
        errAt(ctx, `ternary branches have incompatible types: ${typeName(tt)} and ${typeName(et)}`,
          expr.line, expr.col);
        return tt;
      }
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
          const selfType: WacType = { kind: "struct", name: se.entry.name, line: 0, col: 0 };
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
    const fields2 = allFields(baseType.name, ctx.structMap);
    const fnField = fields2.find(f => f.name === methodName && f.type.kind === "funcref");
    if (fnField) {
      const fr = fnField.type as { kind: "funcref"; params: WacType[]; ret: WacType };
      return checkArgList(args, fr.params, fr.ret, expr, env, ctx);
    }

    const m = lookupMethod(baseType.name, methodName, ctx.structMap);
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
    const at = inferExpr(args[i], env, ctx);
    if (at) checkAssign(params[i], at, args[i].line, args[i].col, ctx);
  }
  // Extra args still inferred (for error reporting)
  for (let i = n; i < args.length; i++) inferExpr(args[i], env, ctx);
  return ret;
}

// ── Field access inference ────────────────────────────────────────────────────

function inferFieldAccess(
  baseExpr: Expr, fieldName: string,
  pos: { line: number; col: number },
  env: VarEnv, ctx: Ctx,
): WacType | null {
  // StructName.method — either a static method ref (error) or instance method ref (funcref value)
  if (baseExpr.kind === "ident") {
    const se = ctx.fileScope.get(baseExpr.name);
    if (se?.kind === "struct") {
      const m = lookupMethod(baseExpr.name, fieldName, ctx.structMap);
      if (m && m.origin.kind === "method" && m.origin.decl.hasThis) {
        // Instance method reference: Counter.inc → fn[void(Counter)] funcref
        const mdecl = m.origin.decl;
        const selfType: WacType = { kind: "struct", name: se.entry.name, line: 0, col: 0 };
        const allParams = [selfType, ...mdecl.params.map(p => p.type)];
        return { kind: "funcref", params: allParams, ret: mdecl.returnType, line: pos.line, col: pos.col };
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

  const fields = allFields(baseType.name, ctx.structMap);
  const field = fields.find(f => f.name === fieldName);
  if (!field) {
    // Could be a method accessed as value
    const m = lookupMethod(baseType.name, fieldName, ctx.structMap);
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
  // based on what Name resolves to in the file scope.
  if (!ctx.structMap.has(ctype.name)) {
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
    // If it's a struct name in scope but not in structMap — unresolved alias (shouldn't happen
    // if structMap was built with aliases; treat as error)
    if (se?.kind !== "struct") {
      errAt(ctx, `undefined function or struct '${ctype.name}'`, expr.line, expr.col);
      return null;
    }
  }

  const fields = allFields(ctype.name, ctx.structMap);

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
      const vt = inferExpr(val, env, ctx);
      if (vt) checkAssign(field.type, vt, val.line, val.col, ctx);
    }
  } else if (args.length === 0) {
    // Default construction: T()
    if (!structHasDefault(ctype.name, ctx.structMap, new Set())) {
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
      const at = inferExpr(args[i], env, ctx);
      if (at) checkAssign(fields[i].type, at, args[i].line, args[i].col, ctx);
    }
    for (let i = n; i < args.length; i++) inferExpr(args[i], env, ctx);
  }

  return structType(ctype.name);
}

function inferArrNew(
  expr: Expr & { kind: "arrNew" },
  env: VarEnv, ctx: Ctx,
): WacType | null {
  const { elem, size, fixed } = expr;

  if (fixed.length > 0) {
    // T[](e1, e2, ...) — fixed elements
    for (const e of fixed) {
      const et = inferExpr(e, env, ctx);
      if (et) checkAssign(elem, et, e.line, e.col, ctx);
    }
  } else if (size !== null) {
    // T[size]() — default construction; requires T has a default
    const st = inferExpr(size, env, ctx);
    if (st && !typeEq(st, T_I32)) {
      errAt(ctx, `array size must be i32, got ${typeName(st)}`, size.line, size.col);
    }
    if (!hasDefault(elem, ctx.structMap)) {
      errAt(ctx, `type '${typeName(elem)}' has no default value for array construction`,
        expr.line, expr.col);
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
  if (op === "<<" || op === ">>") {
    if (!isInteger(lt)) {
      errAt(ctx, `'${op}' requires i32 or i64, got ${typeName(lt)}`, line, col);
      return null;
    }
    if (!typeEq(lt, rt)) {
      // Special: i64 << i32 is allowed
      if (typeEq(lt, T_I64) && typeEq(rt, T_I32)) return T_I64;
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
  const casteeSpan = casteeExpr?.kind === "ident" ? casteeExpr.name.length : 1;

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
      if (isAssignable(from, to, ctx.structMap)) {
        if (op !== "as") {
          errAt(ctx, `upcast to '${tn}' is always safe — use 'as'`, line, col);
        }
        return to;
      }
      // Downcast: use 'as!'
      if (op !== "as!") {
        errAt(ctx, `downcast to '${tn}' may fail — use 'as!'`, line, col);
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
      errAt(ctx, `lossy cast not needed`, line, col, totalSpan,
        `${fn} -> ${tn} is lossless`,
        `use \`as\` instead of \`${op}\``);
    }
    return to;
  }

  if (isNarrowingNumericCast(fn, tn)) {
    if (op === "as") {
      errAt(ctx, `'${fn}' -> '${tn}' is lossy — use 'as!', 'as~', or 'as@'`, line, col);
    }
    return to;  // as!, as~, as@ are all valid for narrowing
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
         (fn === "i31ref" && tn === "i32");   // 31 bits always fit in 32
}

function isNarrowingNumericCast(fn: string | null, tn: string | null): boolean {
  if (!fn || !tn) return false;
  // Narrowing / lossy conversions: may use as!, as~, or as@
  return (fn === "i64"  && tn === "i32")  ||
         (fn === "f64"  && tn === "i32")  ||
         (fn === "f64"  && tn === "i64")  ||
         (fn === "f32"  && tn === "i32")  ||
         (fn === "f64"  && tn === "f32")  ||
         (fn === "i64"  && tn === "f64")  ||
         (fn === "i32"  && tn === "f32")  ||
         (fn === "i32"  && tn === "bool") ||
         (fn === "i32"  && tn === "i31ref");  // 31-bit, may overflow
}

// ── Type compatibility check (assignment / argument passing) ──────────────────

function checkAssign(
  expected: WacType, actual: WacType,
  line: number, col: number,
  ctx: Ctx,
  span = 1,
  annotation?: string,
  hint?: string,
): void {
  if (!isAssignable(actual, expected, ctx.structMap)) {
    const ann = annotation ?? `expected ${typeName(expected)}, found ${typeName(actual)}`;
    errAt(ctx,
      `type mismatch: expected ${typeName(expected)}, got ${typeName(actual)}`,
      line, col, span, ann, hint);
  }
}

// ── Const expression check (for deep const enforcement) ───────────────────────

/** Returns true if the expression is rooted in a const variable or const this. */
function exprIsConst(expr: Expr, env: VarEnv, ctx: Ctx): boolean {
  switch (expr.kind) {
    case "ident":  return env.get(expr.name)?.isConst ?? false;
    case "field":  return exprIsConst(expr.expr, env, ctx);
    case "unwrap": return exprIsConst(expr.expr, env, ctx);
    default:       return false;
  }
}

// ── Helper: is this AST node a WacType (vs an Expr)? ─────────────────────────

// WacType kinds: "prim" | "struct" | "array" | "nullable" | "funcref"
// Expr kinds never include these (Expr uses "ident", "binary", "call", etc.)
const WAC_TYPE_KINDS = new Set(["prim", "struct", "array", "nullable", "funcref"]);

function isWacType(x: unknown): x is WacType {
  return typeof x === "object" && x !== null && "kind" in x &&
    WAC_TYPE_KINDS.has((x as { kind: string }).kind);
}
