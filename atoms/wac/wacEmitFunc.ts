// wacEmitFunc — compiles one wac function body to WebAssembly GC bytecode.
//
// Assumes all types have been validated by wacTypeCheck. Input is a FuncEntry
// plus a WasmTypeCtx that provides wasm type/function indices for all names.
//
// V8/Deno WasmGC encoding (DIFFERS from final spec):
//   0x50 = sub non-final (open, can be extended)
//   0x4F = sub final
//   subtype structs must list ALL fields (inherited + own) in their field list

import {
  type WacType, type Expr, type Stmt, type Block,
  type Lvalue, type ElseBranch,
} from "./wacParse.ts";
import {
  type FuncEntry, type StructEntry, type ResolveResult,
  funcParams, funcReturnType,
} from "./wacResolve.ts";

// ── Public types ──────────────────────────────────────────────────────────────

/** Info about one field of a struct, including inherited fields. */
export type StructFieldInfo = {
  name: string;
  type: WacType;
  isConst: boolean;
  /** Absolute 0-based field index counting all fields from the root base. */
  absIdx: number;
};

/** Context passed to wacEmitFunc — all wasm type/function index lookups. */
export type WasmTypeCtx = {
  /** Struct name → wasm type section index */
  structTypeIdx: Map<string, number>;
  /** typeKey(elem) → wasm type section index for array of that elem type */
  arrTypeIdx: Map<string, number>;
  /** sigKey(params, ret) → wasm type section index for function signature */
  sigTypeIdx: Map<string, number>;
  /** Wasm type index for the i8 string array type */
  stringTypeIdx: number;
  /** Wasm function indices for built-in string helper functions (by name) */
  strHelperIdx: Map<string, number>;
  /** All fields (including inherited) for each struct, in order */
  structFields: Map<string, StructFieldInfo[]>;
  /** Immediate parent name for each struct, or null */
  structParent: Map<string, string | null>;
  /** Mangled function name → wasm function index */
  funcIdx: Map<string, number>;
  result: ResolveResult;
};

// ── LEB128 helpers ────────────────────────────────────────────────────────────

function uleb(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n & 0x7F;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
}

function sleb(n: number): number[] {
  const out: number[] = [];
  let more = true;
  while (more) {
    let b = n & 0x7F;
    n >>= 7;
    if ((n === 0 && !(b & 0x40)) || (n === -1 && !!(b & 0x40))) more = false;
    else b |= 0x80;
    out.push(b);
  }
  return out;
}

/** SLEB128-encode a BigInt (for i64.const instructions). */
function slebBig(n: bigint): number[] {
  const out: number[] = [];
  let more = true;
  while (more) {
    let b = Number(n & 0x7Fn);
    n >>= 7n;
    if ((n === 0n && !(b & 0x40)) || (n === -1n && !!(b & 0x40))) more = false;
    else b |= 0x80;
    out.push(b);
  }
  return out;
}

// ── Type key functions ────────────────────────────────────────────────────────

/** Stable string key for an array element type (used as map key). */
export function typeKey(t: WacType): string {
  switch (t.kind) {
    case "prim":     return t.name;
    case "struct":   return `S:${t.name}`;
    case "array":    return `A:${typeKey(t.elem)}`;
    case "nullable": return `?:${typeKey(t.inner)}`;
    case "funcref":  return `F:${sigKey(t.params, t.ret)}`;
  }
}

/** Stable key for a function signature. */
export function sigKey(params: WacType[], ret: WacType): string {
  return `(${params.map(typeKey).join(",")})=>${typeKey(ret)}`;
}

// ── Value type encoding ───────────────────────────────────────────────────────

/** Wasm value type bytes for a wac type (for locals section, block types, etc.). */
export function wasmValType(t: WacType, ctx: WasmTypeCtx): number[] {
  switch (t.kind) {
    case "prim": {
      const map: Record<string, number | undefined> = {
        i32: 0x7F, i64: 0x7E, f32: 0x7D, f64: 0x7C, bool: 0x7F,
        anyref: 0x6E, i31ref: 0x6C,
      };
      const code = map[t.name];
      if (code !== undefined) return [code];
      if (t.name === "string") return [0x64, ...sleb(ctx.stringTypeIdx)];
      if (t.name === "void")   return [0x40]; // only valid as block type
      return [0x7F]; // fallback
    }
    case "struct":   return [0x64, ...sleb(ctx.structTypeIdx.get(t.name)!)];
    case "array":    return [0x64, ...sleb(ctx.arrTypeIdx.get(typeKey(t.elem))!)];
    case "nullable": return wasmNullable(t.inner, ctx);
    case "funcref":  return [0x64, ...sleb(ctx.sigTypeIdx.get(sigKey(t.params, t.ret))!)];
  }
}

/** Nullable ref type bytes for a nullable wac type. */
function wasmNullable(inner: WacType, ctx: WasmTypeCtx): number[] {
  switch (inner.kind) {
    case "prim":
      if (inner.name === "anyref")  return [0x6E];
      if (inner.name === "i31ref")  return [0x63, 0x6C];
      if (inner.name === "string")  return [0x63, ...sleb(ctx.stringTypeIdx)];
      return [0x6E]; // fallback to anyref
    case "struct":   return [0x63, ...sleb(ctx.structTypeIdx.get(inner.name)!)];
    case "array":    return [0x63, ...sleb(ctx.arrTypeIdx.get(typeKey(inner.elem))!)];
    case "funcref":  return [0x63, ...sleb(ctx.sigTypeIdx.get(sigKey(inner.params, inner.ret))!)];
    case "nullable": return wasmNullable(inner.inner, ctx);
  }
}

/** The heap-type bytes used in ref.null, ref.cast, ref.test. */
export function heapTypeBytes(t: WacType, ctx: WasmTypeCtx): number[] {
  switch (t.kind) {
    case "prim":
      if (t.name === "anyref")  return [0x6E];
      if (t.name === "i31ref")  return [0x6C];
      if (t.name === "string")  return sleb(ctx.stringTypeIdx);
      return [0x6E]; // fallback
    case "struct":   return sleb(ctx.structTypeIdx.get(t.name)!);
    case "array":    return sleb(ctx.arrTypeIdx.get(typeKey(t.elem))!);
    case "funcref":  return sleb(ctx.sigTypeIdx.get(sigKey(t.params, t.ret))!);
    case "nullable": return heapTypeBytes(t.inner, ctx);
  }
}

// ── Method lookup ─────────────────────────────────────────────────────────────

/** Walk the struct inheritance chain to find a method (handles inherited methods). */
function lookupMethodInChain(
  structName: string, methodName: string, ctx: WasmTypeCtx,
): import("./wacResolve.ts").FuncEntry | null {
  let name: string | null | undefined = structName;
  while (name) {
    const entry = ctx.result.structs.find(s => s.name === name);
    const m = entry?.methods.get(methodName);
    if (m) return m;
    name = ctx.structParent.get(name);
  }
  return null;
}

// ── Type inference ────────────────────────────────────────────────────────────

type TypeEnv = Map<string, WacType>;
const VOID: WacType = { kind: "prim", name: "void", line: 0, col: 0 };
const I32:  WacType = { kind: "prim", name: "i32",  line: 0, col: 0 };
const BOOL: WacType = { kind: "prim", name: "bool", line: 0, col: 0 };

