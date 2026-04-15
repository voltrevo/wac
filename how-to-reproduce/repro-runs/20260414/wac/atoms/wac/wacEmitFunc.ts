// Emits WebAssembly GC bytecode for a single wac function body.
// Input: EmitCtx (type/func indices from wasmBuildBin) + EmitFunc (params, body, return type).
// Output: raw bytes for one code section entry (locals vector + instructions).
//
// The caller (wasmBuildBin) prefixes the byte count before each code section entry.
// This atom only produces the body content, not the size prefix.

import type {
  WacType, Expr, Stmt, Block, LVal, LValOp,
  BinOp, CompoundOp, FieldInit,
} from "./ast.ts";

// ---- Exported types ----

// Context provided by wasmBuildBin: maps wac names to wasm binary indices.
export type EmitCtx = {
  structTypeIdx: Map<string, number>;   // canonical struct name → wasm type section index
  arrayTypeIdx: (elem: WacType) => number;  // elem type → type section index
  funcSigIdx: (params: WacType[], ret: WacType) => number;
  funcIdx: Map<string, number>;         // mangled name → function section index
  // All fields for a struct (including inherited, in declaration order).
  // absFieldIdx is the 0-based position in the full allFields list, used directly
  // as the field index in struct.get/struct.set with the object's struct type.
  structAllFields: (name: string) => Array<{
    name: string; type: WacType; isConst: boolean; absFieldIdx: number;
  }>;
  structParent: (name: string) => string | undefined;  // canonical name → canonical parent name
  resolveStructName: (localName: string) => string;    // local/AST name → canonical name
  exprType: WeakMap<object, WacType>;
  stringHelperIdx?: (name: string) => number;  // string helper name → function index (optional: only needed if string ops are used)
};

// Normalised function description (parameters include any implicit `this`).
export type EmitFunc = {
  params: Array<{ name: string; type: WacType }>;
  returnType: WacType;
  body: Block;
};

// ---- Main export ----

export function wacEmitFunc(ctx: EmitCtx, fn: EmitFunc): Uint8Array {
  return new FuncEmitter(ctx, fn).emit();
}

// ---- FuncEmitter ----

type LocalEntry = { name: string; type: WacType; idx: number };

class FuncEmitter {
  private out: number[] = [];
  private labelDepth = 0;
  private loopStack: Array<{ breakLabel: number; continueLabel: number }> = [];
  private locals: LocalEntry[] = [];
  // varToIdx: maps each var-declaration AST node → allocated local index (set during pre-scan).
  private varToIdx = new Map<object, number>();
  // scopeStack: stack of scope frames for emission; innermost last. Each frame maps name → idx.
  private scopeStack: Array<Map<string, number>> = [];
  // Scratch locals (allocated after declared locals).
  // scratch_i32=firstScratch+0, i64=+1, f32=+2, f64=+3
  private firstScratch = 0;
  private paramCount: number;

  constructor(private ctx: EmitCtx, private fn: EmitFunc) {
    this.paramCount = fn.params.length;
    const paramScope = new Map<string, number>();
    for (let i = 0; i < fn.params.length; i++) {
      const p = fn.params[i]!;
      this.locals.push({ name: p.name, type: this.resolveType(p.type), idx: i });
      paramScope.set(p.name, i);
    }
    this.scopeStack.push(paramScope);  // params are always accessible
  }

  private resolveType(t: WacType): WacType {
    if (t.tag === "named") return { tag: "named", name: this.ctx.resolveStructName(t.name) };
    if (t.tag === "array") return { tag: "array", elem: this.resolveType(t.elem) };
    if (t.tag === "nullable") return { tag: "nullable", inner: this.resolveType(t.inner) };
    if (t.tag === "funcref") return { tag: "funcref", ret: this.resolveType(t.ret), params: t.params.map(p => this.resolveType(p)) };
    return t;
  }

  emit(): Uint8Array {
    // Pre-scan body to allocate indices for all declared variables.
    this.scanBlock(this.fn.body);
    this.firstScratch = this.locals.length;

    // Emit locals vector (only non-param locals).
    const localVec = this.buildLocalsVec();

    // Emit function body.
    this.emitBlock(this.fn.body);
    // For non-void functions whose last path doesn't explicitly return (e.g. switch with all-return
    // cases), the stack is empty after the last block. Add `unreachable` so the wasm validator
    // accepts the function end regardless. It's dead code when all paths return.
    if (this.fn.returnType.tag !== "void") this.push(0x00);  // unreachable
    this.push(0x0B);  // end

    return new Uint8Array([...localVec, ...this.out]);
  }

  // ---- Local scanning ----

  private scanBlock(block: Block): void {
    for (const stmt of block.stmts) this.scanStmt(stmt);
  }

  private scanStmt(stmt: Stmt): void {
    switch (stmt.tag) {
      case "var":
        this.allocLocalForNode(stmt, stmt.name, stmt.type);
        this.scanExpr(stmt.init);
        break;
      case "if":
        this.scanBlock(stmt.then);
        if (stmt.else_) {
          if ("stmts" in stmt.else_) this.scanBlock(stmt.else_);
          else this.scanStmt(stmt.else_);
        }
        break;
      case "while": this.scanBlock(stmt.body); break;
      case "for":
        if (stmt.init?.tag === "var") this.allocLocalForNode(stmt.init, stmt.init.name, stmt.init.type);
        if (stmt.init) this.scanForInit(stmt.init);
        this.scanBlock(stmt.body);
        break;
      case "dowhile": this.scanBlock(stmt.body); break;
      case "switch":
        for (const c of stmt.cases) for (const s of c.body) this.scanStmt(s);
        if (stmt.default_) for (const s of stmt.default_) this.scanStmt(s);
        break;
      case "block": this.scanBlock(stmt.block); break;
    }
  }

  private scanForInit(init: { tag: string; name?: string; type?: WacType }): void {
    if (init.tag === "var") this.scanExpr((init as any).init);
  }

  private scanExpr(expr: Expr): void {
    // Only recurse into sub-expressions for var declarations inside lambdas etc.
    // (wac has no closures, so this is just for completeness)
    switch (expr.tag) {
      case "ternary": this.scanExpr(expr.cond); this.scanExpr(expr.then); this.scanExpr(expr.else_); break;
      case "binary": this.scanExpr(expr.left); this.scanExpr(expr.right); break;
      case "unary": case "cast": case "unwrap": case "paren":
        this.scanExpr((expr as any).operand ?? (expr as any).expr); break;
      case "is": this.scanExpr(expr.operand); if (typeof expr.checkType === "object" && "tag" in expr.checkType && "line" in (expr.checkType as any)) this.scanExpr(expr.checkType as Expr); break;
      case "call": case "method": for (const a of (expr as any).args ?? []) this.scanExpr(a); if ((expr as any).object) this.scanExpr((expr as any).object); break;
      case "callexpr": this.scanExpr(expr.callee); for (const a of expr.args) this.scanExpr(a); break;
      case "construct": for (const a of expr.args) this.scanExpr(a); if (expr.fields) for (const f of expr.fields) this.scanExpr(f.value); break;
      case "array_new": if (expr.size) this.scanExpr(expr.size); if (expr.elems) for (const e of expr.elems) this.scanExpr(e); break;
      case "field": case "index": this.scanExpr((expr as any).object); if ((expr as any).idx) this.scanExpr((expr as any).idx); break;
    }
  }

  // Allocate a new local slot for a var declaration node (pre-scan phase).
  private allocLocalForNode(node: object, name: string, type: WacType): void {
    const idx = this.locals.length;
    this.locals.push({ name, type: this.resolveType(type), idx });
    this.varToIdx.set(node, idx);
  }

