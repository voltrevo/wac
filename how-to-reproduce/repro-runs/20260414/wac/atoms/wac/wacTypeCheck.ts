// Type-checks a ResolvedModule: assigns a WacType to every Expr node and
// reports type errors. The emitter uses the exprType WeakMap to select the
// correct wasm instruction for each expression.
//
// Float literals are context-typed: f32 when the expected type is f32, f64
// otherwise. Int literals are always i32 (or i64 if value > 2^31−1). Small
// integer literals in i64 contexts still need explicit `as i64` casts.
//
// null: always used in a nullable context — type is inferred from the expected
// type. Reporting an error when null appears with no expected type.

import type { ResolvedModule, CompileError, NameEnv, ResolvedFunc } from "./wacResolve.ts";
import type {
  FuncDecl, StructDecl, MethodDecl, FieldDecl, Param,
  Block, Stmt, IfStmt, ForInit, ForUpdate, LVal, LValOp,
  Expr, WacType, BinOp, CompoundOp,
} from "./ast.ts";

// ---- Span helpers ----

// Minimal expression pretty-printer — used to generate hint text.
// Covers the common cases; complex sub-expressions fall back to "...".
function prettyExpr(expr: Expr): string {
  switch (expr.tag) {
    case "int":    return String(expr.value);
    case "int64":  return String(expr.value);
    case "float":  return String(expr.value);
    case "bool":   return expr.value ? "true" : "false";
    case "null":   return "null";
    case "ident":  return expr.name;
    case "binary": return `${prettyExpr(expr.left)} ${expr.op} ${prettyExpr(expr.right)}`;
    case "unary":  return `${expr.op}${prettyExpr(expr.operand)}`;
    case "cast":   return `${prettyExpr(expr.operand)} ${expr.op} ${typeStr(expr.toType)}`;
    case "paren":  return `(${prettyExpr(expr.expr)})`;
    default:       return "...";
  }
}

// Approximate source span for an expression — used for error underlines.
// For literals the span matches the source text; for complex expressions
// we compute recursively where possible, falling back to 1.
function exprSpan(expr: Expr): number {
  switch (expr.tag) {
    case "int":    return String(expr.value).length;
    case "int64":  return String(expr.value).length;
    case "float":  return String(expr.value).length;
    case "str":    return expr.value.length + 2;        // include surrounding quotes
    case "char":   return 3;                             // 'c'
    case "bool":   return expr.value ? 4 : 5;           // "true" / "false"
    case "null":   return 4;
    case "ident":  return expr.name.length;
    case "paren":  return exprSpan(expr.expr) + 2;
    case "cast":
      // "x as~ i64" → operand + space + op + space + type
      return exprSpan(expr.operand) + 1 + expr.op.length + 1 + typeStr(expr.toType).length;
    case "binary":
      // "a + b" → left + space + op + space + right
      return exprSpan(expr.left) + 1 + expr.op.length + 1 + exprSpan(expr.right);
    default:       return 1;
  }
}

// Approximate source span for an lvalue (name + all chained ops).
function lvalSpan(lval: LVal): number {
  let span = lval.name.length;
  for (const op of lval.ops) {
    if (op.tag === "field")  span += 1 + op.name.length;  // ".fieldname"
    else if (op.tag === "unwrap") span += 1;               // "!"
    else                     span += 3;                    // "[i]" approximate
  }
  return span;
}

// ---- Exported types ----

export type TypedModule = {
  resolved: ResolvedModule;
  // WacType for every Expr node (keyed by object identity)
  exprType: WeakMap<object, WacType>;
  errors: CompileError[];
};

// ---- All-paths-return analysis ----

// Returns true if every execution path through the block terminates with a return (or trap).
// Used to detect functions that are missing a return on some path.
function allPathsReturn(block: Block): boolean {
  for (const stmt of block.stmts) {
    if (stmtAlwaysReturns(stmt)) return true;
  }
  return false;
}

function stmtAlwaysReturns(stmt: Stmt): boolean {
  switch (stmt.tag) {
    case "return": case "trap": return true;
    case "if":
      // if + else: both branches must return.
      if (!stmt.else_) return false;
      const thenReturns = allPathsReturn(stmt.then);
      const elseReturns = "stmts" in stmt.else_
        ? allPathsReturn(stmt.else_)
        : stmtAlwaysReturns(stmt.else_);
      return thenReturns && elseReturns;
    case "block": return allPathsReturn(stmt.block);
    case "switch":
      // All cases (including default) must return; there must be a default.
      if (!stmt.default_) return false;
      const defaultReturns = stmt.default_.some(s => stmtAlwaysReturns(s));
      if (!defaultReturns) return false;
      return stmt.cases.every(c => c.body.some(s => stmtAlwaysReturns(s)));
    default: return false;
  }
}

// ---- Main export ----

export function wacTypeCheck(resolved: ResolvedModule): TypedModule {
  const exprType = new WeakMap<object, WacType>();
  const errors: CompileError[] = [];

  for (const [, rf] of resolved.funcs) {
    const env = resolved.envs.get(rf.filePath)!;
    new TypeChecker(resolved, env, exprType, errors, rf.filePath).checkFunc(rf.decl);
  }
  for (const [, rs] of resolved.structs) {
    const env = resolved.envs.get(rs.filePath)!;
    const tc = new TypeChecker(resolved, env, exprType, errors, rs.filePath);
    for (const method of rs.decl.methods) {
      tc.checkMethod(method, rs.decl);
    }
  }

  return { resolved, exprType, errors };
}

// ---- Type utilities ----

function typeEqual(a: WacType, b: WacType): boolean {
  if (a.tag !== b.tag) return false;
  if (a.tag === "named" && b.tag === "named") return a.name === b.name;
  if (a.tag === "array" && b.tag === "array") return typeEqual(a.elem, b.elem);
  if (a.tag === "nullable" && b.tag === "nullable") return typeEqual(a.inner, b.inner);
  if (a.tag === "funcref" && b.tag === "funcref") {
    return typeEqual(a.ret, b.ret) && a.params.length === b.params.length &&
      a.params.every((p, i) => typeEqual(p, b.params[i]!));
  }
  return true; // all other tags have no sub-structure
}

// Is `from` assignable to `to`? Handles T→T?, subtype→parent.
// Note: struct subtype checking requires the resolved module — see TypeChecker.typeAssignable().
function typeAssignable(from: WacType, to: WacType): boolean {
  if (typeEqual(from, to)) return true;
  // T is assignable to T?
  if (to.tag === "nullable" && typeEqual(from, to.inner)) return true;
  // anyref accepts any reference type
  if (to.tag === "anyref" && isRefType(from)) return true;
  return false;
}