/** Infer the wac type of an expression given local variable types. */
export function typeOfExpr(e: Expr, env: TypeEnv, ctx: WasmTypeCtx): WacType {
  switch (e.kind) {
    case "int":    return I32;
    case "float":  return { kind: "prim", name: "f64", line: 0, col: 0 };
    case "bool":   return BOOL;
    case "string": return { kind: "prim", name: "string", line: 0, col: 0 };
    case "null":   return { kind: "prim", name: "anyref", line: 0, col: 0 };
    case "ident": {
      const v = env.get(e.name);
      if (v) return v;
      // Struct type name or function name
      if (ctx.structTypeIdx.has(e.name)) return { kind: "struct", name: e.name, line: 0, col: 0 };
      const fi = [...ctx.result.funcs].find(f =>
        f.mangledName === e.name || f.exportName === e.name ||
        (f.origin.kind === "func" && f.origin.decl.name === e.name));
      if (fi) {
        const params = funcParams(fi).map(p => p.type);
        return { kind: "funcref", params, ret: funcReturnType(fi), line: 0, col: 0 };
      }
      return I32;
    }
    case "unary": {
      if (e.op === "!") return BOOL;
      return typeOfExpr(e.expr, env, ctx);
    }
    case "binary": {
      const cmp = new Set(["==","!=","<","<=",">",">=","&&","||"]);
      if (cmp.has(e.op)) return BOOL;
      return typeOfExpr(e.left, env, ctx);
    }
    case "ternary": return typeOfExpr(e.then, env, ctx);
    case "cast": return e.type;
    case "is": return BOOL;
    case "unwrap": {
      const t = typeOfExpr(e.expr, env, ctx);
      return t.kind === "nullable" ? t.inner : t;
    }
    case "call": {
      if (e.callee.kind === "field") {
        const fe = e.callee as { kind: "field"; expr: Expr; name: string };
        const baseT = typeOfExpr(fe.expr, env, ctx);
        if (fe.name === "len") return I32; // arr.len() / string.len()
        // String methods
        if (baseT.kind === "prim" && baseT.name === "string") {
          if (fe.name === "slice") return { kind: "prim", name: "string", line: 0, col: 0 };
          if (fe.name === "indexOf") return I32;
        }
        const sName = structName(baseT);
        if (sName) {
          const meth = ctx.result.structs.find(s => s.name === sName)?.methods.get(fe.name);
          if (meth) return funcReturnType(meth);
        }
      }
      if (e.callee.kind === "ident") {
        const v = env.get(e.callee.name);
        if (v?.kind === "funcref") return v.ret;
        const calleeName = (e.callee as { kind: "ident"; name: string }).name;
        const fi2 = ctx.result.funcs.find(f =>
          f.mangledName === calleeName || f.exportName === calleeName ||
          (f.origin.kind === "func" && f.origin.decl.name === calleeName));
        if (fi2) return funcReturnType(fi2);
      }
      const calleeT = typeOfExpr(e.callee, env, ctx);
      if (calleeT.kind === "funcref") return calleeT.ret;
      return VOID;
    }
    case "field": {
      const baseT = typeOfExpr(e.expr, env, ctx);
      const sName = structName(baseT);
      if (sName) {
        const f = ctx.structFields.get(sName)?.find(f => f.name === e.name);
        if (f) return f.type;
        const meth = ctx.result.structs.find(s => s.name === sName)?.methods.get(e.name);
        if (meth) {
          const ps = funcParams(meth).map(p => p.type);
          return { kind: "funcref", params: ps, ret: funcReturnType(meth), line: 0, col: 0 };
        }
      }
      return I32;
    }
    case "index": {
      const t = typeOfExpr(e.expr, env, ctx);
      // String indexing returns a string
      if (t.kind === "prim" && t.name === "string") return { kind: "prim", name: "string", line: 0, col: 0 };
      const arr = t.kind === "array" ? t : t.kind === "nullable" && t.inner.kind === "array" ? t.inner : null;
      return arr ? arr.elem : I32;
    }
    case "construct": {
      // For struct types, return the struct type; for function-named constructs, return the func return type.
      if (e.ctype.kind === "struct" && !ctx.structTypeIdx.has((e.ctype as { name: string }).name)) {
        const ctypeName = (e.ctype as { name: string }).name;
        const fi = ctx.result.funcs.find(f =>
          f.mangledName === ctypeName ||
          (f.origin.kind === "func" && f.origin.decl.name === ctypeName));
        if (fi) return funcReturnType(fi);
        // Local funcref variable call
        const localT = env.get(ctypeName);
        if (localT?.kind === "funcref") return localT.ret;
      }
      return e.ctype;
    }
    case "arrNew": return { kind: "array", elem: e.elem, line: 0, col: 0 };
  }
}

/** Extract the struct name from a type (including nullable struct). */
function structName(t: WacType): string | null {
  if (t.kind === "struct") return t.name;
  if (t.kind === "nullable" && t.inner.kind === "struct") return t.inner.name;
  return null;
}

/** Type of an lvalue. */
function lvalType(lv: Lvalue, env: TypeEnv, ctx: WasmTypeCtx): WacType {
  switch (lv.kind) {
    case "lv-ident": return env.get(lv.name) ?? I32;
    case "lv-field": {
      const bt = lvalType(lv.base, env, ctx);
      const sn = structName(bt);
      if (sn) return ctx.structFields.get(sn)?.find(f => f.name === lv.field)?.type ?? I32;
      return I32;
    }
    case "lv-index": {
      const bt = lvalType(lv.base, env, ctx);
      if (bt.kind === "array") return bt.elem;
      if (bt.kind === "nullable" && bt.inner.kind === "array") return bt.inner.elem;
      return I32;
    }
  }
}

// ── Local variable collection ─────────────────────────────────────────────────

type LocalDecl = { name: string; type: WacType };

/** Walk all statements (recursively) to collect local var declarations with unique keys. */
function collectLocals(stmts: Stmt[]): { decls: LocalDecl[]; keyMap: WeakMap<Stmt, string> } {
  const decls: LocalDecl[] = [];
  const count = new Map<string, number>(); // how many times each name has been declared
  const keyMap = new WeakMap<Stmt, string>(); // var stmt → unique key
  function walk(ss: Stmt[]): void {
    for (const s of ss) {
      if (s.kind === "var") {
        const n = count.get(s.name) ?? 0;
        count.set(s.name, n + 1);
        const key = n === 0 ? s.name : `${s.name}$${n}`;
        decls.push({ name: key, type: s.type });
        keyMap.set(s, key);
      } else if (s.kind === "if") {
        walk(s.then.stmts);
        if (s.els?.kind === "else-block") walk(s.els.block.stmts);
        else if (s.els?.kind === "else-if") walk([s.els.stmt]);
      } else if (s.kind === "while" || s.kind === "dowhile") {
        walk(s.body.stmts);
      } else if (s.kind === "for") {
        if (s.init) walk([s.init]);
        walk(s.body.stmts);
      } else if (s.kind === "switch") {
        for (const c of s.cases) walk(c.body);
      } else if (s.kind === "block") {
        walk(s.block.stmts);
      }
    }
  }
  walk(stmts);
  return { decls, keyMap };
}

// ── String encoding ───────────────────────────────────────────────────────────

/** Convert a raw wac string value (with escape sequences) to UTF-8 bytes. */
function encodeString(raw: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      const map: Record<string, number> = { n:0x0A, t:0x09, r:0x0D, '\\':0x5C, '"':0x22, '0':0x00 };
      out.push(map[raw[i+1]] ?? raw.charCodeAt(i+1));
      i += 2;
    } else {
      const cp = raw.codePointAt(i)!;
      if (cp < 0x80) { out.push(cp); i++; }
      else if (cp < 0x800) { out.push(0xC0|(cp>>6), 0x80|(cp&0x3F)); i++; }
      else if (cp < 0x10000) { out.push(0xE0|(cp>>12), 0x80|((cp>>6)&0x3F), 0x80|(cp&0x3F)); i++; }
      else { out.push(0xF0|(cp>>18), 0x80|((cp>>12)&0x3F), 0x80|((cp>>6)&0x3F), 0x80|(cp&0x3F)); i+=2; }
    }
  }
  return out;
}

// ── Function body emitter ─────────────────────────────────────────────────────

type LocalInfo = { idx: number; type: WacType };

/** Loop context for break/continue tracking. */
type LoopCtx = { breakTarget: number; continueTarget: number };
// Each target is the labelDepth AT THE TIME of the block/loop creation.
// When we need to br to it, the distance = current labelDepth - target - 1.

class FuncEmitter {
  private out: number[] = [];
  readonly localMap: Map<string, LocalInfo> = new Map();
  /** Maps current variable name → unique localMap key (scope-aware). */
  readonly nameToKey: Map<string, string> = new Map();
  /** Maps each var Stmt to its unique localMap key (from collectLocals). */
  keyMap: WeakMap<Stmt, string> = new WeakMap();
  private ctx: WasmTypeCtx;
  private returnType: WacType;
  private loopStack: LoopCtx[] = [];
  /** Number of structured control blocks currently open. */
  private labelDepth = 0;
  /** Scratch i64 local index for checked/saturating i64 casts (set by wacEmitFunc). */
  tempI64Local = -1;

  constructor(ctx: WasmTypeCtx, returnType: WacType) {
    this.ctx = ctx;
    this.returnType = returnType;
  }

  getBytes(): number[] { return this.out; }

  private emit(...bytes: number[]): void { this.out.push(...bytes); }

  // ── Block type encoding ──

  private blockType(t: WacType): number[] {
    if (t.kind === "prim" && t.name === "void") return [0x40];
    return wasmValType(t, this.ctx);
  }

  // ── Helper: compute br depth to a target saved label depth ──

  private brDepth(savedDepth: number): number {
    return this.labelDepth - savedDepth - 1;
  }

  // ── Expression emitter ──