  // Search scope stack from innermost to outermost for a local name (emission phase).
  private lookupScopeIdx(name: string): number | undefined {
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const idx = this.scopeStack[i]!.get(name);
      if (idx !== undefined) return idx;
    }
    return undefined;
  }

  private getLocalIdx(name: string): number {
    const idx = this.lookupScopeIdx(name);
    if (idx === undefined) throw new Error(`unknown local: ${name}`);
    return idx;
  }

  private getLocalType(name: string): WacType {
    const idx = this.getLocalIdx(name);
    return this.locals[idx]!.type;
  }

  private buildLocalsVec(): number[] {
    // Params are NOT in the locals vector.
    const declaredLocals = this.locals.slice(this.paramCount);
    // Add 4 scratch locals.
    const scratches: WacType[] = [
      { tag: "i32" }, { tag: "i64" }, { tag: "f32" }, { tag: "f64" },
    ];
    const all = [...declaredLocals.map(l => l.type), ...scratches];
    // Encode as run-length: each entry is (count, valtype).
    // For simplicity emit 1 entry per local.
    const entries: number[] = [];
    for (const t of all) {
      entries.push(1, ...this.encodeValType(t));
    }
    return [...uleb128(all.length), ...entries];
  }

  // ---- Statement emission ----

  private emitBlock(block: Block): void {
    this.scopeStack.push(new Map());
    for (const stmt of block.stmts) this.emitStmt(stmt);
    this.scopeStack.pop();
  }

  private emitStmt(stmt: Stmt): void {
    switch (stmt.tag) {
      case "var": {
        this.emitExpr(stmt.init, stmt.type);
        const varIdx = this.varToIdx.get(stmt)!;
        this.scopeStack[this.scopeStack.length - 1]!.set(stmt.name, varIdx);
        this.push(0x21, ...uleb128(varIdx));
        break;
      }

      case "assign":
        this.emitLValWrite(stmt.lval, () => this.emitExpr(stmt.rhs));
        break;

      case "compound":
        this.emitCompound(stmt.lval, stmt.op, stmt.rhs);
        break;

      case "incr":
        this.emitIncr(stmt.lval, stmt.op);
        break;

      case "if": {
        this.emitExpr(stmt.cond);
        this.push(0x04, 0x40);  // if (void)
        this.labelDepth++;
        this.emitBlock(stmt.then);
        if (stmt.else_) {
          this.push(0x05);  // else
          if ("stmts" in stmt.else_) this.emitBlock(stmt.else_);
          else this.emitStmt(stmt.else_);
        }
        this.push(0x0B);  // end
        this.labelDepth--;
        break;
      }

      case "while": {
        // block $break; loop $continue; cond; br_if break; body; br continue; end; end
        const breakLabel = this.labelDepth;
        this.push(0x02, 0x40); this.labelDepth++;   // block void
        const continueLabel = this.labelDepth;
        this.push(0x03, 0x40); this.labelDepth++;   // loop void
        this.loopStack.push({ breakLabel, continueLabel });

        this.emitExpr(stmt.cond);
        this.push(0x45);  // i32.eqz
        this.push(0x0D, ...uleb128(this.labelDepth - breakLabel - 1));  // br_if $break

        this.emitBlock(stmt.body);
        this.push(0x0C, ...uleb128(this.labelDepth - continueLabel - 1));  // br $continue

        this.loopStack.pop();
        this.push(0x0B); this.labelDepth--;  // end loop
        this.push(0x0B); this.labelDepth--;  // end block
        break;
      }

      case "for": {
        // Push a scope for the for-init variable (visible through condition, body, and update).
        this.scopeStack.push(new Map());
        // Emit init.
        if (stmt.init) this.emitForInit(stmt.init);

        const breakLabel = this.labelDepth;
        this.push(0x02, 0x40); this.labelDepth++;   // block $break
        const loopTopLabel = this.labelDepth;
        this.push(0x03, 0x40); this.labelDepth++;   // loop $loopTop

        // Condition.
        if (stmt.cond) {
          this.emitExpr(stmt.cond);
          this.push(0x45);  // i32.eqz
          this.push(0x0D, ...uleb128(this.labelDepth - breakLabel - 1));  // br_if $break
        }

        // Body wrapper for continue.
        const continueLabel = this.labelDepth;
        this.push(0x02, 0x40); this.labelDepth++;   // block $cont
        this.loopStack.push({ breakLabel, continueLabel });
        this.emitBlock(stmt.body);
        this.loopStack.pop();
        this.push(0x0B); this.labelDepth--;          // end $cont

        // Update.
        if (stmt.update) this.emitForUpdate(stmt.update);

        // Back to loop top.
        this.push(0x0C, ...uleb128(this.labelDepth - loopTopLabel - 1));

        this.push(0x0B); this.labelDepth--;  // end loop
        this.push(0x0B); this.labelDepth--;  // end block
        // Pop for-loop scope (for-init variable no longer visible).
        this.scopeStack.pop();
        break;
      }

      case "dowhile": {
        // block $break; loop $continue; body; cond; br_if $continue; end; end
        const breakLabel = this.labelDepth;
        this.push(0x02, 0x40); this.labelDepth++;
        const continueLabel = this.labelDepth;
        this.push(0x03, 0x40); this.labelDepth++;
        this.loopStack.push({ breakLabel, continueLabel });

        this.emitBlock(stmt.body);
        this.emitExpr(stmt.cond);
        this.push(0x0D, ...uleb128(this.labelDepth - continueLabel - 1));  // br_if $continue

        this.loopStack.pop();
        this.push(0x0B); this.labelDepth--;  // end loop
        this.push(0x0B); this.labelDepth--;  // end block
        break;
      }

      case "switch":
        this.emitSwitch(stmt);
        break;

      case "return":
        if (stmt.value) this.emitExpr(stmt.value, this.fn.returnType);
        this.push(0x0F);  // return
        break;

      case "break": {
        const scope = this.loopStack[this.loopStack.length - 1]!;
        this.push(0x0C, ...uleb128(this.labelDepth - scope.breakLabel - 1));
        break;
      }

      case "continue": {
        const scope = this.loopStack[this.loopStack.length - 1]!;
        this.push(0x0C, ...uleb128(this.labelDepth - scope.continueLabel - 1));
        break;
      }

      case "trap":
        this.push(0x00);  // unreachable
        break;

      case "block": {
        // Scoped block (just a scope, no wasm block needed unless break targets it).
        this.emitBlock(stmt.block);
        break;
      }

      case "expr":
        this.emitExpr(stmt.expr);
        // Drop result if non-void.
        if (this.ctx.exprType.get(stmt.expr)?.tag !== "void") {
          this.push(0x1A);  // drop
        }
        break;
    }
  }

  private emitForInit(init: NonNullable<import("./ast.ts").ForInit>): void {
    if (init.tag === "var") {
      this.emitExpr(init.init, init.type);
      const varIdx = this.varToIdx.get(init)!;
      this.scopeStack[this.scopeStack.length - 1]!.set(init.name, varIdx);
      this.push(0x21, ...uleb128(varIdx));
    } else {
      this.emitLValWrite(init.lval, () => this.emitExpr(init.rhs));
    }
  }

  private emitForUpdate(update: NonNullable<import("./ast.ts").ForUpdate>): void {
    if (update.tag === "assign") {
      this.emitLValWrite(update.lval, () => this.emitExpr(update.rhs));
    } else if (update.tag === "compound") {
      this.emitCompound(update.lval, update.op, update.rhs);
    } else {
      this.emitIncr(update.lval, update.op);
    }
  }

  // ---- Expression emission ----

  private emitExpr(expr: Expr, expected?: WacType): void {
    switch (expr.tag) {
      case "int":
        this.push(0x41, ...sleb128(expr.value));
        break;

      case "int64":
        this.push(0x42, ...sleb128i64(expr.value));
        break;

      case "float": {
        const t = this.ctx.exprType.get(expr);
        if (t?.tag === "f32") {
          this.push(0x43, ...encodeF32(expr.value));
        } else {
          this.push(0x44, ...encodeF64(expr.value));
        }
        break;
      }

      case "bool":
        this.push(0x41, expr.value ? 1 : 0);
        break;

      case "null": {
        const t = expected ?? this.ctx.exprType.get(expr);
        if (!t) { this.push(0xD0, 0x71); break; }  // ref.null none (fallback)
        const ht = this.heaptypeOfNullable(t);
        this.push(0xD0, ...ht);
        break;
      }

      case "str":
        this.emitStringLiteral(expr.value);
        break;

      case "char":
        this.push(0x41, ...sleb128(expr.value.codePointAt(0) ?? 0));
        break;

      case "ident":
        this.emitIdent(expr.name);
        break;

      case "paren":
        this.emitExpr(expr.expr, expected);
        break;

      case "unary":
        this.emitUnary(expr, expected);
        break;

      case "binary":
        this.emitBinary(expr);
        break;

      case "cast":
        this.emitCast(expr);
        break;

      case "is":
        this.emitIs(expr);
        break;

      case "ternary": {
        // Use the ternary expression's own type as the block result type; fall back to then-branch.
        const t = this.ctx.exprType.get(expr) ?? this.ctx.exprType.get(expr.then);
        this.emitExpr(expr.cond);
        this.push(0x04, ...this.encodeBlockType(t ?? null));  // if (valuetype)
        this.labelDepth++;
        this.emitExpr(expr.then, expected);
        this.push(0x05);  // else
        this.emitExpr(expr.else_, expected);
        this.push(0x0B);  // end
        this.labelDepth--;
        break;
      }

      case "call":
        this.emitCall(expr);
        break;

      case "construct":
        this.emitConstruct(expr);
        break;

      case "array_new":
        this.emitArrayNew(expr);
        break;

      case "field":
        this.emitFieldRead(expr.object, expr.name);
        break;

      case "method":
        this.emitMethod(expr);
        break;

      case "index":
        this.emitArrayGet(expr.object, expr.idx);
        break;

      case "unwrap":
        this.emitExpr(expr.operand);
        this.push(0xD4);  // ref.as_non_null
        break;

      case "fnref": {
        const canonicalStructName = this.ctx.resolveStructName(expr.typeQual!);
        const mangledName = `${canonicalStructName}$${expr.func}`;
        const fi = this.ctx.funcIdx.get(mangledName)!;
        this.push(0xD2, ...uleb128(fi));  // ref.func
        break;
      }

      case "callexpr":
        this.emitCallExpr(expr);
        break;
    }
  }

  private emitIdent(name: string): void {
    const idx = this.lookupScopeIdx(name);
    if (idx !== undefined) {
      // Check if it's a funcref local that's being used as a value (handled by local.get).
      this.push(0x20, ...uleb128(idx));  // local.get
      return;
    }
    // Must be a function reference — emit ref.func.
    // Look up mangled name through the locals map doesn't have it,
    // so treat as a function name lookup at call time.
    // (The type checker has already verified this identifier is valid.)
    // For plain function names used as funcref values, we need their func index.
    // The emitter can't directly resolve them here without the NameEnv.
    // This case should be handled by the call emitter for call_ref.
    // For standalone usage, try to find it directly in funcIdx as-is.
    // This is a fallback for simple cases where the name IS the mangled name.
    const fi = this.ctx.funcIdx.get(name);
    if (fi !== undefined) {
      this.push(0xD2, ...uleb128(fi));  // ref.func
    } else {
      throw new Error(`wacEmitFunc: unresolved identifier '${name}'`);
    }
  }

  private emitUnary(
    expr: Extract<Expr, { tag: "unary" }>,
    _expected?: WacType,
  ): void {
    const t = this.ctx.exprType.get(expr.operand);
    switch (expr.op) {
      case "-":
        // Emit as: zero; operand; sub  (avoids having to undo already-emitted operand)
        if (t?.tag === "f32") { this.emitExpr(expr.operand); this.push(0x8C); break; }  // f32.neg
        if (t?.tag === "f64") { this.emitExpr(expr.operand); this.push(0x9A); break; }  // f64.neg
        if (t?.tag === "i64") {
          this.push(0x42, 0x00); this.emitExpr(expr.operand); this.push(0x7D);  // i64: 0 - x
        } else {
          this.push(0x41, 0x00); this.emitExpr(expr.operand); this.push(0x6B);  // i32: 0 - x
        }
        break;
      case "!":
        this.emitExpr(expr.operand);
        this.push(0x45);  // i32.eqz (bool NOT)
        break;
      case "~":
        this.emitExpr(expr.operand);
        if (t?.tag === "i64") {
          this.push(0x42, 0x7F, 0x85);  // i64.const -1; i64.xor
        } else {
          this.push(0x41, 0x7F, 0x73);  // i32.const -1; i32.xor
        }
        break;
    }
  }

  private emitBinary(expr: Extract<Expr, { tag: "binary" }>): void {
    const lt = this.ctx.exprType.get(expr.left);
    const op = expr.op;

    // String operations
    if (lt?.tag === "string") {
      switch (op) {
        case "+": {
          this.emitExpr(expr.left); this.emitExpr(expr.right);
          const fi = this.ctx.stringHelperIdx!("concat");
          this.push(0x10, ...uleb128(fi));
          return;
        }
        case "==": {
          this.emitExpr(expr.left); this.emitExpr(expr.right);
          const fi = this.ctx.stringHelperIdx!("eq");
          this.push(0x10, ...uleb128(fi));
          return;
        }
        case "!=": {
          this.emitExpr(expr.left); this.emitExpr(expr.right);
          const fi = this.ctx.stringHelperIdx!("eq");
          this.push(0x10, ...uleb128(fi));
          this.push(0x45);  // i32.eqz
          return;
        }
        case "<": {
          this.emitExpr(expr.left); this.emitExpr(expr.right);
          const fi = this.ctx.stringHelperIdx!("lt");
          this.push(0x10, ...uleb128(fi));
          return;
        }
        case ">": {  // a > b == b < a
          this.emitExpr(expr.right); this.emitExpr(expr.left);
          const fi = this.ctx.stringHelperIdx!("lt");
          this.push(0x10, ...uleb128(fi));
          return;
        }
        case "<=": {  // a <= b == !(b < a)
          this.emitExpr(expr.right); this.emitExpr(expr.left);
          const fi = this.ctx.stringHelperIdx!("lt");
          this.push(0x10, ...uleb128(fi));
          this.push(0x45);  // eqz
          return;
        }
        case ">=": {  // a >= b == !(a < b)
          this.emitExpr(expr.left); this.emitExpr(expr.right);
          const fi = this.ctx.stringHelperIdx!("lt");
          this.push(0x10, ...uleb128(fi));
          this.push(0x45);  // eqz
          return;
        }
      }
    }

    // Short-circuit && and ||
    if (op === "&&") {
      const resType = this.ctx.exprType.get(expr);
      this.emitExpr(expr.left);
      this.push(0x04, ...this.encodeBlockType(resType ?? null));  // if (i32)
      this.labelDepth++;
      this.emitExpr(expr.right);
      this.push(0x05);  // else
      this.push(0x41, 0x00);  // i32.const 0 (false)
      this.push(0x0B);  // end
      this.labelDepth--;
      return;
    }
    if (op === "||") {
      const resType = this.ctx.exprType.get(expr);
      this.emitExpr(expr.left);
      this.push(0x04, ...this.encodeBlockType(resType ?? null));  // if (i32)
      this.labelDepth++;
      this.push(0x41, 0x01);  // i32.const 1 (true)
      this.push(0x05);  // else
      this.emitExpr(expr.right);
      this.push(0x0B);  // end
      this.labelDepth--;
      return;
    }

    this.emitExpr(expr.left);
    // For i64<<i32 / i64>>i32, extend i32 shift amount to i64.
    if ((op === "<<" || op === ">>") && lt?.tag === "i64") {
      const rt = this.ctx.exprType.get(expr.right);
      this.emitExpr(expr.right);
      if (rt?.tag === "i32") this.push(0xAC);  // i64.extend_i32_s
    } else {
      this.emitExpr(expr.right);
    }
    this.push(...this.binopcode(op, lt ?? { tag: "i32" }));
  }

  private binopcode(op: BinOp, lt: WacType): number[] {
    const is64 = lt.tag === "i64";
    const isF32 = lt.tag === "f32";
    const isF64 = lt.tag === "f64";
    switch (op) {
      case "+": return isF32 ? [0x92] : isF64 ? [0xA0] : is64 ? [0x7C] : [0x6A];
      case "-": return isF32 ? [0x93] : isF64 ? [0xA1] : is64 ? [0x7D] : [0x6B];
      case "*": return isF32 ? [0x94] : isF64 ? [0xA2] : is64 ? [0x7E] : [0x6C];
      case "/": return isF32 ? [0x95] : isF64 ? [0xA3] : is64 ? [0x7F] : [0x6D];
      case "%": return is64 ? [0x81] : [0x6F];  // i32.rem_s / i64.rem_s
      case "==": return isF32 ? [0x5B] : isF64 ? [0x61] : is64 ? [0x51] : [0x46];
      case "!=": return isF32 ? [0x5C] : isF64 ? [0x62] : is64 ? [0x52] : [0x47];
      case "<":  return isF32 ? [0x5D] : isF64 ? [0x63] : is64 ? [0x53] : [0x48];
      case "<=": return isF32 ? [0x5F] : isF64 ? [0x65] : is64 ? [0x57] : [0x4C];
      case ">":  return isF32 ? [0x5E] : isF64 ? [0x64] : is64 ? [0x55] : [0x4A];
      case ">=": return isF32 ? [0x60] : isF64 ? [0x66] : is64 ? [0x59] : [0x4E];
      case "&":  return is64 ? [0x83] : [0x71];
      case "|":  return is64 ? [0x84] : [0x72];
      case "^":  return is64 ? [0x85] : [0x73];
      case "<<": return is64 ? [0x86] : [0x74];
      case ">>": return is64 ? [0x87] : [0x75];  // shr_s
      default: throw new Error(`binopcode: unknown op ${op}`);
    }
  }

  private emitCast(expr: Extract<Expr, { tag: "cast" }>): void {
    const fromType = this.resolveType(this.ctx.exprType.get(expr.operand) ?? { tag: "i32" as const });
    const toType = this.resolveType(expr.toType);

    // Reference casts
    if (this.isRefType(fromType)) {
      if (expr.op === "as") {
        if (fromType.tag === "i31ref" && toType.tag === "i32") {
          // i31ref → i32: i31.get_s
          this.emitExpr(expr.operand);
          this.push(0xFB, 0x1D);
          return;
        }
        // Upcast — no instruction (subtype widening is implicit)
        this.emitExpr(expr.operand);
      } else if (expr.op === "as!") {
        this.emitExpr(expr.operand);
        if (toType.tag === "i31ref") {
          // i31ref cast from i32: ref.i31
          this.push(0xFB, 0x1C);
        } else {
          // ref.cast nonnull $T
          this.push(0xFB, 0x16, ...this.encodeHeapType(toType));
        }
      }
      return;
    }

    // Integer → i31ref
    if (toType.tag === "i31ref") {
      this.emitExpr(expr.operand);
      this.push(0xFB, 0x1C);  // ref.i31
      return;
    }

    this.emitExpr(expr.operand);
    this.push(...this.numericCastOpcode(fromType, toType, expr.op));
  }

  private numericCastOpcode(from: WacType, to: WacType, op: string): number[] {
    const f = from.tag, t = to.tag;
    if (op === "as") {
      // Lossless widening — each (from,to) pair only valid for one op.
      if (f === "i32" && t === "i64")  return [0xAC];       // i64.extend_i32_s
      if (f === "i32" && t === "f64")  return [0xB7];       // f64.convert_i32_s
      if (f === "f32" && t === "f64")  return [0xBB];       // f64.promote_f32
      if (f === "bool" && t === "i32") return [];            // no-op (bool IS i32)
      if (f === "i32" && t === "bool") return [];            // no-op (already i32)
    } else if (op === "as!") {
      // Checked — trap if value cannot be represented exactly.
      if (f === "i64" && t === "i32")  return this.emitCheckedI64ToI32();
      if (f === "f64" && t === "i32")  return this.emitCheckedF64ToI32();
      if (f === "f64" && t === "i64")  return this.emitCheckedF64ToI64();
      if (f === "f32" && t === "i32")  return this.emitCheckedF32ToI32();
    } else if (op === "as~") {
      // Nearest/saturate — round to nearest, clamp on overflow, never traps.
      if (f === "i64" && t === "i32")  return this.clampI64ToI32();
      if (f === "f64" && t === "i32")  return [0x9E, 0xFC, 0x02]; // f64.nearest; i32.trunc_sat_f64_s
      if (f === "f32" && t === "i32")  return [0x90, 0xFC, 0x00]; // f32.nearest; i32.trunc_sat_f32_s
      if (f === "f64" && t === "f32")  return [0xB6];       // f32.demote_f64
      if (f === "i64" && t === "f64")  return [0xB9];       // f64.convert_i64_s
      if (f === "i32" && t === "f32")  return [0xB2];       // f32.convert_i32_s
      if (f === "i32" && t === "bool") return [0x45, 0x45]; // i32.eqz; i32.eqz (normalize to 0/1)
    } else if (op === "as@") {
      // Raw — truncate/wrap, never traps (except wasm trunc overflow semantics).
      if (f === "i64" && t === "i32")  return [0xA7];       // i32.wrap_i64
      if (f === "f64" && t === "i32")  return [0xAA];       // i32.trunc_f64_s
      if (f === "f32" && t === "i32")  return [0xA8];       // i32.trunc_f32_s
      if (f === "f64" && t === "f32")  return [0xB6];       // f32.demote_f64 (same as as~)
      if (f === "i64" && t === "f64")  return [0xB9];       // f64.convert_i64_s (same as as~)
      if (f === "i32" && t === "f32")  return [0xB2];       // f32.convert_i32_s (same as as~)
      if (f === "i32" && t === "bool") return [0x45, 0x45]; // same as as~
    }
    throw new Error(`numericCast: ${f} ${op} ${t}`);
  }

  // These return opcode arrays that are appended to an already-emitted value.
  // For multi-step casts that need the scratch local, emit inline and return [].
  private emitCheckedI64ToI32(): number[] {
    // Check if within i32 range, trap if not, then wrap.
    const s = this.firstScratch + 1;  // scratch_i64
    this.push(0x22, ...uleb128(s));   // local.tee scratch_i64
    // if x > INT32_MAX: unreachable
    this.push(0x42, ...sleb128i64(BigInt(0x7FFFFFFF)));  // i64.const INT32_MAX
    this.push(0x55);   // i64.gt_s
    this.push(0x04, 0x40); this.push(0x00); this.push(0x0B);  // if void { unreachable } end
    // if x < INT32_MIN: unreachable
    this.push(0x20, ...uleb128(s));
    this.push(0x42, ...sleb128i64(BigInt(-0x80000000)));
    this.push(0x53);   // i64.lt_s
    this.push(0x04, 0x40); this.push(0x00); this.push(0x0B);
    // wrap
    this.push(0x20, ...uleb128(s));
    this.push(0xA7);  // i32.wrap_i64
    return [];
  }

  private emitCheckedF64ToI32(): number[] {
    // Trap if fractional or out of range.
    const s = this.firstScratch + 3;  // scratch_f64
    this.push(0x22, ...uleb128(s));   // local.tee scratch_f64
    this.push(0x9D);   // f64.trunc (round toward zero)
    this.push(0x20, ...uleb128(s));
    this.push(0x62);   // f64.ne (if trunc(x) != x → fractional)
    this.push(0x04, 0x40); this.push(0x00); this.push(0x0B);
    this.push(0x20, ...uleb128(s));
    this.push(0xAA);   // i32.trunc_f64_s (also traps out of range)
    return [];
  }

  private emitCheckedF64ToI64(): number[] {
    const s = this.firstScratch + 3;
    this.push(0x22, ...uleb128(s));
    this.push(0x9D);   // f64.trunc
    this.push(0x20, ...uleb128(s));
    this.push(0x62);   // f64.ne
    this.push(0x04, 0x40); this.push(0x00); this.push(0x0B);
    this.push(0x20, ...uleb128(s));
    this.push(0xB0);   // i64.trunc_f64_s (traps out of range)
    return [];
  }

  private emitCheckedF32ToI32(): number[] {
    const s = this.firstScratch + 2;  // scratch_f32
    this.push(0x22, ...uleb128(s));
    this.push(0x8F);   // f32.trunc
    this.push(0x20, ...uleb128(s));
    this.push(0x5C);   // f32.ne
    this.push(0x04, 0x40); this.push(0x00); this.push(0x0B);
    this.push(0x20, ...uleb128(s));
    this.push(0xA8);   // i32.trunc_f32_s (traps out of range)
    return [];
  }

  private clampI64ToI32(): number[] {
    const s = this.firstScratch + 1;
    this.push(0x22, ...uleb128(s));
    // if x > INT32_MAX: push INT32_MAX; else if x < INT32_MIN: push INT32_MIN; else wrap
    this.push(0x42, ...sleb128i64(BigInt(0x7FFFFFFF)));
    this.push(0x55);   // i64.gt_s
    this.push(0x04, ...this.encodeBlockType({ tag: "i32" }));  // if → i32
    this.labelDepth++;
    this.push(0x41, ...sleb128(0x7FFFFFFF));  // i32.const INT32_MAX
    this.push(0x05);  // else
    this.push(0x20, ...uleb128(s));
    this.push(0x42, ...sleb128i64(BigInt(-0x80000000)));
    this.push(0x53);   // i64.lt_s
    this.push(0x04, ...this.encodeBlockType({ tag: "i32" }));
    this.labelDepth++;
    this.push(0x41, ...sleb128(-0x80000000));  // i32.const INT32_MIN
    this.push(0x05);
    this.push(0x20, ...uleb128(s));
    this.push(0xA7);   // i32.wrap_i64
    this.push(0x0B); this.labelDepth--;  // end inner if
    this.push(0x0B); this.labelDepth--;  // end outer if
    return [];
  }

  private emitIs(expr: Extract<Expr, { tag: "is" }>): void {
    const check = expr.checkType;
    if (check === "null") {
      this.emitExpr(expr.operand);
      this.push(0xD1);  // ref.is_null
      if (expr.not) this.push(0x45);  // i32.eqz (invert)
    } else if (typeof check !== "object" || !("tag" in check) || !("line" in check)) {
      // WacType check (ref.test)
      const ct = this.resolveType(check as WacType);
      this.emitExpr(expr.operand);
      this.push(0xFB, 0x14, ...this.encodeHeapType(ct));  // ref.test nonnull
      if (expr.not) this.push(0x45);
    } else {
      // Reference identity (ref.eq)
      this.emitExpr(expr.operand);
      this.emitExpr(check as Expr);
      this.push(0xD3);  // ref.eq
      if (expr.not) this.push(0x45);
    }
  }

  private emitCall(expr: Extract<Expr, { tag: "call" }>): void {
    // Check if it's a struct constructor.
    if (!expr.typeQual) {
      const canonicalName = this.ctx.resolveStructName(expr.func);
      if (this.ctx.structTypeIdx.has(canonicalName)) {
        const tidx = this.ctx.structTypeIdx.get(canonicalName)!;
        if (expr.args.length === 0) {
          // Default construction. Use struct.new_default only for all-primitive/nullable structs;
          // for structs with non-nullable ref fields, emit explicit defaults + struct.new.
          this.emitStructDefault(canonicalName, tidx);
        } else {
          // Positional construction: emit args in order.
          for (const a of expr.args) this.emitExpr(a);
          this.push(0xFB, 0x00, ...uleb128(tidx));  // struct.new
        }
        return;
      }
    }

    // Check if it's a call through a funcref local.
    const localIdx = this.lookupScopeIdx(expr.func);
    if (localIdx !== undefined) {
      const lt = this.locals[localIdx]!.type;
      if (lt.tag === "funcref") {
        // call_ref: push args first, then funcref on top (wasm spec order).
        for (const a of expr.args) this.emitExpr(a);
        this.push(0x20, ...uleb128(localIdx));  // local.get funcref (on top)
        const sigIdx = this.ctx.funcSigIdx(lt.params, lt.ret);
        this.push(0x14, ...uleb128(sigIdx));  // call_ref
        return;
      }
    }

    // Regular function call (possibly with typeQual for static methods).
    const mangledName = expr.typeQual
      ? `${this.ctx.resolveStructName(expr.typeQual)}$${expr.func}`
      : expr.func;

    // Check if it's a static method on a struct (typeQual present).
    let fi = this.ctx.funcIdx.get(mangledName);
    if (fi === undefined) {
      throw new Error(`wacEmitFunc: unknown function '${mangledName}'`);
    }

    for (const a of expr.args) this.emitExpr(a);
    this.push(0x10, ...uleb128(fi));  // call
  }

  // Emit default construction for a struct. Uses struct.new_default when all fields
  // are wasm-defaultable (primitives, nullable), otherwise explicit defaults + struct.new.
  private emitStructDefault(canonicalName: string, tidx: number): void {
    const allFields = this.ctx.structAllFields(canonicalName);
    const needsExplicit = allFields.some(f => !this.isWasmDefaultable(f.type));
    if (needsExplicit) {
      for (const f of allFields) this.emitDefaultValue(f.type);
      this.push(0xFB, 0x00, ...uleb128(tidx));  // struct.new
    } else {
      this.push(0xFB, 0x01, ...uleb128(tidx));  // struct.new_default
    }
  }

  // Returns true if a type has a WasmGC default value (i.e., struct.new_default is valid for it).
  private isWasmDefaultable(t: WacType): boolean {
    switch (t.tag) {
      case "i32": case "i64": case "f32": case "f64": case "bool":
      case "i8": case "i16":
        return true;
      case "nullable": case "anyref": case "i31ref":
        return true;
      default:
        return false;
    }
  }

  // Push a default value for any wac type onto the wasm stack.
  private emitDefaultValue(t: WacType): void {
    switch (t.tag) {
      case "i32": case "bool": case "i8": case "i16":
        this.push(0x41, 0x00);  // i32.const 0
        break;
      case "i64":
        this.push(0x42, 0x00);  // i64.const 0
        break;
      case "f32":
        this.push(0x43, 0x00, 0x00, 0x00, 0x00);  // f32.const 0.0
        break;
      case "f64":
        this.push(0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);  // f64.const 0.0
        break;
      case "nullable": {
        // ref.null heaptype
        const htBytes = this.encodeHeapType(t.inner);
        this.push(0xD0, ...htBytes);
        break;
      }
      case "anyref":
        this.push(0xD0, 0x6E);  // ref.null any
        break;
      case "i31ref":
        this.push(0xD0, 0x6C);  // ref.null i31
        break;
      case "named": {
        // Non-nullable struct: recursively construct with defaults.
        const tidx = this.ctx.structTypeIdx.get(t.name)!;
        this.emitStructDefault(t.name, tidx);
        break;
      }
      case "array": {
        // Default for an array type is an empty array (0 elements).
        // array.new_fixed $t 0 is valid for any element type since no elements need values.
        const arrTidx = this.ctx.arrayTypeIdx(t.elem);
        this.push(0xFB, 0x08, ...uleb128(arrTidx), 0x00);  // array.new_fixed 0
        break;
      }
      default:
        throw new Error(`emitDefaultValue: no default for type ${(t as WacType).tag}`);
    }
  }

  private emitConstruct(expr: Extract<Expr, { tag: "construct" }>): void {
    // expr.name may be a local alias; resolve to canonical name for type index lookup.
    const canonicalName = this.ctx.resolveStructName(expr.name);
    const tidx = this.ctx.structTypeIdx.get(canonicalName)!;
    if (expr.form === "default") {
      this.emitStructDefault(canonicalName, tidx);
      return;
    }
    // named form: push fields in declaration order.
    const fields = this.ctx.structAllFields(canonicalName);
    for (const field of fields) {
      const fi = expr.fields!.find(f => f.name === field.name)!;
      this.emitExpr(fi.value, field.type);
    }
    this.push(0xFB, 0x00, ...uleb128(tidx));  // struct.new
  }

  private emitArrayNew(expr: Extract<Expr, { tag: "array_new" }>): void {
    const elemType = this.resolveType(expr.elemType);
    const tidx = this.ctx.arrayTypeIdx(elemType);
    if (expr.elems !== undefined) {
      // Explicit elements: i32[](1, 2, 3) → array.new_fixed
      for (const e of expr.elems) this.emitExpr(e);
      this.push(0xFB, 0x08, ...uleb128(tidx), ...uleb128(expr.elems.length));
    } else if (this.isWasmDefaultable(elemType)) {
      // Element type has a WasmGC default → array.new_default
      this.emitExpr(expr.size!);
      this.push(0xFB, 0x07, ...uleb128(tidx));  // array.new_default
    } else if (expr.size?.tag === "int") {
      // Non-defaultable element type, literal size → array.new_fixed with n explicit defaults.
      const n = expr.size.value;
      for (let i = 0; i < n; i++) this.emitDefaultValue(elemType);
      this.push(0xFB, 0x08, ...uleb128(tidx), ...uleb128(n));  // array.new_fixed n
    } else {
      // Non-defaultable element, runtime size — emit explicit default + array.new (aliased fill).
      this.emitDefaultValue(elemType);
      this.emitExpr(expr.size!);
      this.push(0xFB, 0x06, ...uleb128(tidx));  // array.new (fill, aliased for refs)
    }
  }

  private emitFieldRead(object: Expr, name: string): void {
    const objType = this.ctx.exprType.get(object)!;
    const structName = this.extractStructName(objType)!;
    const fields = this.ctx.structAllFields(structName);
    const field = fields.find(f => f.name === name)!;
    const tidx = this.ctx.structTypeIdx.get(structName)!;
    this.emitExpr(object);
    this.push(0xFB, 0x02, ...uleb128(tidx), ...uleb128(field.absFieldIdx));  // struct.get
  }

  private emitMethod(expr: Extract<Expr, { tag: "method" }>): void {
    const objType = this.ctx.exprType.get(expr.object)!;
    // String-specific method calls
    if (objType.tag === "string") {
      if (expr.name === "len") {
        this.emitExpr(expr.object);
        this.push(0xFB, 0x0F);  // array.len
        return;
      }
      if (expr.name === "slice") {
        this.emitExpr(expr.object);
        this.emitExpr(expr.args[0]!);
        this.emitExpr(expr.args[1]!);
        const fi = this.ctx.stringHelperIdx!("slice");
        this.push(0x10, ...uleb128(fi));
        return;
      }
      if (expr.name === "indexOf") {
        this.emitExpr(expr.object);
        this.emitExpr(expr.args[0]!);
        const fi = this.ctx.stringHelperIdx!("indexof");
        this.push(0x10, ...uleb128(fi));
        return;
      }
    }
    // For array.len()
    if (objType.tag === "array") {
      if (expr.name === "len") {
        this.emitExpr(expr.object);
        this.push(0xFB, 0x0F);  // array.len
        return;
      }
    }
    // Check if calling a funcref field (e.g., h.callback(5))
    const actual = objType.tag === "nullable" ? objType.inner : objType;
    if (actual.tag === "named") {
      const fields = this.ctx.structAllFields(actual.name);
      const fnField = fields.find(f => f.name === expr.name && f.type.tag === "funcref");
      if (fnField) {
        const ft = fnField.type as Extract<typeof fnField.type, { tag: "funcref" }>;
        const sigIdx = this.ctx.funcSigIdx(ft.params, ft.ret);
        // call_ref: push args first, then funcref on top
        for (const a of expr.args) this.emitExpr(a);
        this.emitFieldRead(expr.object, expr.name);
        this.push(0x14, ...uleb128(sigIdx));  // call_ref
        return;
      }
    }
    // Struct method call — walk up the inheritance chain to find the declaring struct.
    const structName = this.extractStructName(objType)!;
    let searchName: string | undefined = structName;
    let fi: number | undefined;
    while (searchName !== undefined) {
      fi = this.ctx.funcIdx.get(`${searchName}$${expr.name}`);
      if (fi !== undefined) break;
      searchName = this.ctx.structParent(searchName);
    }
    if (fi === undefined) throw new Error(`wacEmitFunc: unknown method '${structName}.${expr.name}'`);
    // Push object (this) first, then args.
    this.emitExpr(expr.object);
    for (const a of expr.args) this.emitExpr(a);
    this.push(0x10, ...uleb128(fi));  // call
  }

  private emitCallExpr(expr: Extract<Expr, { tag: "callexpr" }>): void {
    // Get funcref type from callee
    const calleeType = this.ctx.exprType.get(expr.callee)!;
    const ft = calleeType.tag === "funcref" ? calleeType :
               calleeType.tag === "nullable" && calleeType.inner.tag === "funcref" ? calleeType.inner :
               null;
    if (!ft) throw new Error("callexpr: callee is not a funcref");
    const sigIdx = this.ctx.funcSigIdx(ft.params, ft.ret);
    // call_ref: push args first, then funcref on top
    for (const a of expr.args) this.emitExpr(a);
    this.emitExpr(expr.callee);
    this.push(0x14, ...uleb128(sigIdx));  // call_ref
  }

  private emitArrayGet(object: Expr, idx: Expr): void {
    const objType = this.ctx.exprType.get(object)!;
    if (objType.tag === "string") {
      // string[i] returns a string (single codepoint as a new string)
      this.emitExpr(object);
      this.emitExpr(idx);
      const fi = this.ctx.stringHelperIdx!("idx");
      this.push(0x10, ...uleb128(fi));
      return;
    }
    let elemType: WacType;
    if (objType.tag === "array")       { elemType = objType.elem; }
    else                               { elemType = { tag: "i32" }; }
    const tidx = this.ctx.arrayTypeIdx(elemType);
    this.emitExpr(object);
    this.emitExpr(idx);
    if (elemType.tag === "i8" || elemType.tag === "i16") {
      this.push(0xFB, 0x0D, ...uleb128(tidx));  // array.get_u (zero-extend)
    } else {
      this.push(0xFB, 0x0B, ...uleb128(tidx));  // array.get
    }
  }

  private emitStringLiteral(value: string): void {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(value);
    // Emit each byte as i32.const, then array.new_fixed.
    const tidx = this.ctx.arrayTypeIdx({ tag: "i8" });
    for (const b of bytes) this.push(0x41, ...sleb128(b));
    this.push(0xFB, 0x08, ...uleb128(tidx), ...uleb128(bytes.length));
  }

  // ---- LVal helpers ----

  // Emit a write to an lval. emitVal() emits the new value onto the stack.
  private emitLValWrite(lval: LVal, emitVal: () => void): void {
    if (lval.ops.length === 0) {
      emitVal();
      this.push(0x21, ...uleb128(this.getLocalIdx(lval.name)));
      return;
    }
    const last = lval.ops[lval.ops.length - 1]!;
    if (last.tag === "field") {
      const baseOps = lval.ops.slice(0, -1);
      this.emitLValBase(lval.name, baseOps);
      emitVal();
      const structType = this.lvalBaseType(lval.name, baseOps);
      const structName = this.extractStructName(structType)!;
      const fields = this.ctx.structAllFields(structName);
      const field = fields.find(f => f.name === last.name)!;
      const tidx = this.ctx.structTypeIdx.get(structName)!;
      this.push(0xFB, 0x05, ...uleb128(tidx), ...uleb128(field.absFieldIdx));  // struct.set
    } else if (last.tag === "index") {
      const baseOps = lval.ops.slice(0, -1);
      const arrType = this.lvalBaseType(lval.name, baseOps);
      let elemType: WacType;
      if (arrType.tag === "array") { elemType = arrType.elem; }
      else                         { elemType = { tag: "i8" }; }
      const tidx = this.ctx.arrayTypeIdx(elemType);
      this.emitLValBase(lval.name, baseOps);
      this.emitExpr(last.idx);
      emitVal();
      this.push(0xFB, 0x0E, ...uleb128(tidx));  // array.set
    }
  }

  // Emit compound assignment: lval op= rhs
  private emitCompound(lval: LVal, op: CompoundOp, rhs: Expr): void {
    const base = op.replace("=", "") as BinOp;
    if (lval.ops.length === 0) {
      const idx = this.getLocalIdx(lval.name);
      const t = this.getLocalType(lval.name);
      // String += (concatenation)
      if (t.tag === "string" && op === "+=") {
        this.push(0x20, ...uleb128(idx));  // local.get s
        this.emitExpr(rhs);
        const fi = this.ctx.stringHelperIdx!("concat");
        this.push(0x10, ...uleb128(fi));
        this.push(0x21, ...uleb128(idx));  // local.set s
        return;
      }
      this.push(0x20, ...uleb128(idx));  // local.get
      this.emitExpr(rhs);
      this.push(...this.binopcode(base, t));
      this.push(0x21, ...uleb128(idx));  // local.set
      return;
    }
    const last = lval.ops[lval.ops.length - 1]!;
    if (last.tag === "field") {
      // "push base twice" trick.
      const baseOps = lval.ops.slice(0, -1);
      const structType = this.lvalBaseType(lval.name, baseOps);
      const structName = this.extractStructName(structType)!;
      const fields = this.ctx.structAllFields(structName);
      const field = fields.find(f => f.name === last.name)!;
      const tidx = this.ctx.structTypeIdx.get(structName)!;
      const ft = field.type;
      // Push base for write, then base for read+compute.
      this.emitLValBase(lval.name, baseOps);  // [ref_w]
      this.emitLValBase(lval.name, baseOps);  // [ref_w, ref_r]
      this.push(0xFB, 0x02, ...uleb128(tidx), ...uleb128(field.absFieldIdx));  // struct.get → [ref_w, old]
      this.emitExpr(rhs);
      this.push(...this.binopcode(base, ft));   // [ref_w, new]
      this.push(0xFB, 0x05, ...uleb128(tidx), ...uleb128(field.absFieldIdx));  // struct.set
    } else if (last.tag === "index") {
      // Use scratch_i32 for the index to avoid double evaluation.
      const baseOps = lval.ops.slice(0, -1);
      const arrType = this.lvalBaseType(lval.name, baseOps);
      let elemType: WacType;
      if (arrType.tag === "array") { elemType = arrType.elem; }
      else                         { elemType = { tag: "i8" }; }
      const tidx = this.ctx.arrayTypeIdx(elemType);
      this.emitExpr(last.idx);
      this.push(0x21, ...uleb128(this.firstScratch));  // local.set scratch_i32
      // [arr_w, idx_w, arr_r, idx_r]
      this.emitLValBase(lval.name, baseOps);
      this.push(0x20, ...uleb128(this.firstScratch));  // scratch_i32
      this.emitLValBase(lval.name, baseOps);
      this.push(0x20, ...uleb128(this.firstScratch));
      // array.get → [arr_w, idx_w, old]
      if (elemType.tag === "i8" || elemType.tag === "i16") {
        this.push(0xFB, 0x0D, ...uleb128(tidx));  // array.get_u
      } else {
        this.push(0xFB, 0x0B, ...uleb128(tidx));
      }
      this.emitExpr(rhs);
      this.push(...this.binopcode(base, elemType.tag === "i8" || elemType.tag === "i16" ? { tag: "i32" } : elemType));
      this.push(0xFB, 0x0E, ...uleb128(tidx));  // array.set
    }
  }

  // Emit increment/decrement.
  private emitIncr(lval: LVal, op: "++" | "--"): void {
    if (lval.ops.length === 0) {
      const idx = this.getLocalIdx(lval.name);
      const t = this.getLocalType(lval.name);
      const is64 = t.tag === "i64";
      this.push(0x20, ...uleb128(idx));
      if (is64) { this.push(0x42, 0x01); this.push(op === "++" ? 0x7C : 0x7D); }
      else       { this.push(0x41, 0x01); this.push(op === "++" ? 0x6A : 0x6B); }
      this.push(0x21, ...uleb128(idx));
      return;
    }
    // Use compound with i32.const 1 or i64.const 1.
    const fakeCompound: CompoundOp = op === "++" ? "+=" : "-=";
    // Build a constant expression for 1.
    const lvalType = this.lvalLastType(lval);
    const is64 = lvalType?.tag === "i64";
    let one: Expr;
    if (is64) { one = { tag: "int64", value: 1n, line: 0, col: 0 }; }
    else       { one = { tag: "int",   value: 1,  line: 0, col: 0 }; }
    this.ctx.exprType.set(one, is64 ? { tag: "i64" } : { tag: "i32" });
    this.emitCompound(lval, fakeCompound, one);
  }

  // Emit the base object (ref) for an lval chain, applying all ops except the last.
  private emitLValBase(name: string, ops: LValOp[]): void {
    this.push(0x20, ...uleb128(this.getLocalIdx(name)));  // local.get root
    let t: WacType = this.getLocalType(name);
    for (const op of ops) {
      if (op.tag === "unwrap") {
        this.push(0xD4);  // ref.as_non_null
        t = (t as Extract<WacType, { tag: "nullable" }>).inner;
      } else if (op.tag === "field") {
        const actual = t.tag === "nullable" ? (t as Extract<WacType, { tag: "nullable" }>).inner : t;
        const structName = this.extractStructName(actual)!;
        const fields = this.ctx.structAllFields(structName);
        const field = fields.find(f => f.name === (op as Extract<LValOp, { tag: "field" }>).name)!;
        const tidx = this.ctx.structTypeIdx.get(structName)!;
        this.push(0xFB, 0x02, ...uleb128(tidx), ...uleb128(field.absFieldIdx));  // struct.get
        t = field.type;
      } else {
        // index op — navigate to element (only makes sense for arrays of structs as base chain)
        const actual = t.tag === "array" ? (t as Extract<WacType, { tag: "array" }>).elem : t;
        this.emitExpr((op as Extract<LValOp, { tag: "index" }>).idx);
        const arrTidx = this.ctx.arrayTypeIdx(actual);
        this.push(0xFB, 0x0B, ...uleb128(arrTidx));  // array.get
        t = actual;
      }
    }
  }

  // Compute the type at the base of an lval chain (after applying ops except last).
  private lvalBaseType(name: string, ops: LValOp[]): WacType {
    let t: WacType = this.getLocalType(name);
    for (const op of ops) {
      if (op.tag === "unwrap") {
        t = (t as Extract<WacType, { tag: "nullable" }>).inner;
      } else if (op.tag === "field") {
        const sn = this.extractStructName(t)!;
        const fields = this.ctx.structAllFields(sn);
        t = fields.find(f => f.name === (op as any).name)!.type;
      } else if (op.tag === "index") {
        t = (t as Extract<WacType, { tag: "array" }>).elem;
      }
    }
    return t;
  }

  private lvalLastType(lval: LVal): WacType | undefined {
    const t = this.lvalBaseType(lval.name, lval.ops.slice(0, -1));
    const last = lval.ops[lval.ops.length - 1];
    if (!last) return this.getLocalType(lval.name);
    if (last.tag === "field") {
      const sn = this.extractStructName(t)!;
      const fields = this.ctx.structAllFields(sn);
      return fields.find(f => f.name === last.name)?.type;
    }
    if (last.tag === "index") {
      return (t as Extract<WacType, { tag: "array" }>).elem;
    }
    if (last.tag === "unwrap") return (t as Extract<WacType, { tag: "nullable" }>).inner;
    return undefined;
  }

  // ---- Switch ----

  private emitSwitch(stmt: Extract<Stmt, { tag: "switch" }>): void {
    // Collect case values, sorted.
    const caseVals = stmt.cases.map(c => {
      const e = c.value;
      if (e.tag !== "int") throw new Error("switch: case value must be int literal");
      return e.value;
    });
    const hasDefault = stmt.default_ !== undefined && stmt.default_.length > 0;

    // Sort cases by value, record original order.
    const sortedIdxByVal = new Map<number, number>();
    caseVals.forEach((v, i) => sortedIdxByVal.set(v, i));
    const sortedVals = [...new Set(caseVals)].sort((a, b) => a - b);

    const min = sortedVals.length > 0 ? sortedVals[0]! : 0;
    const max = sortedVals.length > 0 ? sortedVals[sortedVals.length - 1]! : 0;

    // Number of case blocks = sortedCases + (hasDefault ? 1 : 0)
    // We also need an exit block.
    const numCases = sortedVals.length;
    const numBlocks = numCases + (hasDefault ? 1 : 0);

    // Block structure (outer to inner): $exit, $default?, $case_{k-1}, ..., $case_0, $dispatch
    const exitLabel = this.labelDepth;

    // Push loopStack entry so break exits switch, continue uses enclosing loop's target.
    const outerContinue = this.loopStack.length > 0
      ? this.loopStack[this.loopStack.length - 1]!.continueLabel
      : -1;
    this.loopStack.push({ breakLabel: exitLabel, continueLabel: outerContinue });

    // Push $exit block.
    this.push(0x02, 0x40); this.labelDepth++;

    // Push case blocks from outermost to innermost (last case outermost, first case innermost).
    // Also push $default if present.
    const blockLabels: number[] = [];  // pre-push depths for each block, index 0 = first case
    if (hasDefault) {
      blockLabels.push(-1);  // placeholder for default, will be index numCases
    }
    // Push from outermost (high index) to innermost (index 0).
    const casePushOrder = [...sortedVals.keys()].reverse();
    const blockDepths: number[] = new Array(numCases);  // sorted case idx → pre-push depth

    // Push default block (outermost case-level block).
    if (hasDefault) {
      const defaultPrePush = this.labelDepth;
      this.push(0x02, 0x40); this.labelDepth++;
      (blockLabels as any).defaultDepth = defaultPrePush;
    }
    // Push case blocks (innermost first for sorting: push in reverse order).
    for (let i = numCases - 1; i >= 0; i--) {
      blockDepths[i] = this.labelDepth;
      this.push(0x02, 0x40); this.labelDepth++;
    }
    // Push dispatch block.
    const dispatchPrePush = this.labelDepth;
    this.push(0x02, 0x40); this.labelDepth++;

    // Emit dispatch: push expr, normalize, br_table.
    this.emitExpr(stmt.expr);
    if (min !== 0) {
      this.push(0x41, ...sleb128(min));
      this.push(0x6B);  // i32.sub
    }

    // Build br_table entries.
    const tableSize = max - min + 1;
    const defaultBrDepth = hasDefault
      ? this.labelDepth - (blockLabels as any).defaultDepth - 1
      : this.labelDepth - exitLabel - 1;  // fall through to exit if no default

    const tableEntries: number[] = [];
    for (let i = 0; i <= max - min; i++) {
      const val = min + i;
      const caseIdx = sortedIdxByVal.get(val);
      if (caseIdx !== undefined) {
        const sortedIdx = sortedVals.indexOf(val);
        const brDepth = this.labelDepth - blockDepths[sortedIdx]! - 1;
        tableEntries.push(...uleb128(brDepth));
      } else {
        tableEntries.push(...uleb128(defaultBrDepth));
      }
    }
    // br_table: vec(labels) + default
    this.push(0x0E, ...uleb128(tableSize), ...tableEntries, ...uleb128(defaultBrDepth));

    // End dispatch block.
    this.push(0x0B); this.labelDepth--;

    // Emit each case body (in sortedVals order, innermost first = index 0 first).
    for (let i = 0; i < sortedVals.length; i++) {
      // End the case block (this block just ended, falls into case i body).
      this.push(0x0B); this.labelDepth--;
      const origIdx = sortedIdxByVal.get(sortedVals[i]!)!;
      const caseStmts = stmt.cases[origIdx]!.body;
      for (const s of caseStmts) this.emitStmt(s);
      // Branch to exit.
      const brToExit = this.labelDepth - exitLabel - 1;
      if (brToExit >= 0) this.push(0x0C, ...uleb128(brToExit));
    }

    // Emit default body.
    if (hasDefault) {
      this.push(0x0B); this.labelDepth--;  // end default block
      for (const s of stmt.default_!) this.emitStmt(s);
    }

    this.loopStack.pop();
    this.push(0x0B); this.labelDepth--;  // end $exit
  }

  // ---- Type helpers ----

  private extractStructName(t: WacType): string | undefined {
    if (t.tag === "named") return t.name;
    if (t.tag === "nullable" && t.inner.tag === "named") return t.inner.name;
    return undefined;
  }

  private isRefType(t: WacType): boolean {
    switch (t.tag) {
      case "named": case "array": case "nullable": case "string":
      case "anyref": case "i31ref": case "funcref": return true;
      default: return false;
    }
  }

  private encodeValType(t: WacType): number[] {
    switch (t.tag) {
      case "i32": case "bool": return [0x7F];
      case "i64": return [0x7E];
      case "f32": return [0x7D];
      case "f64": return [0x7C];
      case "anyref": return [0x6E];
      case "i31ref": return [0x6C];
      case "string": return [0x64, ...uleb128(this.ctx.arrayTypeIdx({ tag: "i8" }))];
      case "named":  return [0x64, ...uleb128(this.ctx.structTypeIdx.get(t.name)!)];
      case "nullable": {
        const inner = t.inner;
        if (inner.tag === "named")   return [0x63, ...uleb128(this.ctx.structTypeIdx.get(inner.name)!)];
        if (inner.tag === "array")   return [0x63, ...uleb128(this.ctx.arrayTypeIdx(inner.elem))];
        if (inner.tag === "funcref") return [0x63, ...uleb128(this.ctx.funcSigIdx(inner.params, inner.ret))];
        if (inner.tag === "string")  return [0x63, ...uleb128(this.ctx.arrayTypeIdx({ tag: "i8" }))];
        if (inner.tag === "anyref")  return [0x6E];  // already nullable
        if (inner.tag === "i31ref")  return [0x6C];
        return [0x63, ...this.encodeHeapType(inner)];
      }
      case "array":   return [0x64, ...uleb128(this.ctx.arrayTypeIdx(t.elem))];
      // funcref locals are ref null so they can hold values from both ref.func and function calls
      case "funcref": return [0x63, ...uleb128(this.ctx.funcSigIdx(t.params, t.ret))];
      default: throw new Error(`encodeValType: unhandled ${(t as WacType).tag}`);
    }
  }

  private encodeBlockType(t: WacType | null): number[] {
    if (!t || t.tag === "void") return [0x40];
    return this.encodeValType(t);
  }

  private encodeHeapType(t: WacType): number[] {
    switch (t.tag) {
      case "named":   return sleb128(this.ctx.structTypeIdx.get(t.name)!);
      case "array":   return sleb128(this.ctx.arrayTypeIdx(t.elem));
      case "funcref": return sleb128(this.ctx.funcSigIdx(t.params, t.ret));
      case "string":  return sleb128(this.ctx.arrayTypeIdx({ tag: "i8" }));
      case "anyref":  return [0x6E];  // -18
      case "i31ref":  return [0x6C];  // -20
      default: throw new Error(`encodeHeapType: ${(t as WacType).tag}`);
    }
  }

  private heaptypeOfNullable(t: WacType): number[] {
    if (t.tag === "nullable") return this.encodeHeapType(t.inner);
    if (t.tag === "anyref")   return [0x6E];
    if (t.tag === "i31ref")   return [0x6C];
    return this.encodeHeapType(t);  // fallback
  }

  // ---- Utility ----

  private push(...bytes: number[]): void {
    for (const b of bytes) this.out.push(b);
  }
}

// ---- Binary encoding helpers ----

function uleb128(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n & 0x7F;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
}

function sleb128(n: number): number[] {
  const out: number[] = [];
  let more = true;
  while (more) {
    let b = n & 0x7F;
    n >>= 7;
    if ((n === 0 && (b & 0x40) === 0) || (n === -1 && (b & 0x40) !== 0)) {
      more = false;
    } else {
      b |= 0x80;
    }
    out.push(b);
  }
  return out;
}

function sleb128i64(n: bigint): number[] {
  const out: number[] = [];
  let more = true;
  while (more) {
    const b = Number(n & 0x7Fn);
    n >>= 7n;
    if ((n === 0n && (b & 0x40) === 0) || (n === -1n && (b & 0x40) !== 0)) {
      more = false;
      out.push(b);
    } else {
      out.push(b | 0x80);
    }
  }
  return out;
}

function encodeF32(f: number): number[] {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, f, true);
  return [...new Uint8Array(buf)];
}

function encodeF64(f: number): number[] {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, f, true);
  return [...new Uint8Array(buf)];
}