function isRefType(t: WacType): boolean {
  switch (t.tag) {
    case "named": case "array": case "nullable": case "string":
    case "anyref": case "i31ref": case "funcref": return true;
    default: return false;
  }
}

function isNumericPrimitive(t: WacType): boolean {
  return t.tag === "i32" || t.tag === "i64" || t.tag === "f32" || t.tag === "f64";
}

function isIntegral(t: WacType): boolean {
  return t.tag === "i32" || t.tag === "i64";
}

function typeStr(t: WacType): string {
  // Strip the stem$ prefix from mangled struct names for human-readable messages.
  if (t.tag === "named") {
    const dollar = t.name.indexOf("$");
    return dollar >= 0 ? t.name.slice(dollar + 1) : t.name;
  }
  if (t.tag === "array") return `${typeStr(t.elem)}[]`;
  if (t.tag === "nullable") return `${typeStr(t.inner)}?`;
  if (t.tag === "funcref") return `fn[${typeStr(t.ret)}(${t.params.map(typeStr).join(", ")})]`;
  return t.tag;
}

// ---- TypeChecker class ----

type VarInfo = { type: WacType; isConst: boolean };

class TypeChecker {
  private scopes: Map<string, VarInfo>[] = [];
  private loopDepth = 0;  // tracks nesting depth of loops for break/continue validation

  constructor(
    private resolved: ResolvedModule,
    private env: NameEnv,
    private exprType: WeakMap<object, WacType>,
    private errors: CompileError[],
    private file: string,
  ) {}

  private pushScope(): void { this.scopes.push(new Map()); }
  private popScope(): void { this.scopes.pop(); }

  private declareVar(name: string, type: WacType, isConst: boolean): void {
    this.scopes[this.scopes.length - 1]!.set(name, { type, isConst });
  }