  emitExpr(e: Expr, env: TypeEnv, expectType?: WacType): void {
    switch (e.kind) {
      case "int": {
        const isI64 = expectType?.kind === "prim" && expectType.name === "i64";
        if (isI64) {
          this.emit(0x42, ...slebBig(BigInt(e.value))); // i64.const
        } else {
          this.emit(0x41, ...sleb(parseInt(e.value))); // i32.const (parseInt auto-detects 0x hex)
        }
        break;
      }
      case "float": {
        const v = parseFloat(e.value);
        // Use expect type to decide f32 vs f64; default to f64
        const isF32 = expectType?.kind === "prim" && expectType.name === "f32";
        if (isF32) {
          const buf = new ArrayBuffer(4);
          new DataView(buf).setFloat32(0, v, true);
          this.emit(0x43, ...new Uint8Array(buf)); // f32.const
        } else {
          const buf = new ArrayBuffer(8);
          new DataView(buf).setFloat64(0, v, true);
          this.emit(0x44, ...new Uint8Array(buf)); // f64.const
        }
        break;
      }
      case "bool":  this.emit(0x41, e.value ? 1 : 0); break; // i32.const
      case "null": {
        const target = expectType ?? { kind: "prim", name: "anyref", line: 0, col: 0 } as WacType;
        this.emit(0xD0, ...heapTypeBytes(target, this.ctx)); // ref.null heapType
        break;
      }
      case "string": {
        const bytes = encodeString(e.value);
        for (const b of bytes) this.emit(0x41, ...sleb(b)); // push each byte as i32
        this.emit(0xFB, 0x08, ...uleb(this.ctx.stringTypeIdx), ...uleb(bytes.length));
        break;
      }
      case "ident": {
        const key = this.nameToKey.get(e.name) ?? e.name;
        const loc = this.localMap.get(key);
        if (loc) { this.emit(0x20, ...uleb(loc.idx)); break; } // local.get
        // Named function reference
        const fIdx = this.ctx.funcIdx.get(e.name);
        if (fIdx !== undefined) this.emit(0xD2, ...uleb(fIdx)); // ref.func
        break;
      }
      case "unary": {
        const operT = typeOfExpr(e.expr, env, this.ctx);
        const prim  = operT.kind === "prim" ? operT.name : "i32";
        switch (e.op) {
          case "-":
            if (prim === "f32") { this.emitExpr(e.expr, env); this.emit(0x8C); }  // f32.neg
            else if (prim === "f64") { this.emitExpr(e.expr, env); this.emit(0x9A); } // f64.neg
            else if (prim === "i64") {
              this.emitExpr(e.expr, env);
              this.emit(0x42, 0x7F, 0x7E); // i64.const -1; i64.mul
            } else {
              this.emitExpr(e.expr, env);
              this.emit(0x41, 0x7F, 0x6C); // i32.const -1; i32.mul
            }
            break;
          case "!": this.emitExpr(e.expr, env); this.emit(0x45); break; // i32.eqz
          case "~":
            this.emitExpr(e.expr, env);
            if (prim === "i64") this.emit(0x42, 0x7F, 0x85); // i64.const -1; i64.xor
            else this.emit(0x41, 0x7F, 0x73);                 // i32.const -1; i32.xor
            break;
        }
        break;
      }
      case "binary": this.emitBinary(e, env); break;
      case "ternary": {
        const resT = typeOfExpr(e.then, env, this.ctx);
        this.emitExpr(e.cond, env);
        this.emit(0x04, ...this.blockType(resT)); // if (result T)
        this.labelDepth++;
        this.emitExpr(e.then, env);
        this.emit(0x05); // else
        this.emitExpr(e.else_, env);
        this.emit(0x0B); // end
        this.labelDepth--;
        break;
      }
      case "cast":   this.emitCast(e, env); break;
      case "is":     this.emitIs(e, env); break;
      case "unwrap": this.emitExpr(e.expr, env); this.emit(0xD4); break; // ref.as_non_null
      case "call":   this.emitCall(e, env); break;
      case "field":  this.emitField(e, env); break;
      case "index":  this.emitIndex(e, env); break;
      case "construct": this.emitConstruct(e, env); break;
      case "arrNew":    this.emitArrNew(e, env); break;
    }
  }

  private emitBinary(
    e: { kind: "binary"; op: string; left: Expr; right: Expr },
    env: TypeEnv,
  ): void {
    const op = e.op;

    // Short-circuit boolean operators
    if (op === "&&") {
      this.emitExpr(e.left, env);
      this.emit(0x04, 0x7F); // if (result i32)
      this.labelDepth++;
      this.emitExpr(e.right, env);
      this.emit(0x05, 0x41, 0x00, 0x0B); // else; i32.const 0; end
      this.labelDepth--;
      return;
    }
    if (op === "||") {
      this.emitExpr(e.left, env);
      this.emit(0x04, 0x7F); // if (result i32)
      this.labelDepth++;
      this.emit(0x41, 0x01, 0x05); // i32.const 1; else
      this.emitExpr(e.right, env);
      this.emit(0x0B); // end
      this.labelDepth--;
      return;
    }

    // Emit both operands (pass peer type for null literals in ref comparisons)
    const leftIsNull = e.left.kind === "null";
    const rightIsNull = e.right.kind === "null";
    if ((op === "==" || op === "!=") && (leftIsNull || rightIsNull)) {
      if (leftIsNull) {
        this.emitExpr(e.left, env, typeOfExpr(e.right, env, this.ctx));
        this.emitExpr(e.right, env);
      } else {
        this.emitExpr(e.left, env);
        this.emitExpr(e.right, env, typeOfExpr(e.left, env, this.ctx));
      }
    } else {
      this.emitExpr(e.left, env);
      this.emitExpr(e.right, env);
      // i64 << i32 / i64 >> i32: widen the rhs to i64 for the wasm instruction
      if ((op === "<<" || op === ">>" || op === ">>>")) {
        const lt2 = typeOfExpr(e.left, env, this.ctx);
        const rt2 = typeOfExpr(e.right, env, this.ctx);
        if (lt2.kind === "prim" && lt2.name === "i64" &&
            rt2.kind === "prim" && rt2.name === "i32") {
          this.emit(0xAC); // i64.extend_i32_s
        }
      }
    }

    const lt = typeOfExpr(e.left, env, this.ctx);
    const isStr = lt.kind === "prim" && lt.name === "string";

    // String operations via helper functions
    if (isStr) {
      const cmpIdx = this.ctx.strHelperIdx.get("__str_cmp")!;
      const concatIdx = this.ctx.strHelperIdx.get("__str_concat")!;
      if (op === "+") {
        this.emit(0x10, ...uleb(concatIdx)); // call __str_concat
        return;
      }
      if (op === "==") {
        this.emit(0x10, ...uleb(cmpIdx)); // call __str_cmp
        this.emit(0x45);                  // i32.eqz
        return;
      }
      if (op === "!=") {
        this.emit(0x10, ...uleb(cmpIdx)); // call __str_cmp
        this.emit(0x45, 0x45);            // i32.eqz; i32.eqz
        return;
      }
      if (op === "<") {
        this.emit(0x10, ...uleb(cmpIdx)); // call __str_cmp
        this.emit(0x41, 0x00, 0x48);      // i32.const 0; i32.lt_s
        return;
      }
      if (op === "<=") {
        this.emit(0x10, ...uleb(cmpIdx)); // call __str_cmp
        this.emit(0x41, 0x00, 0x4C);      // i32.const 0; i32.le_s
        return;
      }
      if (op === ">") {
        this.emit(0x10, ...uleb(cmpIdx)); // call __str_cmp
        this.emit(0x41, 0x00, 0x4A);      // i32.const 0; i32.gt_s
        return;
      }
      if (op === ">=") {
        this.emit(0x10, ...uleb(cmpIdx)); // call __str_cmp
        this.emit(0x41, 0x00, 0x4E);      // i32.const 0; i32.ge_s
        return;
      }
    }

    const isRef = lt.kind === "struct" || lt.kind === "array" || lt.kind === "nullable" ||
                  (lt.kind === "prim" && (lt.name === "anyref" || lt.name === "i31ref" || lt.name === "string"));

    // Reference equality (non-string refs)
    if ((op === "==" || op === "!=") && isRef) {
      this.emit(0xD3); // ref.eq (V8/Deno encoding: 0xD3)
      if (op === "!=") this.emit(0x45);
      return;
    }

    const p = lt.kind === "prim" ? lt.name : "i32";
    const k = p === "bool" || p === "i8" || p === "i16" ? "i32"
            : p === "i32" ? "i32" : p === "i64" ? "i64"
            : p === "f32" ? "f32" : "f64";
    type KT = "i32" | "i64" | "f32" | "f64";
    const ops: Record<string, Record<KT, number[]>> = {
      "+":   { i32:[0x6A], i64:[0x7C], f32:[0x92], f64:[0xA0] },
      "-":   { i32:[0x6B], i64:[0x7D], f32:[0x93], f64:[0xA1] },
      "*":   { i32:[0x6C], i64:[0x7E], f32:[0x94], f64:[0xA2] },
      "/":   { i32:[0x6D], i64:[0x7F], f32:[0x95], f64:[0xA3] },
      "%":   { i32:[0x6F], i64:[0x81], f32:[0x95], f64:[0xA3] },
      "&":   { i32:[0x71], i64:[0x83], f32:[],     f64:[]     },
      "|":   { i32:[0x72], i64:[0x84], f32:[],     f64:[]     },
      "^":   { i32:[0x73], i64:[0x85], f32:[],     f64:[]     },
      "<<":  { i32:[0x74], i64:[0x86], f32:[],     f64:[]     },
      ">>":  { i32:[0x75], i64:[0x87], f32:[],     f64:[]     },
      ">>>": { i32:[0x76], i64:[0x88], f32:[],     f64:[]     },
      "==":  { i32:[0x46], i64:[0x51], f32:[0x5B], f64:[0x61] },
      "!=":  { i32:[0x47], i64:[0x52], f32:[0x5C], f64:[0x62] },
      "<":   { i32:[0x48], i64:[0x53], f32:[0x5D], f64:[0x63] },
      "<=":  { i32:[0x4C], i64:[0x57], f32:[0x5F], f64:[0x65] },
      ">":   { i32:[0x4A], i64:[0x55], f32:[0x5E], f64:[0x64] },
      ">=":  { i32:[0x4E], i64:[0x59], f32:[0x60], f64:[0x66] },
    };
    const oc = ops[op]?.[k as KT] ?? [];
    this.emit(...oc);
  }

  private emitCast(
    e: { kind: "cast"; op: string; expr: Expr; type: WacType },
    env: TypeEnv,
  ): void {
    const fromT = typeOfExpr(e.expr, env, this.ctx);
    const toT   = e.type;
    this.emitExpr(e.expr, env);

    const isRefFrom = fromT.kind !== "prim" ||
      fromT.name === "anyref" || fromT.name === "i31ref" || fromT.name === "string";
    const isRefTo = toT.kind !== "prim" ||
      toT.name === "anyref" || toT.name === "i31ref" || toT.name === "string";

    if (isRefFrom || isRefTo) {
      if (e.op === "as") {
        // i31ref → i32 lossless: needs i31.get_s even though "as" is normally a no-op
        if (fromT.kind === "prim" && fromT.name === "i31ref" &&
            toT.kind === "prim" && toT.name === "i32") {
          this.emit(0xFB, 0x1D); // i31.get_s
        }
        return; // other ref upcasts need no instruction
      }
      if (e.op === "as!") {
        // i32 → i31ref: ref.i31
        if (fromT.kind === "prim" && fromT.name === "i32" &&
            toT.kind === "prim" && toT.name === "i31ref") {
          this.emit(0xFB, 0x1C); // ref.i31
          return;
        }
        // i31ref → i32: i31.get_s
        if (fromT.kind === "prim" && fromT.name === "i31ref" &&
            toT.kind === "prim" && toT.name === "i32") {
          this.emit(0xFB, 0x1D); // i31.get_s
          return;
        }
        // ref.cast (ref $t) — downcasts struct/array
        this.emit(0xFB, 0x16, ...heapTypeBytes(toT, this.ctx));
        return;
      }
      return;
    }

    // i31ref → i32 for lossless "as"
    if (fromT.kind === "prim" && fromT.name === "i31ref" &&
        toT.kind === "prim" && toT.name === "i32") {
      this.emit(0xFB, 0x1D); // i31.get_s
      return;
    }

    this.emitNumericCast(fromT.name, toT.name, e.op);
  }

  private emitNumericCast(from: string, to: string, op: string): void {
    if (from === to) return;
    // Lossless (as)
    if (op === "as") {
      if (from === "i32"  && to === "i64") { this.emit(0xAC); return; } // i32.extend_s
      if (from === "bool" && to === "i32") return;
      if (from === "i32"  && to === "f64") { this.emit(0xB7); return; } // f64.convert_i32_s
      if (from === "f32"  && to === "f64") { this.emit(0xBB); return; } // f64.promote_f32
      if (from === "bool" && to === "i64") { this.emit(0xAC); return; }
      if (from === "i32"  && to === "f32") { this.emit(0xB2); return; } // f32.convert_i32_s
      if (from === "i64"  && to === "f64") { this.emit(0xB9); return; } // f64.convert_i64_s
    }
    // Checked (as!)
    if (op === "as!") {
      if (from === "i64" && to === "i32") {
        // Range-check then wrap: trap if outside [-2^31, 2^31-1]
        const tmp = this.tempI64Local;
        this.emit(0x22, ...uleb(tmp));                   // local.tee $tmp
        this.emit(0x42, ...slebBig(2147483647n));        // i64.const MAX
        this.emit(0x55);                                 // i64.gt_s
        this.emit(0x04, 0x40);                           // if (void)
        this.emit(0x00);                                 //   unreachable
        this.emit(0x0B);                                 // end
        this.emit(0x20, ...uleb(tmp));                   // local.get $tmp
        this.emit(0x42, ...slebBig(-2147483648n));       // i64.const MIN
        this.emit(0x53);                                 // i64.lt_s
        this.emit(0x04, 0x40);                           // if (void)
        this.emit(0x00);                                 //   unreachable
        this.emit(0x0B);                                 // end
        this.emit(0x20, ...uleb(tmp));                   // local.get $tmp
        this.emit(0xA7);                                 // i32.wrap_i64
        return;
      }
      if (from === "f64" && to === "i32") { this.emit(0xAA); return; }  // i32.trunc_f64_s (traps)
      if (from === "f32" && to === "i32") { this.emit(0xA8); return; }  // i32.trunc_f32_s (traps)
      if (from === "f64" && to === "i64") { this.emit(0xB0); return; }  // i64.trunc_f64_s (traps)
      if (from === "f32" && to === "i64") { this.emit(0xAE); return; }  // i64.trunc_f32_s (traps)
    }
    // Nearest (as~): round-to-nearest, clamp on overflow, never traps
    if (op === "as~") {
      if (from === "i64" && to === "i32") {
        // Clamp to i32 range, then wrap
        const tmp = this.tempI64Local;
        this.emit(0x22, ...uleb(tmp));                   // local.tee $tmp
        this.emit(0x42, ...slebBig(2147483647n));        // i64.const MAX
        this.emit(0x55);                                 // i64.gt_s
        this.emit(0x04, 0x7E);                           // if (i64)
        this.emit(0x42, ...slebBig(2147483647n));        //   i64.const MAX
        this.emit(0x05);                                 // else
        this.emit(0x20, ...uleb(tmp));                   //   local.get $tmp
        this.emit(0x42, ...slebBig(-2147483648n));       //   i64.const MIN
        this.emit(0x53);                                 //   i64.lt_s
        this.emit(0x04, 0x7E);                           //   if (i64)
        this.emit(0x42, ...slebBig(-2147483648n));       //     i64.const MIN
        this.emit(0x05);                                 //   else
        this.emit(0x20, ...uleb(tmp));                   //     local.get $tmp
        this.emit(0x0B);                                 //   end
        this.emit(0x0B);                                 // end
        this.emit(0xA7);                                 // i32.wrap_i64
        return;
      }
      if (from === "f64" && to === "i32") {
        this.emit(0x9E);                  // f64.nearest (round to nearest, ties to even)
        this.emit(0xFC, 0x02);            // i32.trunc_sat_f64_s (clamp on overflow, no trap)
        return;
      }
      if (from === "f32" && to === "i32") {
        this.emit(0x90);                  // f32.nearest (round to nearest, ties to even)
        this.emit(0xFC, 0x00);            // i32.trunc_sat_f32_s (clamp on overflow, no trap)
        return;
      }
      if (from === "f64" && to === "f32")  { this.emit(0xB6); return; }       // f32.demote
      if (from === "i64" && to === "f64")  { this.emit(0xB9); return; }
      if (from === "i32" && to === "f32")  { this.emit(0xB2); return; }
    }
    // Raw (as@)
    if (op === "as@") {
      if (from === "i64" && to === "i32")  { this.emit(0xA7); return; }
      if (from === "f64" && to === "i32")  { this.emit(0xAA); return; }
      if (from === "f32" && to === "i32")  { this.emit(0xA8); return; }
      if (from === "f64" && to === "f32")  { this.emit(0xB6); return; }
    }
  }