  private lookupVar(name: string): VarInfo | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i]!.get(name);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  private err(msg: string, line: number, col: number, span: number, annotation?: string, hint?: string): void {
    this.errors.push({ message: msg, file: this.file, line, col, phase: "typecheck", span, annotation, hint });
  }

  // Resolve a local struct name to its canonical (mangled) name via the file's env.
  // e.g., "Point" → "m$Point" or "Point2d" → "flat$Point"
  private resolveStructName(name: string): string {
    return this.env.structs.get(name) ?? name;
  }

  // Recursively resolve all named types in a WacType to their canonical forms.
  private resolveType(t: WacType): WacType {
    if (t.tag === "named") return { tag: "named", name: this.resolveStructName(t.name) };
    if (t.tag === "array") return { tag: "array", elem: this.resolveType(t.elem) };
    if (t.tag === "nullable") return { tag: "nullable", inner: this.resolveType(t.inner) };
    if (t.tag === "funcref") return { tag: "funcref", ret: this.resolveType(t.ret), params: t.params.map(p => this.resolveType(p)) };
    return t;
  }

  // Validate that a named type refers to a known struct.
  // Reports an "expected type" error (matching [§wac-diag-parse-bad-type-n7qm3xf]).
  private validateType(type: WacType, line: number, col: number): void {
    const resolved = this.resolveType(type);
    if (resolved.tag === "named" && !this.resolved.structs.has(resolved.name)) {
      const localName = type.tag === "named" ? type.name : (resolved as { name: string }).name;
      this.err("expected type", line, col, localName.length, `unknown type '${localName}'`);
    } else if (resolved.tag === "array") {
      this.validateType(type.tag === "array" ? type.elem : resolved, line, col);
    } else if (resolved.tag === "nullable") {
      this.validateType(type.tag === "nullable" ? type.inner : resolved, line, col);
    }
  }

  // ---- Assignability and subtyping ----

  // Get the canonical parent name of a struct given its canonical name.
  private canonicalParent(canonicalName: string): string | undefined {
    const rs = this.resolved.structs.get(canonicalName);
    if (!rs?.decl.parent) return undefined;
    // The parent name in decl is a local name in the struct's declaring file.
    const fileEnv = this.resolved.envs.get(rs.filePath);
    if (fileEnv) return fileEnv.structs.get(rs.decl.parent) ?? rs.decl.parent;
    return rs.decl.parent;
  }

  // Check if child struct is a subtype of parent (traverses inheritance chain).
  // Both names must be canonical.
  private isSubtypeOf(child: string, ancestor: string): boolean {
    if (child === ancestor) return true;
    const parent = this.canonicalParent(child);
    if (!parent) return false;
    return this.isSubtypeOf(parent, ancestor);
  }

  // Is `from` assignable to `to`? Extends the free function with struct subtyping.
  private typeAssignable(from: WacType, to: WacType): boolean {
    if (typeEqual(from, to)) return true;
    if (to.tag === "nullable" && typeEqual(from, to.inner)) return true;
    if (to.tag === "anyref" && isRefType(from)) return true;
    // Named → Named: subtype is assignable to supertype.
    if (from.tag === "named" && to.tag === "named") {
      return this.isSubtypeOf(from.name, to.name);
    }
    // Named subtype to nullable supertype: T is assignable to S? if T is subtype of S.
    if (to.tag === "nullable" && from.tag === "named" && to.inner.tag === "named") {
      return this.isSubtypeOf(from.name, to.inner.name);
    }
    return false;
  }

  // ---- Inheritance helpers ----

  // All fields from the full inheritance chain (parent fields first).
  // Accepts canonical struct name.
  private allFieldsOf(canonicalName: string): FieldDecl[] {
    const rs = this.resolved.structs.get(canonicalName);
    if (!rs) return [];
    const parent = this.canonicalParent(canonicalName);
    const inherited = parent ? this.allFieldsOf(parent) : [];
    return [...inherited, ...rs.decl.fields];
  }

  // All methods accessible on a struct (inherited + own, own shadows inherited).
  // Accepts canonical struct name.
  private allMethodsOf(canonicalName: string): MethodDecl[] {
    const rs = this.resolved.structs.get(canonicalName);
    if (!rs) return [];
    const parent = this.canonicalParent(canonicalName);
    const parentMethods = parent ? this.allMethodsOf(parent) : [];
    const ownNames = new Set(rs.decl.methods.map(m => m.name));
    return [...parentMethods.filter(m => !ownNames.has(m.name)), ...rs.decl.methods];
  }

  // Check if a struct can be default-constructed (all fields have a default value).
  // `seen` prevents infinite recursion through self-referential struct types.
  private canDefaultConstruct(canonicalName: string, seen: Set<string>): boolean {
    if (seen.has(canonicalName)) return false;  // cycle → not defaultable
    seen.add(canonicalName);
    const fields = this.allFieldsOf(canonicalName);
    for (const f of fields) {
      if (!this.isTypeDefaultable(this.resolveType(f.type), seen)) return false;
    }
    seen.delete(canonicalName);
    return true;
  }

  private isTypeDefaultable(t: WacType, seen: Set<string>): boolean {
    switch (t.tag) {
      case "i32": case "i64": case "f32": case "f64": case "bool":
      case "i8": case "i16":
      case "nullable": case "anyref": case "i31ref":
        return true;
      case "named":
        return this.canDefaultConstruct(t.name, seen);
      default:
        return false;  // arrays, strings, funcrefs without nullable wrapper
    }
  }

  // ---- Function / method entry points ----

  checkFunc(func: FuncDecl): void {
    this.pushScope();
    for (const p of func.params) {
      this.declareVar(p.name, this.resolveType(p.type), false);
    }
    const retType = this.resolveType(func.returnType);
    this.checkBlock(func.body, retType);
    if (retType.tag !== "void" && !allPathsReturn(func.body)) {
      this.err("not all code paths return a value", func.line, func.col, func.name.length);
    }
    this.popScope();
  }

  checkMethod(method: MethodDecl, struct: StructDecl): void {
    // Override validation (non-static methods only).
    if (method.thisParam !== undefined) {
      // Resolve the struct name to canonical before looking up parent methods.
      const canonicalName = this.resolveStructName(struct.name);
      const canonicalParentName = struct.parent ? this.canonicalParent(canonicalName) : undefined;
      const parentMethods = canonicalParentName ? this.allMethodsOf(canonicalParentName) : [];
      const hasParentMethod = parentMethods.some(m => m.name === method.name);
      if (method.isOverride && !hasParentMethod) {
        this.err(`'${method.name}' does not override any parent method`,
          method.line, method.col, method.name.length);
      }
      if (!method.isOverride && hasParentMethod) {
        this.err(`'${method.name}' hides parent method — use 'override' keyword`,
          method.line, method.col, method.name.length);
      }
    }
    this.pushScope();
    if (method.thisParam !== undefined) {
      // Use canonical struct name for 'this' type so downstream lookups work.
      const structType: WacType = { tag: "named", name: this.resolveStructName(struct.name) };
      const isConst = method.thisParam === "const" || struct.isConst;
      this.declareVar("this", structType, isConst);
    }
    for (const p of method.params) {
      this.declareVar(p.name, this.resolveType(p.type), false);
    }
    const retType = this.resolveType(method.returnType);
    this.checkBlock(method.body, retType);
    if (retType.tag !== "void" && !allPathsReturn(method.body)) {
      this.err("not all code paths return a value", method.line, method.col, method.name.length);
    }
    this.popScope();
  }

  // ---- Block / statement checking ----

  private checkBlock(block: Block, returnType: WacType): void {
    this.pushScope();
    for (const stmt of block.stmts) {
      this.checkStmt(stmt, returnType);
    }
    this.popScope();
  }

  private checkStmt(stmt: Stmt, returnType: WacType): void {
    switch (stmt.tag) {
      case "var": {
        const declType = this.resolveType(stmt.type);
        this.validateType(declType, stmt.line, stmt.col);
        const initType = this.checkExpr(stmt.init, declType);
        if (!this.typeAssignable(initType, declType)) {
          // Nullable-to-non-null: special message and hint
          const nullableToNonNull =
            initType.tag === "nullable" &&
            declType.tag !== "nullable" &&
            typeEqual((initType as { tag: "nullable"; inner: WacType }).inner, declType);
          const message = nullableToNonNull
            ? "cannot assign nullable to non-null"
            : "type mismatch in assignment";
          const hint = nullableToNonNull
            ? (stmt.init.tag === "ident"
                ? `unwrap with \`!\`: ${typeStr(declType)} ${stmt.name} = ${stmt.init.name}!;`
                : `unwrap with \`!\``)
            : (initType.tag === "f64" && declType.tag === "f32" ? undefined
               : (isNumericPrimitive(initType) && isNumericPrimitive(declType)
                  ? "use `as!` for checked conversion or `as~` for truncation"
                  : undefined));
          // Point the error at the init expression, not the declaration keyword
          this.err(message, stmt.init.line, stmt.init.col, exprSpan(stmt.init),
            `expected ${typeStr(declType)}, found ${typeStr(initType)}`, hint);
        }
        this.declareVar(stmt.name, declType, stmt.isConst);
        break;
      }
      case "assign": {
        const [lvalType, lvalConst] = this.checkLVal(stmt.lval);
        if (lvalConst) {
          this.err("cannot write through const reference", stmt.line, stmt.col,
            lvalSpan(stmt.lval), `${stmt.lval.name} is const`);
        }
        const rhsType = this.checkExpr(stmt.rhs, lvalType);
        if (!this.typeAssignable(rhsType, lvalType)) {
          this.err("type mismatch in assignment", stmt.line, stmt.col,
            lvalSpan(stmt.lval), `expected ${typeStr(lvalType)}, found ${typeStr(rhsType)}`);
        }
        break;
      }
      case "compound": {
        const [lvalType, lvalConst] = this.checkLVal(stmt.lval);
        if (lvalConst) {
          this.err("cannot write through const reference", stmt.line, stmt.col,
            lvalSpan(stmt.lval), `${stmt.lval.name} is const`);
        }
        const rhsType = this.checkExpr(stmt.rhs, lvalType);
        this.checkCompoundOp(stmt.op, lvalType, rhsType, stmt.line, stmt.col);
        break;
      }
      case "incr": {
        const [lvalType, lvalConst] = this.checkLVal(stmt.lval);
        if (lvalConst) {
          this.err("cannot apply ++ or -- to const", stmt.line, stmt.col,
            lvalSpan(stmt.lval), `${stmt.lval.name} is const`);
        }
        if (!isIntegral(lvalType)) {
          this.err("++ and -- require i32 or i64", stmt.line, stmt.col, stmt.op.length,
            `found ${typeStr(lvalType)}`);
        }
        break;
      }
      case "if": {
        const condType = this.checkExpr(stmt.cond);
        if (!typeEqual(condType, { tag: "bool" })) {
          this.err("condition must be bool", stmt.cond.line, stmt.cond.col, 1,
            `expected bool, found ${typeStr(condType)}`,
            condType.tag === "i32" ? "use a comparison: if (x != 0) { ... }" : undefined);
        }
        this.checkBlock(stmt.then, returnType);
        if (stmt.else_) {
          if ("stmts" in stmt.else_) {
            this.checkBlock(stmt.else_, returnType);
          } else {
            this.checkStmt(stmt.else_, returnType);
          }
        }
        break;
      }
      case "while": {
        const condType = this.checkExpr(stmt.cond);
        if (!typeEqual(condType, { tag: "bool" })) {
          this.err("condition must be bool", stmt.cond.line, stmt.cond.col, 1,
            `expected bool, found ${typeStr(condType)}`);
        }
        this.loopDepth++;
        this.checkBlock(stmt.body, returnType);
        this.loopDepth--;
        break;
      }
      case "for": {
        this.pushScope();
        if (stmt.init) this.checkForInit(stmt.init);
        if (stmt.cond) {
          const ct = this.checkExpr(stmt.cond);
          if (!typeEqual(ct, { tag: "bool" })) {
            this.err("for condition must be bool", stmt.cond.line, stmt.cond.col, 1,
              `expected bool, found ${typeStr(ct)}`);
          }
        }
        if (stmt.update) this.checkForUpdate(stmt.update);
        this.loopDepth++;
        this.checkBlock(stmt.body, returnType);
        this.loopDepth--;
        this.popScope();
        break;
      }
      case "dowhile": {
        this.loopDepth++;
        this.checkBlock(stmt.body, returnType);
        this.loopDepth--;
        const ct = this.checkExpr(stmt.cond);
        if (!typeEqual(ct, { tag: "bool" })) {
          this.err("condition must be bool", stmt.cond.line, stmt.cond.col, 1,
            `expected bool, found ${typeStr(ct)}`);
        }
        break;
      }
      case "switch": {
        const exprType = this.checkExpr(stmt.expr);
        this.loopDepth++;  // break is valid inside switch cases
        for (const c of stmt.cases) {
          this.checkExpr(c.value, exprType);
          for (const s of c.body) this.checkStmt(s, returnType);
        }
        if (stmt.default_) {
          for (const s of stmt.default_) this.checkStmt(s, returnType);
        }
        this.loopDepth--;
        break;
      }
      case "return": {
        if (stmt.value) {
          const vt = this.checkExpr(stmt.value, returnType);
          if (!this.typeAssignable(vt, returnType)) {
            // Bool-to-integer: suggest explicit cast
            const retHint = vt.tag === "bool" && isIntegral(returnType)
              ? `use \`(${prettyExpr(stmt.value)}) as ${typeStr(returnType)}\` to convert`
              : undefined;
            this.err(`return: expected ${typeStr(returnType)}, found ${typeStr(vt)}`,
              stmt.value.line, stmt.value.col, exprSpan(stmt.value),
              `expected ${typeStr(returnType)}, found ${typeStr(vt)}`, retHint);
          }
        } else if (returnType.tag !== "void") {
          this.err("missing return value", stmt.line, stmt.col, 6);
        }
        break;
      }
      case "break":
        if (this.loopDepth === 0) this.err("break outside loop", stmt.line, stmt.col, 5);
        break;
      case "continue":
        if (this.loopDepth === 0) this.err("continue outside loop", stmt.line, stmt.col, 8);
        break;
      case "trap":
        break;  // always valid structurally
      case "block":
        this.checkBlock(stmt.block, returnType);
        break;
      case "expr":
        this.checkExpr(stmt.expr);
        break;
    }
  }

  private checkForInit(init: ForInit): void {
    if (init.tag === "var") {
      const initDeclType = this.resolveType(init.type);
      const t = this.checkExpr(init.init, initDeclType);
      if (!this.typeAssignable(t, initDeclType)) {
        this.err("type mismatch in for init", init.line, init.col, init.name.length,
          `expected ${typeStr(initDeclType)}, found ${typeStr(t)}`);
      }
      this.declareVar(init.name, initDeclType, init.isConst);
    } else {
      const [lvt, lvc] = this.checkLVal(init.lval);
      if (lvc) this.err("cannot assign to const in for init", init.line, init.col, 1);
      const rt = this.checkExpr(init.rhs, lvt);
      if (!this.typeAssignable(rt, lvt)) {
        this.err("type mismatch in for init assign", init.line, init.col, 1,
          `expected ${typeStr(lvt)}, found ${typeStr(rt)}`);
      }
    }
  }

  private checkForUpdate(update: ForUpdate): void {
    if (update.tag === "incr") {
      const [lvt, lvc] = this.checkLVal(update.lval);
      if (lvc) this.err("cannot apply ++ to const", update.line, update.col, 2);
      if (!isIntegral(lvt)) {
        this.err("++ and -- require i32 or i64", update.line, update.col, 2);
      }
    } else if (update.tag === "assign") {
      const [lvt, lvc] = this.checkLVal(update.lval);
      if (lvc) this.err("cannot assign to const in for update", update.line, update.col, 1);
      const rt = this.checkExpr(update.rhs, lvt);
      if (!this.typeAssignable(rt, lvt)) {
        this.err("type mismatch in for update", update.line, update.col, 1);
      }
    } else {
      // compound
      const [lvt, lvc] = this.checkLVal(update.lval);
      if (lvc) this.err("cannot assign to const in for update", update.line, update.col, 1);
      const rt = this.checkExpr(update.rhs, lvt);
      this.checkCompoundOp(update.op, lvt, rt, update.line, update.col);
    }
  }

  // ---- LVal checking ----

  // Returns [type, isConst] of the lvalue
  private checkLVal(lval: LVal): [WacType, boolean] {
    const v = this.lookupVar(lval.name);
    if (!v) {
      this.err(`undefined variable '${lval.name}'`, lval.line, lval.col, lval.name.length);
      return [{ tag: "i32" }, false];
    }
    let type: WacType = v.type;
    let isConst = v.isConst;

    for (const op of lval.ops) {
      if (op.tag === "unwrap") {
        if (type.tag !== "nullable") {
          this.err("unwrap '!' on non-nullable type", lval.line, lval.col, 1);
          break;
        }
        type = type.inner;
        // const stays the same after unwrap
      } else if (op.tag === "field") {
        const resolved = this.resolveStructType(type);
        if (!resolved) {
          this.err(`field access on non-struct type '${typeStr(type)}'`, lval.line, lval.col,
            op.name.length);
          break;
        }
        // Search all fields including inherited.
        const allFields = this.allFieldsOf(resolved.canonicalName);
        const field = allFields.find(f => f.name === op.name);
        if (!field) {
          this.err(`unknown field '${op.name}' on '${resolved.decl.name}'`, lval.line, lval.col,
            op.name.length);
          break;
        }
        if (field.isConst || isConst || resolved.decl.isConst) {
          isConst = true;
        }
        type = this.resolveType(field.type);
      } else {
        // index
        if (type.tag === "string") {
          this.err("strings are immutable", lval.line, lval.col, 1);
          break;
        }
        if (type.tag !== "array") {
          this.err("index on non-array type", lval.line, lval.col, 1);
          break;
        }
        this.checkExpr(op.idx);
        // Packed types (i8, i16) are stored/loaded as i32 at source level.
        const elem = type.elem;
        type = (elem.tag === "i8" || elem.tag === "i16") ? { tag: "i32" } : elem;
      }
    }
    return [type, isConst];
  }

  // ---- Expression checking ----

  checkExpr(expr: Expr, expected?: WacType): WacType {
    const type = this.inferExpr(expr, expected);
    this.exprType.set(expr, type);
    return type;
  }

  private inferExpr(expr: Expr, expected?: WacType): WacType {
    switch (expr.tag) {
      case "int":    return { tag: "i32" };
      case "int64":  return { tag: "i64" };
      case "float":  return expected?.tag === "f32" ? { tag: "f32" } : { tag: "f64" };
      case "str":    return { tag: "string" };
      case "char":   return { tag: "i32" };
      case "bool":   return { tag: "bool" };
      case "null": {
        if (expected?.tag === "nullable") return expected;
        if (expected?.tag === "anyref") return { tag: "anyref" };
        this.err("cannot infer type of null", expr.line, expr.col, 4,
          "add an explicit type annotation");
        return { tag: "nullable", inner: { tag: "i32" } };
      }
      case "ident": return this.inferIdent(expr.name, expr.line, expr.col, expected);
      case "unary":  return this.inferUnary(expr.op, expr.operand, expr.line, expr.col);
      case "binary": return this.inferBinary(expr.op, expr.left, expr.right, expr.line, expr.col);
      case "cast":   return this.inferCast(expr.op, expr.operand, expr.toType, expr.line, expr.col);
      case "is":     return this.inferIs(expr, expr.line, expr.col);
      case "ternary": {
        const ct = this.checkExpr(expr.cond);
        if (!typeEqual(ct, { tag: "bool" })) {
          this.err("ternary condition must be bool", expr.cond.line, expr.cond.col, 1,
            `expected bool, found ${typeStr(ct)}`);
        }
        const thenType = this.checkExpr(expr.then, expected);
        this.checkExpr(expr.else_, expected !== undefined ? expected : thenType);
        return thenType;
      }
      case "call":    return this.inferCall(expr);
      case "construct": return this.inferConstruct(expr);
      case "array_new": return this.inferArrayNew(expr);
      case "field":   return this.inferFieldAccess(expr);
      case "method":  return this.inferMethodCall(expr);
      case "index":   return this.inferIndex(expr);
      case "unwrap": {
        const t = this.checkExpr(expr.operand);
        if (t.tag !== "nullable") {
          this.err("unwrap '!' applied to non-nullable type", expr.line, expr.col, 1,
            `found ${typeStr(t)}`);
          return t;
        }
        return t.inner;
      }
      case "paren":    return this.checkExpr(expr.expr, expected);
      case "fnref":    return this.inferFnRef(expr);
      case "callexpr": return this.inferCallExpr(expr);
    }
  }

  private inferIdent(name: string, line: number, col: number, expected?: WacType): WacType {
    const v = this.lookupVar(name);
    if (v) return v.type;
    // Could be a zero-arg function reference in expression context
    const mangledFn = this.env.funcs.get(name);
    if (mangledFn) {
      const rf = this.resolved.funcs.get(mangledFn);
      if (rf) return { tag: "funcref", ret: rf.decl.returnType, params: rf.decl.params.map(p => p.type) };
    }
    // Use context to give a more helpful error: funcref context means the user expected a function
    if (expected?.tag === "funcref") {
      this.err(`undefined function '${name}'`, line, col, name.length);
    } else {
      this.err(`undefined identifier '${name}'`, line, col, name.length);
    }
    return { tag: "i32" };
  }

  private inferUnary(op: "-" | "!" | "~", operand: Expr, line: number, col: number): WacType {
    const t = this.checkExpr(operand);
    if (op === "!") {
      if (!typeEqual(t, { tag: "bool" })) {
        this.err("'!' requires bool operand", line, col, 1, `found ${typeStr(t)}`);
      }
      return { tag: "bool" };
    }
    if (op === "~") {
      if (!isIntegral(t)) {
        this.err("'~' requires i32 or i64", line, col, 1, `found ${typeStr(t)}`);
      }
      return t;
    }
    // op === "-"
    if (!isNumericPrimitive(t)) {
      this.err("unary '-' requires numeric type", line, col, 1, `found ${typeStr(t)}`);
      return { tag: "i32" };
    }
    return t;
  }

  private inferBinary(op: BinOp, left: Expr, right: Expr, line: number, col: number): WacType {
    const lt = this.checkExpr(left);
    const rt = this.checkExpr(right, lt);  // hint right with left's type for float inference
    return this.checkBinaryTypes(op, lt, rt, line, col);
  }

  // Type-level binary check — used by both inferBinary and checkCompoundOp.
  private checkBinaryTypes(op: BinOp, lt: WacType, rt: WacType, line: number, col: number): WacType {
    // String concatenation
    if (op === "+" && lt.tag === "string" && rt.tag === "string") {
      return { tag: "string" };
    }
    // String comparison
    if (lt.tag === "string" && rt.tag === "string") {
      if (op === "==" || op === "!=" || op === "<" || op === "<=" || op === ">" || op === ">=") {
        return { tag: "bool" };
      }
    }

    if (op === "&&" || op === "||") {
      if (!typeEqual(lt, { tag: "bool" })) {
        this.err(`'${op}' requires bool operands`, line, col, op.length, `left operand is ${typeStr(lt)}`);
      }
      if (!typeEqual(rt, { tag: "bool" })) {
        this.err(`'${op}' requires bool operands`, line, col, op.length, `right operand is ${typeStr(rt)}`);
      }
      return { tag: "bool" };
    }

    if (op === "==" || op === "!=" || op === "<" || op === "<=" || op === ">" || op === ">=") {
      if (!typeEqual(lt, rt)) {
        this.err(`comparison type mismatch: ${typeStr(lt)} vs ${typeStr(rt)}`, line, col, op.length);
      }
      if (!isNumericPrimitive(lt) && !typeEqual(lt, { tag: "bool" })) {
        this.err(`'${op}' not allowed on reference types`, line, col, op.length, `found ${typeStr(lt)}`);
      }
      return { tag: "bool" };
    }

    if (op === "+" || op === "-" || op === "*" || op === "/" || op === "%") {
      if (typeEqual(lt, { tag: "bool" }) || typeEqual(rt, { tag: "bool" })) {
        this.err("arithmetic not allowed on bool", line, col, op.length);
        return { tag: "i32" };
      }
      if (!isNumericPrimitive(lt)) {
        this.err(`'${op}' requires numeric type, found ${typeStr(lt)}`, line, col, op.length);
        return { tag: "i32" };
      }
      if (!typeEqual(lt, rt)) {
        this.err(`type mismatch: ${typeStr(lt)} ${op} ${typeStr(rt)}`, line, col, op.length);
      }
      return lt;
    }

    if (op === "&" || op === "|" || op === "^") {
      if (!isIntegral(lt)) {
        this.err(`'${op}' requires i32 or i64`, line, col, op.length, `found ${typeStr(lt)}`);
        return { tag: "i32" };
      }
      if (!typeEqual(lt, rt)) {
        this.err(`type mismatch: ${typeStr(lt)} ${op} ${typeStr(rt)}`, line, col, op.length);
      }
      return lt;
    }

    // op === "<<" | ">>"
    if (!isIntegral(lt)) {
      this.err(`'${op}' requires i32 or i64`, line, col, op.length, `found ${typeStr(lt)}`);
      return { tag: "i32" };
    }
    // Allow i64 << i32 as special case
    if (!typeEqual(lt, rt) && !(lt.tag === "i64" && rt.tag === "i32")) {
      this.err(`shift type mismatch: ${typeStr(lt)} ${op} ${typeStr(rt)}`, line, col, op.length);
    }
    return lt;
  }

  private checkCompoundOp(op: CompoundOp, lvalType: WacType, rhsType: WacType, line: number, col: number): void {
    const base = op.replace("=", "") as BinOp;
    this.checkBinaryTypes(base, lvalType, rhsType, line, col);
  }

  private inferCast(op: "as" | "as!" | "as~" | "as@", operand: Expr, toType: WacType, line: number, col: number): WacType {
    const fromType = this.checkExpr(operand);
    // Span covers the full cast expression: "operand op toType"
    const castSpan = exprSpan(operand) + 1 + op.length + 1 + typeStr(toType).length;
    // Validate cast validity (basic checks)
    if (isNumericPrimitive(fromType) || typeEqual(fromType, { tag: "bool" })) {
      if (isNumericPrimitive(toType) || typeEqual(toType, { tag: "bool" })) {
        // Numeric/bool cast — validate op selection
        this.validateNumericCast(op, fromType, toType, line, col, castSpan);
      } else if (toType.tag === "i31ref") {
        // Numeric → i31ref: requires as!
        if (op !== "as!") {
          this.err("use `as!` to convert to i31ref", line, col, castSpan,
            `found '${op}', expected 'as!'`);
        }
      }
    } else if (isRefType(fromType)) {
      const resolvedTo = this.resolveType(toType);
      // Reference cast
      if (op === "as") {
        // Downcasting ref types requires `as!` (checked) not `as` (lossless upcast only).
        if (fromType.tag === "named" && resolvedTo.tag === "named") {
          if (this.isSubtypeOf(resolvedTo.name, fromType.name) && resolvedTo.name !== fromType.name) {
            this.err("use `as!` for ref type downcast", line, col, castSpan,
              `'${resolvedTo.name}' is a subtype of '${fromType.name}' — use 'as!' for downcast`);
          }
        }
      }
      if (toType.tag === "i32" && fromType.tag === "i31ref") {
        // i31ref → i32: lossless, use as
        if (op !== "as") {
          this.err("use `as` to extract i32 from i31ref", line, col, castSpan,
            "i31ref → i32 is lossless");
        }
      }
    }
    return this.resolveType(toType);
  }

  private validateNumericCast(op: "as" | "as!" | "as~" | "as@", from: WacType, to: WacType, line: number, col: number, span: number): void {
    // Determine if from→to is lossless (use `as`), lossy-checked (as!), nearest (as~), or raw (as@)
    const lossless = isLosslessCast(from, to);
    if (lossless) {
      if (op !== "as") {
        this.err("lossy cast not needed", line, col, span,
          `${typeStr(from)} -> ${typeStr(to)} is lossless`,
          `use \`as\` instead: ${typeStr(to)} a = x as ${typeStr(to)};`);
      }
    }
    // For non-lossless numeric casts, any of as!/as~/as@ is valid (different semantics)
  }

  private inferIs(expr: Extract<Expr, { tag: "is" }>, line: number, col: number): WacType {
    this.checkExpr(expr.operand);
    if (typeof expr.checkType !== "string") {
      if ("tag" in expr.checkType) {
        // Type check test — just verify the type is valid (it is, from parser)
      }
    }
    return { tag: "bool" };
  }

  private inferCall(expr: Extract<Expr, { tag: "call" }>): WacType {
    // Check if it's a call through a funcref local variable
    if (!expr.typeQual) {
      const fv = this.lookupVar(expr.func);
      if (fv && fv.type.tag === "funcref") {
        const ft = fv.type;
        this.checkCallArgs(expr.args, ft.params.map((p, i) => ({ name: `arg${i}`, type: p, line: 0, col: 0 })), expr.line, expr.col);
        return ft.ret;
      }
    }

    if (expr.typeQual) {
      // Static method call: StructName.methodName(args) — methods live in struct decl, not resolved.funcs
      const canonicalQual = this.resolveStructName(expr.typeQual);
      const rs = this.resolved.structs.get(canonicalQual);
      if (rs) {
        const method = rs.decl.methods.find(m => m.name === expr.func);
        if (method) {
          this.checkCallArgs(expr.args, method.params, expr.line, expr.col);
          return this.resolveType(method.returnType);
        }
      }
      this.err(`undefined function '${expr.func}'`, expr.line, expr.col, expr.func.length);
      for (const a of expr.args) this.checkExpr(a);
      return { tag: "i32" };
    }

    // Check if it's a struct constructor call: Counter(n) or P()
    const canonicalConstructName = this.resolveStructName(expr.func);
    const rs = this.resolved.structs.get(canonicalConstructName);
    if (rs) {
      if (expr.args.length === 0) {
        // Default construction — validate that all fields are defaultable.
        if (!this.canDefaultConstruct(canonicalConstructName, new Set())) {
          this.err(`'${expr.func}()': struct has non-defaultable field — use explicit constructor`,
            expr.line, expr.col, expr.func.length);
        }
        return { tag: "named", name: canonicalConstructName };
      }
      // Positional construction — requires all fields (including inherited) in order.
      const fields = this.allFieldsOf(canonicalConstructName);
      if (expr.args.length !== fields.length) {
        this.err(
          `wrong number of arguments for '${expr.func}': expected ${fields.length}, got ${expr.args.length}`,
          expr.line, expr.col, expr.func.length);
      }
      for (let i = 0; i < expr.args.length; i++) {
        const ft = fields[i] ? this.resolveType(fields[i]!.type) : undefined;
        const at = this.checkExpr(expr.args[i]!, ft);
        if (ft && !this.typeAssignable(at, ft)) {
          this.err(`argument type mismatch for field '${fields[i]!.name}'`,
            expr.args[i]!.line, expr.args[i]!.col, 1,
            `expected ${typeStr(ft)}, found ${typeStr(at)}`);
        }
      }
      return { tag: "named", name: canonicalConstructName };
    }

    // Regular function call
    const mangledName = this.env.funcs.get(expr.func);
    const rf = mangledName ? this.resolved.funcs.get(mangledName) : undefined;
    if (!rf) {
      // If the name looks like a struct (uppercase-first) and wasn't found, report as undefined struct
      if (/^[A-Z]/.test(expr.func)) {
        this.err(`undefined struct '${expr.func}'`, expr.line, expr.col, expr.func.length);
      } else {
        this.err(`undefined function '${expr.func}'`, expr.line, expr.col, expr.func.length);
      }
      for (const a of expr.args) this.checkExpr(a);
      return { tag: "i32" };
    }
    this.checkCallArgs(expr.args, rf.decl.params, expr.line, expr.col);
    return this.resolveType(rf.decl.returnType);
  }

  private inferConstruct(expr: Extract<Expr, { tag: "construct" }>): WacType {
    const canonicalName = this.resolveStructName(expr.name);
    const rs = this.resolved.structs.get(canonicalName);
    if (!rs) {
      this.err(`undefined struct '${expr.name}'`, expr.line, expr.col, expr.name.length);
      return { tag: "named", name: canonicalName };
    }

    // All fields including inherited (named construction must supply all fields).
    const allFields = this.allFieldsOf(canonicalName);
    if (expr.form === "named") {
      // Validate each supplied field init against all fields (own + inherited).
      for (const init of expr.fields!) {
        const field = allFields.find(f => f.name === init.name);
        if (!field) {
          this.err(`unknown field '${init.name}'`, init.line, init.col, init.name.length);
          this.checkExpr(init.value);
        } else {
          const ft = this.resolveType(field.type);
          const vt = this.checkExpr(init.value, ft);
          if (!this.typeAssignable(vt, ft)) {
            this.err(`field '${init.name}' type mismatch`, init.line, init.col, init.name.length, `expected ${typeStr(ft)}, found ${typeStr(vt)}`);
          }
        }
      }
    }
    // else: default construction (P {}) — no field init checking needed
    return { tag: "named", name: canonicalName };
  }

  private inferArrayNew(expr: Extract<Expr, { tag: "array_new" }>): WacType {
    const elemType = this.resolveType(expr.elemType);
    if (expr.size) this.checkExpr(expr.size);
    if (expr.elems) {
      for (const e of expr.elems) this.checkExpr(e, elemType);
    }
    return { tag: "array", elem: elemType };
  }

  private inferFieldAccess(expr: Extract<Expr, { tag: "field" }>): WacType {
    const objType = this.checkExpr(expr.object);
    const resolved = this.resolveStructType(objType);
    if (!resolved) {
      this.err(`field access on non-struct type '${typeStr(objType)}'`,
        expr.line, expr.col, expr.name.length);
      return { tag: "i32" };
    }
    // Search all fields including inherited.
    const allFields = this.allFieldsOf(resolved.canonicalName);
    const field = allFields.find(f => f.name === expr.name);
    if (!field) {
      this.err(`unknown field '${expr.name}' on '${resolved.decl.name}'`,
        expr.line, expr.col, expr.name.length);
      return { tag: "i32" };
    }
    return this.resolveType(field.type);
  }

  private inferMethodCall(expr: Extract<Expr, { tag: "method" }>): WacType {
    const objType = this.checkExpr(expr.object);
    const actual = objType.tag === "nullable" ? objType.inner : objType;

    // String-specific methods (before generic struct lookup)
    if (actual.tag === "string") {
      if (expr.name === "len" && expr.args.length === 0) return { tag: "i32" };
      if (expr.name === "slice" && expr.args.length === 2) {
        const a0 = this.checkExpr(expr.args[0]!, { tag: "i32" });
        const a1 = this.checkExpr(expr.args[1]!, { tag: "i32" });
        if (!typeEqual(a0, { tag: "i32" })) this.err("slice: start must be i32", expr.args[0]!.line, expr.args[0]!.col, 1);
        if (!typeEqual(a1, { tag: "i32" })) this.err("slice: end must be i32", expr.args[1]!.line, expr.args[1]!.col, 1);
        return { tag: "string" };
      }
      if (expr.name === "indexOf" && expr.args.length === 1) {
        const a0 = this.checkExpr(expr.args[0]!, { tag: "string" });
        if (!typeEqual(a0, { tag: "string" })) this.err("indexOf: arg must be string", expr.args[0]!.line, expr.args[0]!.col, 1);
        return { tag: "i32" };
      }
      this.err(`unknown method '${expr.name}' on string`, expr.line, expr.col, expr.name.length);
      for (const a of expr.args) this.checkExpr(a);
      return { tag: "i32" };
    }

    // Special built-in methods: .len() on array
    if (expr.name === "len" && expr.args.length === 0) {
      if (actual.tag === "array") {
        return { tag: "i32" };
      }
    }

    const resolved = this.resolveStructType(actual);
    if (!resolved) {
      this.err(`method call on non-struct type '${typeStr(objType)}'`, expr.line, expr.col, expr.name.length);
      for (const a of expr.args) this.checkExpr(a);
      return { tag: "i32" };
    }
    // Check if name is a funcref field (calling a stored function reference)
    const allFields = this.allFieldsOf(resolved.canonicalName);
    const fnField = allFields.find(f => f.name === expr.name && f.type.tag === "funcref");
    if (fnField) {
      const ft = fnField.type as Extract<typeof fnField.type, { tag: "funcref" }>;
      this.checkCallArgs(expr.args, ft.params.map((p, i) => ({ name: `arg${i}`, type: p, line: 0, col: 0 })), expr.line, expr.col);
      return this.resolveType(ft.ret);
    }
    // Search all methods including inherited.
    const allMethods = this.allMethodsOf(resolved.canonicalName);
    const method = allMethods.find(m => m.name === expr.name);
    if (!method) {
      this.err(`unknown method '${expr.name}' on '${resolved.decl.name}'`, expr.line, expr.col, expr.name.length);
      for (const a of expr.args) this.checkExpr(a);
      return { tag: "i32" };
    }
    // If the object expression is const, only const methods may be called.
    const objIsConst = this.isExprConst(expr.object, objType);
    const methodIsConst = method.thisParam === "const";
    if (objIsConst && !methodIsConst) {
      this.err(`cannot call non-const method '${method.name}' through const reference`, expr.line, expr.col, expr.name.length);
    }
    this.checkCallArgs(expr.args, method.params, expr.line, expr.col);
    return this.resolveType(method.returnType);
  }

  // Determines if an expression yields a const reference.
  // Only ident/field/unwrap chains can be const — computed values are not.
  private isExprConst(expr: Expr, type: WacType): boolean {
    if (expr.tag === "ident") {
      const v = this.lookupVar(expr.name);
      return v?.isConst ?? false;
    }
    if (expr.tag === "field") {
      const parentType = this.checkExpr(expr.object);
      const parentConst = this.isExprConst(expr.object, parentType);
      if (parentConst) return true;
      // Check if the field itself is declared const.
      const actualParent = parentType.tag === "nullable" ? parentType.inner : parentType;
      const resolved = this.resolveStructType(actualParent);
      if (!resolved) return false;
      const allFields = this.allFieldsOf(resolved.canonicalName);
      const field = allFields.find(f => f.name === expr.name);
      return !!(field?.isConst || resolved.decl.isConst);
    }
    if (expr.tag === "unwrap") {
      return this.isExprConst(expr.operand, type);
    }
    if (expr.tag === "paren") {
      return this.isExprConst(expr.expr, type);
    }
    return false;
  }

  private inferIndex(expr: Extract<Expr, { tag: "index" }>): WacType {
    const objType = this.checkExpr(expr.object);
    this.checkExpr(expr.idx);
    if (objType.tag === "array") {
      // Packed types (i8, i16) are zero-extended to i32 on read.
      const elem = objType.elem;
      return (elem.tag === "i8" || elem.tag === "i16") ? { tag: "i32" } : elem;
    }
    if (objType.tag === "string") return { tag: "string" };  // string[i] = string (codepoint)
    this.err(`index operator on non-array type '${typeStr(objType)}'`,
      expr.line, expr.col, 1);
    return { tag: "i32" };
  }

  private inferFnRef(expr: Extract<Expr, { tag: "fnref" }>): WacType {
    // Parser only generates fnref for TypeName.method (uppercase ident + . + ident without ())
    // so typeQual is always present; methods live in struct decl, not resolved.funcs.
    const canonicalQual = this.resolveStructName(expr.typeQual!);
    const rs = this.resolved.structs.get(canonicalQual);
    if (rs) {
      const method = rs.decl.methods.find(m => m.name === expr.func);
      if (method) {
        // Include 'this' parameter in funcref type for instance methods (thisParam present)
        const thisParams: WacType[] = method.thisParam
          ? [{ tag: "named", name: canonicalQual }]
          : [];
        return { tag: "funcref", ret: this.resolveType(method.returnType), params: [...thisParams, ...method.params.map(p => this.resolveType(p.type))] };
      }
    }
    this.err(`undefined function '${expr.func}'`, expr.line, expr.col, expr.func.length);
    return { tag: "funcref", ret: { tag: "void" }, params: [] };
  }

  private inferCallExpr(expr: Extract<Expr, { tag: "callexpr" }>): WacType {
    const calleeType = this.checkExpr(expr.callee);
    // Unwrap nullable if needed
    const ft = calleeType.tag === "funcref" ? calleeType :
               calleeType.tag === "nullable" && calleeType.inner.tag === "funcref" ? calleeType.inner :
               null;
    if (!ft) {
      this.err("cannot call non-funcref expression", expr.line, expr.col, 1);
      for (const a of expr.args) this.checkExpr(a);
      return { tag: "i32" };
    }
    this.checkCallArgs(expr.args, ft.params.map((p, i) => ({ name: `arg${i}`, type: p, line: 0, col: 0 })), expr.line, expr.col);
    return ft.ret;
  }

  // ---- Helpers ----

  private checkCallArgs(args: Expr[], params: Param[], line: number, col: number): void {
    if (args.length !== params.length) {
      this.err(`wrong number of arguments: expected ${params.length}, got ${args.length}`,
        line, col, 1);
    }
    for (let i = 0; i < args.length; i++) {
      const pt = params[i] ? this.resolveType(params[i]!.type) : undefined;
      const at = this.checkExpr(args[i]!, pt);
      if (pt && !this.typeAssignable(at, pt)) {
        this.err(`argument ${i + 1} type mismatch`, args[i]!.line, args[i]!.col, 1,
          `expected ${typeStr(pt)}, found ${typeStr(at)}`);
      }
    }
  }

  // Returns { decl, canonicalName } for a named struct type, or undefined.
  // The `type` should already contain canonical names (from resolveType).
  private resolveStructType(type: WacType): { decl: StructDecl; canonicalName: string } | undefined {
    if (type.tag === "named") {
      const rs = this.resolved.structs.get(type.name);
      if (rs) return { decl: rs.decl, canonicalName: type.name };
    }
    return undefined;
  }
}

// ---- Cast validation helpers ----

// Returns true if from→to is lossless (should use `as` only)
function isLosslessCast(from: WacType, to: WacType): boolean {
  const f = from.tag, t = to.tag;
  if (f === "i32" && t === "i64") return true;
  if (f === "i32" && t === "f64") return true;
  if (f === "f32" && t === "f64") return true;
  if ((f === "bool") && t === "i32") return true;
  return false;
}