  private emitIs(
    e: { kind: "is"; expr: Expr; not: boolean; rhs: WacType | "null" | Expr },
    env: TypeEnv,
  ): void {
    // WacType kinds are distinct from Expr kinds
    const WACTYPE_KINDS = new Set(["prim", "struct", "array", "nullable", "funcref"]);
    if (e.rhs === "null") {
      this.emitExpr(e.expr, env);
      this.emit(0xD1); // ref.is_null
    } else if (typeof e.rhs === "object" &&
               WACTYPE_KINDS.has((e.rhs as { kind: string }).kind) &&
               !("left" in (e.rhs as object)) && !("expr" in (e.rhs as object))) {
      // WacType (prim/struct/array/nullable/funcref — none of these have "left" or "expr")
      const rhs = e.rhs as WacType;
      this.emitExpr(e.expr, env);
      this.emit(0xFB, 0x14, ...heapTypeBytes(rhs, this.ctx)); // ref.test (ref $t)
    } else {
      // Expr comparison (ref.eq)
      this.emitExpr(e.expr, env);
      this.emitExpr(e.rhs as Expr, env);
      this.emit(0xD3); // ref.eq (V8/Deno encoding: 0xD3)
    }
    if (e.not) this.emit(0x45); // i32.eqz (invert)
  }

  private emitField(
    e: { kind: "field"; expr: Expr; name: string },
    env: TypeEnv,
  ): void {
    // StructName.method used as a funcref value: emit ref.func
    if (e.expr.kind === "ident") {
      const exprName = (e.expr as { name: string }).name;
      if (this.ctx.structTypeIdx.has(exprName)) {
        const structEntry = this.ctx.result.structs.find(s => s.name === exprName);
        const methEntry = structEntry?.methods.get(e.name);
        if (methEntry) {
          const fIdx = this.ctx.funcIdx.get(methEntry.mangledName)!;
          this.emit(0xD2, ...uleb(fIdx)); // ref.func
          return;
        }
      }
    }
    const baseT = typeOfExpr(e.expr, env, this.ctx);
    const sName = structName(baseT);
    if (sName) {
      const fields = this.ctx.structFields.get(sName) ?? [];
      const fi = fields.find(f => f.name === e.name);
      if (fi) {
        this.emitExpr(e.expr, env);
        const tIdx = this.ctx.structTypeIdx.get(sName)!;
        this.emit(0xFB, 0x02, ...uleb(tIdx), ...uleb(fi.absIdx)); // struct.get
        return;
      }
      // Method reference (not called here, handled in emitCall)
      const methEntry = this.ctx.result.structs.find(s => s.name === sName)?.methods.get(e.name);
      if (methEntry) {
        const fIdx = this.ctx.funcIdx.get(methEntry.mangledName)!;
        this.emit(0xD2, ...uleb(fIdx)); // ref.func
        return;
      }
    }
  }

  private emitIndex(
    e: { kind: "index"; expr: Expr; idx: Expr },
    env: TypeEnv,
  ): void {
    const t = typeOfExpr(e.expr, env, this.ctx);
    // String indexing: call __str_idx helper
    if (t.kind === "prim" && t.name === "string") {
      this.emitExpr(e.expr, env);
      this.emitExpr(e.idx, env);
      this.emit(0x10, ...uleb(this.ctx.strHelperIdx.get("__str_idx")!)); // call __str_idx
      return;
    }
    const elem = t.kind === "array" ? t.elem
               : t.kind === "nullable" && t.inner.kind === "array" ? t.inner.elem
               : I32;
    const aIdx = this.ctx.arrTypeIdx.get(typeKey(elem))!;
    this.emitExpr(e.expr, env);
    this.emitExpr(e.idx, env);
    // packed types use array.get_u (spec: zero-extends on read)
    const isPackedI8  = elem.kind === "prim" && elem.name === "i8";
    const isPackedI16 = elem.kind === "prim" && elem.name === "i16";
    if (isPackedI8 || isPackedI16) this.emit(0xFB, 0x0D, ...uleb(aIdx)); // array.get_u
    else                           this.emit(0xFB, 0x0B, ...uleb(aIdx)); // array.get
    // Non-nullable ref elements stored as nullable in wasm; unwrap to non-null
    if (elem.kind === "struct" || elem.kind === "array" || elem.kind === "funcref") {
      this.emit(0xD4); // ref.as_non_null
    }
  }

  private emitCall(
    e: { kind: "call"; callee: Expr; args: Expr[] },
    env: TypeEnv,
  ): void {
    // Method call: base.method(args)
    if (e.callee.kind === "field") {
      const fe = e.callee as { kind: "field"; expr: Expr; name: string };
      const baseT = typeOfExpr(fe.expr, env, this.ctx);
      // Built-in len() — works on arrays and strings regardless of struct
      if (fe.name === "len") {
        this.emitExpr(fe.expr, env);
        const elemType = baseT.kind === "array" ? baseT.elem
                       : baseT.kind === "nullable" && baseT.inner.kind === "array" ? baseT.inner.elem
                       : null;
        const isStr = baseT.kind === "prim" && baseT.name === "string";
        const aIdx2 = elemType ? (this.ctx.arrTypeIdx.get(typeKey(elemType)) ?? -1)
                    : isStr ? this.ctx.stringTypeIdx : -1;
        if (aIdx2 >= 0) this.emit(0xFB, 0x0F); // array.len (no immediate)
        return;
      }

      // String method calls
      if (baseT.kind === "prim" && baseT.name === "string") {
        if (fe.name === "slice") {
          this.emitExpr(fe.expr, env); // push string
          for (const arg of e.args) this.emitExpr(arg, env);
          this.emit(0x10, ...uleb(this.ctx.strHelperIdx.get("__str_slice")!)); // call __str_slice
          return;
        }
        if (fe.name === "indexOf") {
          this.emitExpr(fe.expr, env); // push string
          for (const arg of e.args) this.emitExpr(arg, env);
          this.emit(0x10, ...uleb(this.ctx.strHelperIdx.get("__str_indexof")!)); // call __str_indexof
          return;
        }
      }

      const sName = structName(baseT);
      if (sName) {
        // Instance method call: emit receiver, then args (walk inheritance chain)
        const meth = lookupMethodInChain(sName, fe.name, this.ctx);
        if (meth) {
          this.emitExpr(fe.expr, env); // push receiver
          for (const arg of e.args) this.emitExpr(arg, env);
          this.emit(0x10, ...uleb(this.ctx.funcIdx.get(meth.mangledName)!)); // call
          return;
        }
      }

      // Static method call: TypeName.method(args)
      if (fe.expr.kind === "ident") {
        const typeName = (fe.expr as { name: string }).name;
        if (this.ctx.structTypeIdx.has(typeName)) {
          const structEntry2 = this.ctx.result.structs.find(s => s.name === typeName);
          const meth2 = structEntry2?.methods.get(fe.name);
          if (meth2) {
            for (const arg of e.args) this.emitExpr(arg, env);
            this.emit(0x10, ...uleb(this.ctx.funcIdx.get(meth2.mangledName)!));
            return;
          }
        }
      }
    }

    // Direct function call: funcName(args)
    if (e.callee.kind === "ident") {
      const name = (e.callee as { name: string }).name;
      const fIdx = this.ctx.funcIdx.get(name);
      if (fIdx !== undefined) {
        for (const arg of e.args) this.emitExpr(arg, env);
        this.emit(0x10, ...uleb(fIdx)); // call
        return;
      }
    }

    // Funcref indirect call: f(args)
    const calleeT = typeOfExpr(e.callee, env, this.ctx);
    if (calleeT.kind === "funcref") {
      for (const arg of e.args) this.emitExpr(arg, env);
      this.emitExpr(e.callee, env); // funcref goes last (on top)
      const sIdx = this.ctx.sigTypeIdx.get(sigKey(calleeT.params, calleeT.ret))!;
      this.emit(0x14, ...uleb(sIdx)); // call_ref $type
      return;
    }
  }

  private emitConstruct(
    e: { kind: "construct"; ctype: WacType; args: Expr[]; named?: { name: string; val: Expr }[] },
    env: TypeEnv,
  ): void {
    if (e.ctype.kind === "struct") {
      const sName = e.ctype.name;
      // If the name is not a known struct type, treat as a function call.
      // (The parser uses "construct" for any ident(...) that isn't a prim type.)
      const tIdx  = this.ctx.structTypeIdx.get(sName);
      if (tIdx === undefined) {
        const fIdx = this.ctx.funcIdx.get(sName);
        if (fIdx !== undefined) {
          for (const arg of e.args) this.emitExpr(arg, env);
          this.emit(0x10, ...uleb(fIdx));
          return;
        }
        // Local funcref variable: f(args) where f is a local with funcref type
        const localT = env.get(sName);
        if (localT?.kind === "funcref") {
          for (const arg of e.args) this.emitExpr(arg, env);
          this.emit(0x20, ...uleb(this.localMap.get(sName)!.idx)); // local.get
          const sIdx = this.ctx.sigTypeIdx.get(sigKey(localT.params, localT.ret))!;
          this.emit(0x14, ...uleb(sIdx)); // call_ref $type
        }
        return;
      };
      const fields = this.ctx.structFields.get(sName) ?? [];

      if (e.args.length === 0 && (!e.named || e.named.length === 0)) {
        // Default construction: use struct.new_default if all fields are directly defaultable,
        // otherwise recursively emit defaults for each field and use struct.new.
        const allDirectlyDefaultable = fields.every(f =>
          f.type.kind !== "struct",  // struct fields need recursive default
        );
        if (allDirectlyDefaultable) {
          this.emit(0xFB, 0x01, ...uleb(tIdx)); // struct.new_default $t
        } else {
          for (const f of fields) this.emitDefaultValue(f.type);
          this.emit(0xFB, 0x00, ...uleb(tIdx)); // struct.new $t
        }
        return;
      }
      if (e.named) {
        // Named: reorder to field declaration order
        for (const f of fields) {
          const na = e.named.find(n => n.name === f.name)!;
          this.emitExpr(na.val, env);
        }
      } else {
        // Positional: emit in order
        for (const arg of e.args) this.emitExpr(arg, env);
      }
      this.emit(0xFB, 0x00, ...uleb(tIdx)); // struct.new $t
      return;
    }
    // Function call with named args or plain call via construct syntax
    if (e.ctype.kind === "prim") {
      const fIdx = this.ctx.funcIdx.get(e.ctype.name);
      if (fIdx !== undefined) {
        for (const arg of e.args) this.emitExpr(arg, env);
        this.emit(0x10, ...uleb(fIdx));
      }
    }
  }

  /** Emit a default (zero/null) value for the given type onto the stack. */
  private emitDefaultValue(t: WacType): void {
    switch (t.kind) {
      case "prim":
        if (t.name === "i32" || t.name === "bool" || t.name === "i8" || t.name === "i16")
          this.emit(0x41, 0x00); // i32.const 0
        else if (t.name === "i64")
          this.emit(0x42, 0x00); // i64.const 0
        else if (t.name === "f32")
          this.emit(0x43, 0x00, 0x00, 0x00, 0x00); // f32.const 0.0
        else if (t.name === "f64")
          this.emit(0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00); // f64.const 0.0
        break;
      case "nullable": {
        // ref.null with the inner type's heap type
        const hb = heapTypeBytes(t.inner, this.ctx);
        this.emit(0xD0, ...hb); // ref.null $t
        break;
      }
      case "struct": {
        const idx = this.ctx.structTypeIdx.get(t.name)!;
        const fields = this.ctx.structFields.get(t.name) ?? [];
        const allDirectlyDefaultable = fields.every(f => f.type.kind !== "struct");
        if (allDirectlyDefaultable) {
          this.emit(0xFB, 0x01, ...uleb(idx)); // struct.new_default $t
        } else {
          for (const f of fields) this.emitDefaultValue(f.type);
          this.emit(0xFB, 0x00, ...uleb(idx)); // struct.new $t
        }
        break;
      }
      case "array":
      case "funcref":
        // These should be nullable in defaultable contexts
        break;
    }
  }

  private emitArrNew(
    e: { kind: "arrNew"; elem: WacType; size: Expr | null; fixed: Expr[] },
    env: TypeEnv,
  ): void {
    const aIdx = this.ctx.arrTypeIdx.get(typeKey(e.elem))!;
    if (e.fixed.length > 0) {
      for (const item of e.fixed) this.emitExpr(item, env, e.elem);
      this.emit(0xFB, 0x08, ...uleb(aIdx), ...uleb(e.fixed.length)); // array.new_fixed
    } else if (e.size !== null) {
      // Struct element + literal size: initialize each element with default struct
      if (e.elem.kind === "struct" && e.size.kind === "int") {
        const n = parseInt(e.size.value);
        const sIdx = this.ctx.structTypeIdx.get(e.elem.name)!;
        for (let i = 0; i < n; i++) {
          this.emit(0xFB, 0x01, ...uleb(sIdx)); // struct.new_default $S
        }
        this.emit(0xFB, 0x08, ...uleb(aIdx), ...uleb(n)); // array.new_fixed N
      } else {
        this.emitExpr(e.size, env);
        this.emit(0xFB, 0x07, ...uleb(aIdx)); // array.new_default $t
      }
    } else {
      this.emit(0x41, 0x00, 0xFB, 0x07, ...uleb(aIdx)); // size=0, array.new_default
    }
  }

  // ── Statement emitter ──

  emitBlock(block: Block, env: TypeEnv): void {
    for (const s of block.stmts) this.emitStmt(s, env);
  }

  emitStmt(s: Stmt, env: TypeEnv): void {
    switch (s.kind) {
      case "var": {
        const init = s.init;
        const isNull = init.kind === "null";
        this.emitExpr(init, env, isNull ? s.type : undefined);
        const varKey = this.keyMap.get(s) ?? s.name;
        this.emit(0x21, ...uleb(this.localMap.get(varKey)!.idx)); // local.set
        this.nameToKey.set(s.name, varKey); // update scope: name → unique key
        env.set(s.name, s.type);
        break;
      }
      case "block": {
        // Bare block — scoped environment so inner vars don't leak
        const savedKeys = new Map(this.nameToKey);
        const savedEnv  = new Map(env);
        for (const stmt of s.block.stmts) this.emitStmt(stmt, env);
        // Restore outer scope
        for (const k of [...this.nameToKey.keys()]) {
          if (savedKeys.has(k)) this.nameToKey.set(k, savedKeys.get(k)!);
          else this.nameToKey.delete(k);
        }
        for (const k of [...env.keys()]) {
          if (savedEnv.has(k)) env.set(k, savedEnv.get(k)!);
          else env.delete(k);
        }
        break;
      }
      case "assign": this.emitAssign(s, env); break;
      case "incr": {
        const t = lvalType(s.lval, env, this.ctx);
        const is64 = t.kind === "prim" && t.name === "i64";
        // For ident: simple read-modify-write
        if (s.lval.kind === "lv-ident") {
          const key = this.nameToKey.get(s.lval.name) ?? s.lval.name;
          const idx = this.localMap.get(key)!.idx;
          this.emit(0x20, ...uleb(idx)); // local.get
          if (is64) {
            this.emit(0x42, 0x01, s.op === "++" ? 0x7C : 0x7D); // i64.const 1; i64.add/sub
          } else {
            this.emit(0x41, 0x01, s.op === "++" ? 0x6A : 0x6B); // i32.const 1; i32.add/sub
          }
          this.emit(0x21, ...uleb(idx)); // local.set
        } else {
          // Field/index: read, modify, write
          this.emitFieldIncrAssign(s.lval, s.op === "++" ? "+=" : "-=", env, t);
        }
        break;
      }
      case "if":      this.emitIf(s, env); break;
      case "while":   this.emitWhile(s, env); break;
      case "dowhile": this.emitDoWhile(s, env); break;
      case "for":     this.emitFor(s, env); break;
      case "switch":  this.emitSwitch(s, env); break;
      case "return":
        if (s.value) {
          // Pass return type as expected type so literals (int/null) are emitted correctly
          this.emitExpr(s.value, env, this.returnType);
        }
        this.emit(0x0F); // return
        break;
      case "break": {
        const lctx = this.loopStack[this.loopStack.length - 1];
        this.emit(0x0C, ...uleb(this.brDepth(lctx.breakTarget)));
        break;
      }
      case "continue": {
        const lctx = this.loopStack[this.loopStack.length - 1];
        this.emit(0x0C, ...uleb(this.brDepth(lctx.continueTarget)));
        break;
      }
      case "trap": this.emit(0x00); break; // unreachable
      case "expr": {
        const t = typeOfExpr(s.expr, env, this.ctx);
        this.emitExpr(s.expr, env);
        const isVoid = t.kind === "prim" && t.name === "void";
        if (!isVoid) this.emit(0x1A); // drop result
        break;
      }
    }
  }

  private emitAssign(
    s: { kind: "assign"; op: string; lval: Lvalue; rhs: Expr },
    env: TypeEnv,
  ): void {
    const { lval, op, rhs } = s;
    if (lval.kind === "lv-ident") {
      const key = this.nameToKey.get(lval.name) ?? lval.name;
      const idx = this.localMap.get(key)!.idx;
      if (op !== "=") {
        this.emit(0x20, ...uleb(idx)); // local.get (current value)
        this.emitExpr(rhs, env);
        this.emitBinOpCode(op.slice(0,-1), lvalType(lval, env, this.ctx));
      } else {
        const isNull = rhs.kind === "null";
        this.emitExpr(rhs, env, isNull ? lvalType(lval, env, this.ctx) : undefined);
      }
      this.emit(0x21, ...uleb(idx)); // local.set
    } else if (lval.kind === "lv-field") {
      this.emitFieldAssign(lval, op, rhs, env);
    } else if (lval.kind === "lv-index") {
      this.emitIndexAssign(lval, op, rhs, env);
    }
  }

  private emitFieldAssign(
    lval: { kind: "lv-field"; base: Lvalue; field: string },
    op: string, rhs: Expr, env: TypeEnv,
  ): void {
    const bt = lvalType(lval.base, env, this.ctx);
    const sn = structName(bt)!;
    const tIdx = this.ctx.structTypeIdx.get(sn)!;
    const fi = this.ctx.structFields.get(sn)!.find(f => f.name === lval.field)!;
    const ft = fi.type;

    if (op !== "=") {
      // compound: need base twice. For simple ident bases, emit twice.
      this.emitLvalGet(lval.base, env); // base ref for struct.set (stays on stack)
      this.emitLvalGet(lval.base, env); // base ref for struct.get
      this.emit(0xFB, 0x02, ...uleb(tIdx), ...uleb(fi.absIdx)); // struct.get (read old)
      this.emitExpr(rhs, env);
      this.emitBinOpCode(op.slice(0,-1), ft);
    } else {
      this.emitLvalGet(lval.base, env); // base ref for struct.set
      const isNull = rhs.kind === "null";
      this.emitExpr(rhs, env, isNull ? ft : undefined);
    }
    this.emit(0xFB, 0x05, ...uleb(tIdx), ...uleb(fi.absIdx)); // struct.set
  }

  private emitIndexAssign(
    lval: { kind: "lv-index"; base: Lvalue; idx: Expr },
    op: string, rhs: Expr, env: TypeEnv,
  ): void {
    const bt = lvalType(lval.base, env, this.ctx);
    const elem = bt.kind === "array" ? bt.elem
               : bt.kind === "nullable" && bt.inner.kind === "array" ? bt.inner.elem
               : I32;
    const aIdx = this.ctx.arrTypeIdx.get(typeKey(elem))!;

    if (op !== "=") {
      // Need [arr, idx, new_val] for array.set
      // Pattern: emit arr twice, emit idx twice, read old, compute new
      // Simpler for ident base + ident/const idx: just emit refs twice
      this.emitLvalGet(lval.base, env); // arr ref for array.set
      this.emitExpr(lval.idx, env);     // idx for array.set
      this.emitLvalGet(lval.base, env); // arr ref for array.get
      this.emitExpr(lval.idx, env);     // idx for array.get
      this.emit(0xFB, 0x0B, ...uleb(aIdx)); // array.get (read old)
      this.emitExpr(rhs, env);
      this.emitBinOpCode(op.slice(0,-1), elem);
    } else {
      this.emitLvalGet(lval.base, env); // arr ref
      this.emitExpr(lval.idx, env);     // idx
      const isNull = rhs.kind === "null";
      this.emitExpr(rhs, env, isNull ? elem : undefined);
    }
    this.emit(0xFB, 0x0E, ...uleb(aIdx)); // array.set
  }

  /** Emit the operation opcode for compound assignment (op without '='). */
  private emitBinOpCode(op: string, t: WacType): void {
    const p = t.kind === "prim" ? t.name : "i32";
    const k = p === "bool" || p === "i8" || p === "i16" ? "i32"
            : p === "i32" ? "i32" : p === "i64" ? "i64"
            : p === "f32" ? "f32" : "f64";
    type KT = "i32"|"i64"|"f32"|"f64";
    const ops: Record<string, Record<KT, number[]>> = {
      "+":  { i32:[0x6A], i64:[0x7C], f32:[0x92], f64:[0xA0] },
      "-":  { i32:[0x6B], i64:[0x7D], f32:[0x93], f64:[0xA1] },
      "*":  { i32:[0x6C], i64:[0x7E], f32:[0x94], f64:[0xA2] },
      "/":  { i32:[0x6D], i64:[0x7F], f32:[0x95], f64:[0xA3] },
      "%":  { i32:[0x6F], i64:[0x81], f32:[0x95], f64:[0xA3] },
      "&":  { i32:[0x71], i64:[0x83], f32:[],     f64:[]     },
      "|":  { i32:[0x72], i64:[0x84], f32:[],     f64:[]     },
      "^":  { i32:[0x73], i64:[0x85], f32:[],     f64:[]     },
      "<<": { i32:[0x74], i64:[0x86], f32:[],     f64:[]     },
      ">>": { i32:[0x75], i64:[0x87], f32:[],     f64:[]     },
    };
    this.emit(...(ops[op]?.[k as KT] ?? []));
  }

  private emitFieldIncrAssign(lval: Lvalue, compOp: string, env: TypeEnv, t: WacType): void {
    // For a non-ident lval like arr[i]++ or obj.x++
    // Just emit as compound assign with i32.const 1
    const rhs: Expr = { kind: "int", value: "1", line: 0, col: 0 };
    if (lval.kind === "lv-field") {
      this.emitFieldAssign(
        lval as { kind: "lv-field"; base: Lvalue; field: string },
        compOp, rhs, env,
      );
    } else if (lval.kind === "lv-index") {
      this.emitIndexAssign(
        lval as { kind: "lv-index"; base: Lvalue; idx: Expr },
        compOp, rhs, env,
      );
    }
  }

  /** Emit the value of an lvalue (for reading). */
  private emitLvalGet(lv: Lvalue, env: TypeEnv): void {
    switch (lv.kind) {
      case "lv-ident": {
        const key = this.nameToKey.get(lv.name) ?? lv.name;
        this.emit(0x20, ...uleb(this.localMap.get(key)!.idx)); break;
      }
      case "lv-field": {
        const bt = lvalType(lv.base, env, this.ctx);
        const sn = structName(bt)!;
        const tIdx = this.ctx.structTypeIdx.get(sn)!;
        const fi   = this.ctx.structFields.get(sn)!.find(f => f.name === lv.field)!;
        this.emitLvalGet(lv.base, env);
        this.emit(0xFB, 0x02, ...uleb(tIdx), ...uleb(fi.absIdx)); // struct.get
        break;
      }
      case "lv-index": {
        const bt = lvalType(lv.base, env, this.ctx);
        const elem = bt.kind === "array" ? bt.elem
                   : bt.kind === "nullable" && bt.inner.kind === "array" ? bt.inner.elem
                   : I32;
        const aIdx = this.ctx.arrTypeIdx.get(typeKey(elem))!;
        this.emitLvalGet(lv.base, env);
        this.emitExpr(lv.idx, env);
        this.emit(0xFB, 0x0B, ...uleb(aIdx)); // array.get
        break;
      }
    }
  }

  private emitIf(s: Stmt & { kind: "if" }, env: TypeEnv): void {
    this.emitExpr(s.cond, env);
    this.emit(0x04, 0x40); // if void
    this.labelDepth++;
    this.emitBlock(s.then, env);
    if (s.els) { this.emit(0x05); this.emitElse(s.els, env); }
    this.emit(0x0B); // end
    this.labelDepth--;
  }

  private emitElse(els: ElseBranch, env: TypeEnv): void {
    if (!els) return;
    if (els.kind === "else-block") {
      this.emitBlock(els.block, env);
    } else {
      // else-if: emit as nested if (no extra block needed since we're in the else branch)
      this.emitIf(els.stmt as Stmt & { kind: "if" }, env);
    }
  }

  private emitWhile(s: Stmt & { kind: "while" }, env: TypeEnv): void {
    // block $brk { loop $cont { cond?; body; br $cont } }
    this.emit(0x02, 0x40); this.labelDepth++; // block $brk
    const brkLevel = this.labelDepth - 1;
    this.emit(0x03, 0x40); this.labelDepth++; // loop $cont
    const contLevel = this.labelDepth - 1;

    this.emitExpr(s.cond, env);
    this.emit(0x45, 0x0D, ...uleb(this.brDepth(brkLevel))); // i32.eqz; br_if $brk

    this.loopStack.push({ breakTarget: brkLevel, continueTarget: contLevel });
    this.emitBlock(s.body, env);
    this.loopStack.pop();

    this.emit(0x0C, ...uleb(this.brDepth(contLevel))); // br $cont (loop)
    this.emit(0x0B); this.labelDepth--; // end loop
    this.emit(0x0B); this.labelDepth--; // end block
  }

  private emitDoWhile(s: Stmt & { kind: "dowhile" }, env: TypeEnv): void {
    // block $brk { loop $cont { body; cond; br_if $cont } }
    this.emit(0x02, 0x40); this.labelDepth++;
    const brkLevel = this.labelDepth - 1;
    this.emit(0x03, 0x40); this.labelDepth++;
    const contLevel = this.labelDepth - 1;

    this.loopStack.push({ breakTarget: brkLevel, continueTarget: contLevel });
    this.emitBlock(s.body, env);
    this.loopStack.pop();

    this.emitExpr(s.cond, env);
    this.emit(0x0D, ...uleb(this.brDepth(contLevel))); // br_if $cont
    this.emit(0x0B); this.labelDepth--;
    this.emit(0x0B); this.labelDepth--;
  }

  private emitFor(s: Stmt & { kind: "for" }, env: TypeEnv): void {
    // Save outer scope — for-loop init vars are scoped to the loop
    const savedKeys = new Map(this.nameToKey);
    const savedEnv  = new Map(env);
    if (s.init) this.emitStmt(s.init, env);
    this.emit(0x02, 0x40); this.labelDepth++;
    const brkLevel = this.labelDepth - 1;
    this.emit(0x03, 0x40); this.labelDepth++;
    const contLevel = this.labelDepth - 1;

    if (s.cond) {
      this.emitExpr(s.cond, env);
      this.emit(0x45, 0x0D, ...uleb(this.brDepth(brkLevel))); // eqz; br_if exit
    }
    // Wrap body in a block so `continue` exits to just before the update.
    // `continue` → br $bodyEnd → update runs → br $cont (loop back).
    if (s.update) {
      this.emit(0x02, 0x40); this.labelDepth++; // block $bodyEnd
      const bodyEndLevel = this.labelDepth - 1;
      this.loopStack.push({ breakTarget: brkLevel, continueTarget: bodyEndLevel });
      this.emitBlock(s.body, env);
      this.loopStack.pop();
      this.emit(0x0B); this.labelDepth--; // end $bodyEnd
      this.emitStmt(s.update, env);
    } else {
      this.loopStack.push({ breakTarget: brkLevel, continueTarget: contLevel });
      this.emitBlock(s.body, env);
      this.loopStack.pop();
    }

    this.emit(0x0C, ...uleb(this.brDepth(contLevel))); // br $cont
    this.emit(0x0B); this.labelDepth--;
    this.emit(0x0B); this.labelDepth--;
    // Restore outer scope after for-loop
    for (const k of [...this.nameToKey.keys()]) {
      if (savedKeys.has(k)) this.nameToKey.set(k, savedKeys.get(k)!);
      else this.nameToKey.delete(k);
    }
    for (const k of [...env.keys()]) {
      if (savedEnv.has(k)) env.set(k, savedEnv.get(k)!);
      else env.delete(k);
    }
  }

  private emitSwitch(s: Stmt & { kind: "switch" }, env: TypeEnv): void {
    // Use if-else chain for correctness. br_table optimization can come later.
    const def = s.cases.find(c => c.value === "default");
    const nonDef = s.cases.filter(c => c.value !== "default");

    // Outer break block
    this.emit(0x02, 0x40); this.labelDepth++;
    const brkLevel = this.labelDepth - 1;
    this.loopStack.push({ breakTarget: brkLevel, continueTarget: brkLevel });

    // Save switch expr to a temp local — we need to evaluate it once
    // But we don't have a temp local mechanism. Emit inline comparisons.
    // For each non-default case: if (expr == val) { body; br $brk }
    // Then default body (if any).
    // This requires re-evaluating expr each time, which is fine for simple expr.
    const exprT = typeOfExpr(s.expr, env, this.ctx);
    for (const c of nonDef) {
      const caseVal = c.value as Expr;
      this.emitExpr(s.expr, env);
      this.emitExpr(caseVal, env, exprT); // pass expr type so int literals emit as i64 if needed
      // Compare: stack has [expr, val]
      this.emitEqForType(exprT);
      this.emit(0x04, 0x40); // if void
      this.labelDepth++;
      for (const stmt of c.body) this.emitStmt(stmt, env);
      // Implicit break after case body (no fall-through in wac)
      this.emit(0x0C, ...uleb(this.brDepth(brkLevel))); // br $brk
      this.emit(0x0B); // end if
      this.labelDepth--;
    }
    if (def) {
      for (const stmt of def.body) this.emitStmt(stmt, env);
    }

    this.loopStack.pop();
    this.emit(0x0B); this.labelDepth--; // end $brk
  }

  private emitEqForType(t: WacType): void {
    const p = t.kind === "prim" ? t.name : "";
    if (p === "i64") this.emit(0x51);
    else if (p === "f32") this.emit(0x5B);
    else if (p === "f64") this.emit(0x61);
    else this.emit(0x46); // i32.eq (default)
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Compiles one function's body to a flat number[] of wasm bytes.
 * Returns the locals declaration vector followed by the body bytecode
 * followed by the `end` (0x0B) opcode.
 * The caller is responsible for wrapping this with the code entry length.
 */
export function wacEmitFunc(entry: FuncEntry, ctx: WasmTypeCtx): number[] {
  const params    = funcParams(entry);
  const retType   = funcReturnType(entry);
  const body      = entry.origin.kind === "func"
    ? entry.origin.decl.body
    : entry.origin.decl.body;

  const emitter = new FuncEmitter(ctx, retType);
  let   localIdx = 0;
  const env: TypeEnv = new Map();

  // For methods with `this`, add it as the first parameter (wasm param index 0).
  if (entry.origin.kind === "method" && entry.origin.decl.hasThis) {
    const structName = entry.origin.structName;
    const thisType: WacType = { kind: "struct", name: structName, line: 0, col: 0 };
    emitter.localMap.set("this", { idx: localIdx++, type: thisType });
    emitter.nameToKey.set("this", "this");
    env.set("this", thisType);
  }

  // Map parameters
  for (const p of params) {
    emitter.localMap.set(p.name, { idx: localIdx++, type: p.type });
    emitter.nameToKey.set(p.name, p.name);
    env.set(p.name, p.type);
  }

  // Collect and map local variables (unique keys for shadowed vars)
  const { decls: allLocals, keyMap } = collectLocals(body.stmts);
  emitter.keyMap = keyMap;
  const paramNames = new Set([...params.map(p => p.name), ...(entry.origin.kind === "method" && entry.origin.decl.hasThis ? ["this"] : [])]);
  for (const d of allLocals) {
    if (!emitter.localMap.has(d.name)) {
      emitter.localMap.set(d.name, { idx: localIdx++, type: d.type });
    }
  }

  // Build the wasm locals declaration (groups of same-type locals)
  // Only non-parameter locals go here
  const localDecls = allLocals.filter(d => !paramNames.has(d.name));
  const groups: { type: WacType; count: number }[] = [];
  for (const d of localDecls) {
    const key = typeKey(d.type);
    if (groups.length > 0 && typeKey(groups[groups.length - 1].type) === key)
      groups[groups.length - 1].count++;
    else
      groups.push({ type: d.type, count: 1 });
  }

  // Allocate a scratch i64 local for checked/saturating i64 casts.
  const tempI64LocalIdx = localIdx;
  emitter.tempI64Local = tempI64LocalIdx;

  // groups always gets one extra i64 scratch slot
  const localsVec: number[] = [];
  localsVec.push(...uleb(groups.length + 1));
  for (const g of groups) {
    localsVec.push(...uleb(g.count));
    localsVec.push(...wasmValType(g.type, ctx));
  }
  localsVec.push(0x01, 0x7E); // 1 × i64 scratch local

  // Emit body
  emitter.emitBlock(body, env);

  // For non-void functions, emit unreachable before the function end so the wasm
  // validator is satisfied when all execution paths end with explicit return/trap.
  const isVoid = retType.kind === "prim" && retType.name === "void";
  return [...localsVec, ...emitter.getBytes(), ...(isVoid ? [] : [0x00]), 0x0B]; // 0x0B = end
}
