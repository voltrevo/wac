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
  type Lvalue, type ElseBranch, type MatchArm, type ConstDecl,
} from "./wacParse.ts";
import {
  type FuncEntry, type StructEntry, type ResolveResult,
  funcParams, funcReturnType, commonAncestor, ENUM_TAG_FIELD, boxStructName, needsBoxing,
} from "./wacResolve.ts";
import { wacIntLit } from "./wacIntLit.ts";
import { wacFloatLit } from "./wacFloatLit.ts";

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
  helperIdx: Map<string, number>;
  /** All fields (including inherited) for each struct, in order */
  structFields: Map<string, StructFieldInfo[]>;
  /** Mangled function name → wasm function index */
  funcIdx: Map<string, number>;
  /**
   * How many imported functions precede the defined ones in the wasm function
   * index space — one per host-callback signature, zero for a module with no
   * callbacks.
   *
   * Imports occupy the lowest indices, so every *emitted* function index is a
   * position in `result.funcs` plus this. `funcIdx` and `helperIdx` already hold
   * emitted indices; `FuncEntry.funcIndex` is a position. Converting between
   * them is the only reason this is here.
   */
  funcBase: number;
  /** Funcref signatures the host can supply a function for, in import order. */
  cbSigs: { key: string; params: WacType[]; ret: WacType }[];
  /** Funcref signatures handed back to the host, in helper order. */
  outSigs: { key: string; params: WacType[]; ret: WacType }[];
  /** Global holding the last `trap` message, or -1 when the program has none. */
  trapGlobalIdx: number;
  /**
   * Trap on integer overflow in user-written add, sub and mul. Off by default.
   *
   * Experimental, and deliberately a whole-module switch rather than anything
   * finer. It is not the shape a shipped default would take — same source, different
   * meaning depending on how it was compiled, which is the Rust wart — but it is the
   * right shape for finding out what your own code depends on.
   *
   * Wrapping stays the default because half of what wac is used for requires it:
   * SHA-256's `h0 += a` is addition mod 2^32 by specification, and so are CRC-32,
   * ChaCha20 and FNV-1a. Measured over wac-mono: 68 of 503 tests depend on wrapping,
   * nearly all in `crypto`, while json, gzip, url, http, fmt and std pass with this
   * on. Cost with nothing opted out was 5% on a JSON parse and 27% on gzip.
   */
  checked?: boolean;
  /**
   * The file whose function is being emitted.
   *
   * A bare function name means whatever the *calling file's* scope says it
   * means. funcIdx and result.funcs are both global and first-match-wins, so
   * resolving through either one makes two files that each declare a private
   * `helper` share whichever was registered first — silently, and with the
   * wrong signature. Mutated as emission proceeds, like the coverage state.
   */
  currentFile: string;
  /**
   * Constant *array* declaration → wasm global index.
   *
   * Only arrays appear here. A scalar constant is substituted at each use, but
   * an array has to be built, and building it per use is exactly the cost these
   * exist to avoid — so it becomes one immutable global, constructed once in
   * the global's own initialiser at instantiation.
   */
  constGlobalIdx: Map<ConstDecl, number>;
  result: ResolveResult;
  /**
   * Branch-coverage instrumentation state, or undefined when coverage is off.
   *
   * Counters are numbered across the whole program, so the index counter and the
   * point table are shared by every function being emitted and mutate as
   * emission proceeds.
   */
  coverage?: CoverageCtx;
};

/** One instrumented branch point. */
export type CoveragePoint = {
  index: number;
  file: string;
  line: number;
  col: number;
  kind:
    | "entry" | "then" | "else" | "loop" | "case"
    | "ternary-then" | "ternary-else" | "and-rhs" | "or-rhs"
    // Only in trace mode: a memory access whose *index* is recorded. A secret
    // index is a cache-timing leak even when control flow never varies, which is
    // the whole gap branch coverage cannot see.
    | "index";
};

export type CoverageCtx = {
  /** Points recorded so far; the index of a point is its position here. */
  points: CoveragePoint[];
  /** File currently being emitted, for attributing points. */
  file: string;
  /**
   * Record an ordered *trace* rather than per-point counts, and instrument array
   * indices as well as branches.
   *
   * Two runs that differ only in a secret must produce the same trace; the first
   * differing event is where the secret reached something an observer can see.
   * Counts alone cannot show this — a loop that runs the same number of times in a
   * different order compares equal, and an index leak has no branch at all.
   */
  trace?: boolean;
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
/** The struct type of the variant a type index denotes, or null if it is not one. */
function variantStructType(typeIndex: number, ctx: WasmTypeCtx): WacType | null {
  for (const en of ctx.result.enums) {
    for (const v of en.variants) {
      if (v.entry.typeIndex === typeIndex) {
        return { kind: "struct", name: v.name, resolvedTypeIndex: typeIndex, line: 0, col: 0 };
      }
    }
  }
  return null;
}

/**
 * A method on a struct or anything it inherits from.
 *
 * `StructEntry.methods` is the struct's own map, so a subtype's lookup has to walk `parentEntry`
 * — which is also how an enum's methods are reached from a variant, since the variants are
 * generated subtypes of the enum's base.
 */
function lookupMethod(
  name: string, resolvedIndex: number | undefined, method: string, ctx: WasmTypeCtx,
): FuncEntry | undefined {
  let entry = resolveStructEntry(name, ctx, resolvedIndex);
  while (entry) {
    const found = entry.methods.get(method);
    if (found) return found;
    entry = entry.parentEntry ?? undefined;
  }
  return undefined;
}

/**
 * Is this expression the literal `null`?
 *
 * Checked syntactically rather than by type: the null literal types as `anyref` here,
 * and `anyref` is also a type a branch can legitimately have, so the type alone cannot
 * tell the two apart.
 */
function isNullLit(e: Expr): boolean {
  return e.kind === "null";
}

/** `T?` for a type that has a nullable form, else null. Mirrors the type checker. */
/**
 * `T?` for a `T` that can be one — which is now every type but `void`.
 *
 * Mirrors the type checker's own `nullableOf`, and the mirroring is the point: this is the
 * function the comment in `typeOfExpr`'s ternary case is about. When the checker learned that a
 * primitive can be nullable [issue 0045] and this did not, `cond ? 1 : null` type-checked as
 * `i32?` and then emitted a block declared `i32` with a `ref.null` in one arm.
 */
function nullableOf(t: WacType): WacType | null {
  if (t.kind === "nullable") return t;
  if (t.kind === "prim" && (t.name === "void" || t.name === "null")) return null;
  return { kind: "nullable", inner: t, line: 0, col: 0 };
}

export function typeKey(t: WacType): string {
  switch (t.kind) {
    case "prim":     return t.name;
    // Struct identity is the resolved typeIndex — the resolver annotates every
    // struct-type reference in the AST (wacResolve's phase 5), so all keys for
    // the same struct agree regardless of the name written at the use site
    // (declared name vs. import alias), and two files' same-named structs get
    // distinct keys. The name form only appears for unresolved types, which
    // are compile errors reported elsewhere.
    case "struct":   return t.resolvedTypeIndex !== undefined ? `S:#${t.resolvedTypeIndex}` : `S:${t.name}`;
    case "array":    return `A:${typeKey(t.elem)}`;
    case "nullable": return `?:${typeKey(t.inner)}`;
    case "funcref":  return `F:${sigKey(t.params, t.ret)}`;
  }
}

/** Resolve a struct WacType to its wasm type index, preferring an already-
 *  resolved typeIndex over a bare-name lookup (see WacType's "struct" comment). */
function structTypeIndexOf(t: { name: string; resolvedTypeIndex?: number }, ctx: WasmTypeCtx): number {
  return t.resolvedTypeIndex ?? structIdxInFile(t.name, ctx)!;
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
      // u32/u64 are the same wasm types as i32/i64 — wasm has no signed types,
      // only signed and unsigned *instructions*. Signedness is carried by the
      // wac type and decides which opcode gets emitted, never the storage.
      const map: Record<string, number | undefined> = {
        i32: 0x7F, i64: 0x7E, u32: 0x7F, u64: 0x7E,
        f32: 0x7D, f64: 0x7C, bool: 0x7F,
        anyref: 0x6E, i31ref: 0x6C,
      };
      const code = map[t.name];
      if (code !== undefined) return [code];
      if (t.name === "string") return [0x64, ...sleb(ctx.stringTypeIdx)];
      if (t.name === "void")   return [0x40]; // only valid as block type
      return [0x7F]; // fallback
    }
    case "struct":   return [0x64, ...sleb(structTypeIndexOf(t, ctx))];
    case "array":    return [0x64, ...sleb(ctx.arrTypeIdx.get(typeKey(t.elem))!)];
    case "nullable": return wasmNullable(t.inner, ctx);
    case "funcref":  return [0x64, ...sleb(ctx.sigTypeIdx.get(sigKey(t.params, t.ret))!)];
  }
}

/** Can `struct.new_default` / `array.new_default` produce this type?
 *
 *  Only numeric and packed types and nullable refs have a wasm default. Non-null
 *  struct and array refs do not — and neither does `string`, which parses as a
 *  prim but compiles to a non-null (ref $string). Anything false here has to be
 *  built explicitly with emitDefaultValue. */
function isWasmDefaultable(t: WacType): boolean {
  if (t.kind === "struct" || t.kind === "array") return false;
  return !isStringPrim(t);
}

/** True for `string`, which parses as a prim but compiles to a non-null
 *  (ref $string) — so it is not wasm-defaultable and needs an explicit "". */
function isStringPrim(t: WacType): boolean {
  return t.kind === "prim" && t.name === "string";
}

/** Nullable ref type bytes for a nullable wac type. */
function wasmNullable(inner: WacType, ctx: WasmTypeCtx): number[] {
  switch (inner.kind) {
    case "prim":
      if (inner.name === "anyref")  return [0x6E];
      if (inner.name === "i31ref")  return [0x63, 0x6C];
      if (inner.name === "string")  return [0x63, ...sleb(ctx.stringTypeIdx)];
      return [0x6E]; // fallback to anyref
    case "struct":   return [0x63, ...sleb(structTypeIndexOf(inner, ctx))];
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
    case "struct":   return sleb(structTypeIndexOf(t, ctx));
    case "array":    return sleb(ctx.arrTypeIdx.get(typeKey(t.elem))!);
    case "funcref":  return sleb(ctx.sigTypeIdx.get(sigKey(t.params, t.ret))!);
    case "nullable": return heapTypeBytes(t.inner, ctx);
  }
}

// ── Method lookup ─────────────────────────────────────────────────────────────

/**
 * Resolve a struct type name to its StructEntry. The name may be an import
 * alias (e.g. `BoxA` for a `Box` imported `as BoxA`) rather than the struct's
 * own declared name — struct declarations are only unique within their own
 * file, so two different files' structs can share a bare declared name.
 * `ctx.structTypeIdx` is already alias-aware (registered per local name, see
 * wasmBuildBin.ts's buildTypeCtx), so resolve through its typeIndex rather
 * than searching `ctx.result.structs` by bare name directly.
 */
/**
 * The type index a *written* struct name denotes, resolved through the file being emitted.
 *
 * `ctx.structTypeIdx` maps bare names globally and last-wins, so two files each declaring a
 * struct called `Dup` both reached whichever was registered last — the module typechecked and
 * then failed to instantiate, because a function's declared return type and the `struct.new`
 * inside it disagreed [issue 0041]. The resolver already keeps a per-file scope for exactly
 * this reason; the emitter simply was not asking it.
 *
 * The same fix as 123ac4c made for bare *function* names, and the same shape as four enum bugs:
 * a name is only unique within its file, so identity has to come from somewhere that knows
 * which file is being compiled.
 */
function structIdxInFile(name: string, ctx: WasmTypeCtx): number | undefined {
  const scoped = ctx.result.fileScopes.get(ctx.currentFile)?.get(name);
  if (scoped !== undefined &&
      (scoped.kind === "struct" || scoped.kind === "enum" || scoped.kind === "variant")) {
    return scoped.entry.typeIndex;
  }
  // A name the current file does not have — a method body emitted for another file's struct
  // reaches here, and the global map is the only answer available.
  return ctx.structTypeIdx.get(name);
}

function resolveStructEntry(name: string, ctx: WasmTypeCtx, resolvedTypeIndex?: number): StructEntry | undefined {
  const idx = resolvedTypeIndex ?? structIdxInFile(name, ctx);
  if (idx === undefined) return undefined;
  return ctx.result.structs[idx];  // structs are in typeIndex order
}

/** Walk the struct inheritance chain to find a method (handles inherited methods).
 *  `resolvedTypeIndex`, when known, disambiguates the starting struct (see
 *  resolveStructEntry); from there the chain follows the resolver's
 *  parentEntry links, which are already scope-correct. */
function lookupMethodInChain(
  structName: string, methodName: string, ctx: WasmTypeCtx, resolvedTypeIndex?: number,
): import("./wacResolve.ts").FuncEntry | null {
  let entry = resolveStructEntry(structName, ctx, resolvedTypeIndex);
  while (entry) {
    const m = entry.methods.get(methodName);
    if (m) return m;
    entry = entry.parentEntry ?? undefined;
  }
  return null;
}

// ── Type inference ────────────────────────────────────────────────────────────

type TypeEnv = Map<string, WacType>;
const VOID: WacType = { kind: "prim", name: "void", line: 0, col: 0 };
const I32:  WacType = { kind: "prim", name: "i32",  line: 0, col: 0 };
const I64:  WacType = { kind: "prim", name: "i64",  line: 0, col: 0 };
const BOOL: WacType = { kind: "prim", name: "bool", line: 0, col: 0 };

/** Infer the wac type of an expression given local variable types. */
/** Two branch types with the nullability already stripped: the struct rule, or the first. */
function typeOfTernaryInner(a: WacType, b: WacType, ctx: WasmTypeCtx): WacType {
  if (a.kind === "struct" && b.kind === "struct") {
    const ae = resolveStructEntry(a.name, ctx, a.resolvedTypeIndex);
    const be = resolveStructEntry(b.name, ctx, b.resolvedTypeIndex);
    if (ae && be && ae.typeIndex !== be.typeIndex) {
      const lca = commonAncestor(ae, be);
      if (lca) return { kind: "struct", name: lca.name, resolvedTypeIndex: lca.typeIndex, line: 0, col: 0 };
    }
  }
  return a;
}

export function typeOfExpr(e: Expr, env: TypeEnv, ctx: WasmTypeCtx): WacType {
  switch (e.kind) {
    // An integer literal is typed by its own width, the same way wacTypeCheck
    // types it: decimal by magnitude, hex by digit count [see types.md].
    // Reporting i32 unconditionally selected the i32 form of the enclosing
    // operator, so `4000000000000 + 1000000000000` emitted i32.add.
    case "int": {
      // `resolved` is set by wacTypeCheck when the literal took its type from
      // context. Trusting it is what keeps the two in agreement — deriving a
      // second opinion here is how the operand and the operator came to
      // disagree about width before.
      if (e.resolved) return e.resolved;
      const lit = wacIntLit(e.value);
      return lit.ok && lit.width === 64 ? I64 : I32;
    }
    // Mirrors the `int` case above: the checker's answer, when it made one.
    case "float":  return e.resolved ?? { kind: "prim", name: "f64", line: 0, col: 0 };
    case "bool":   return BOOL;
    case "string": return { kind: "prim", name: "string", line: 0, col: 0 };
    case "null":   return { kind: "prim", name: "anyref", line: 0, col: 0 };
    case "ident": {
      const v = env.get(e.name);
      if (v) return v;
      if (e.constRef) return e.constRef.type;
      // Struct type name or function name
      const asType = structIdxInFile(e.name, ctx);
      if (asType !== undefined) {
        return { kind: "struct", name: e.name, resolvedTypeIndex: asType, line: 0, col: 0 };
      }
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
    case "ternary": {
      // The type checker's answer when there is one — it is the authority, and re-deriving it is
      // what produced issue 0051 and the i64-literal bug before it. The derivation below stays
      // because the emitter is also driven directly, without a checker, by `wasmBuildBin.test.ts`.
      if (e.resultType) return e.resultType;
      const tt = typeOfExpr(e.then, env, ctx);
      const et = typeOfExpr(e.else_, env, ctx);
      // A `null` branch makes the result nullable, matching the type checker. The two
      // must agree: the checker accepted `cond ? S(1) : null` as `S?` while this
      // returned the then-branch's non-nullable `S`, so the block was declared with a
      // non-nullable result and the `ref.null` in the else branch failed validation.
      // This is the same shape as the i64-literal split — two places computing one
      // type — and it is worth stating that the fix is to mirror, not to re-derive.
      if (isNullLit(e.then) && !isNullLit(e.else_)) {
        const w = nullableOf(et);
        if (w) return w;
      }
      if (isNullLit(e.else_) && !isNullLit(e.then)) {
        const w = nullableOf(tt);
        if (w) return w;
      }
      // Exactly one branch nullable makes the result nullable, whatever the two inner types
      // unify to. Without this the then-arm's type won and `c ? S(1) : s` declared a non-nullable
      // block that the else arm could not satisfy.
      if ((tt.kind === "nullable") !== (et.kind === "nullable")) {
        const inner = tt.kind === "nullable" ? tt.inner : tt;
        const other = et.kind === "nullable" ? et.inner : et;
        const both = typeOfTernaryInner(inner, other, ctx);
        return { kind: "nullable", inner: both, line: 0, col: 0 };
      }
      // Struct branches type to their closest common ancestor (matches the
      // type checker) — the if/else block type must be the ancestor so both
      // branches validate via wasm's declared subtyping.
      if (tt.kind === "struct" && et.kind === "struct") {
        const ae = resolveStructEntry(tt.name, ctx, tt.resolvedTypeIndex);
        const be = resolveStructEntry(et.name, ctx, et.resolvedTypeIndex);
        if (ae && be && ae.typeIndex !== be.typeIndex) {
          const lca = commonAncestor(ae, be);
          if (lca) return { kind: "struct", name: lca.name, resolvedTypeIndex: lca.typeIndex, line: 0, col: 0 };
        }
      }
      return tt;
    }
    case "matchExpr":
      // The checker records the unified arm type; re-deriving it here is exactly the
      // mistake that produced the i64-literal and ternary-variant bugs.
      return e.resultType ?? VOID;
    case "cast": return e.type;
    case "is": return BOOL;
    case "unwrap": {
      const t = typeOfExpr(e.expr, env, ctx);
      return t.kind === "nullable" ? t.inner : t;
    }
    case "call": {
      // Variant construction, e.g. `Shape.Circle(2.0)`. Nothing else here recognised
      // it, so it fell through to method resolution, found none, and reported void —
      // which only mattered where the type is asked for directly rather than supplied
      // as an expected type. A ternary does exactly that, so `cond ? E.A(1) : E.B`
      // declared its block with no result and pushed a value into it anyway.
      if (e.variantTypeIndex !== undefined) {
        const v = variantStructType(e.variantTypeIndex, ctx);
        if (v) return v;
      }
      if (e.callee.kind === "field") {
        const fe = e.callee as { kind: "field"; expr: Expr; name: string };
        // Builtin statics on `string`, matched before typing the base: `string`
        // is an identifier here and names no variable.
        const floatBase = fe.expr.kind === "ident" ? (fe.expr as { name: string }).name : "";
        if (floatBase === "f64" || floatBase === "f32") {
          const bits = floatBase === "f64" ? "u64" : "u32";
          if (fe.name === "toBits") return { kind: "prim", name: bits, line: 0, col: 0 };
          if (fe.name === "fromBits") return { kind: "prim", name: floatBase, line: 0, col: 0 };
        }
        if (fe.expr.kind === "ident" && (fe.expr as { name: string }).name === "string"
            && (fe.name === "fromCodepoint" || fe.name === "fromBytes")) {
          return { kind: "prim", name: "string", line: 0, col: 0 };
        }
        const baseT = typeOfExpr(fe.expr, env, ctx);
        if (fe.name === "len") return I32; // arr.len() / string.len()
        // String methods
        if (baseT.kind === "prim" && baseT.name === "string") {
          if (fe.name === "slice") return { kind: "prim", name: "string", line: 0, col: 0 };
          if (fe.name === "indexOf") return I32;
          if (fe.name === "toBytes") {
            return {
              kind: "array",
              elem: { kind: "prim", name: "u8", line: 0, col: 0 },
              line: 0, col: 0,
            };
          }
        }
        const sName = structName(baseT);
        if (sName) {
          // Walk the parent chain: `methods` holds only a struct's *own* methods, so an
          // inherited one missed the lookup, this fell through, and the expression ended up
          // typed f64 — which made `s.get() + 1` emit `f64.add` for two i32s [issue 0040].
          // The type checker already walks the chain; keeping a second, shorter answer here
          // is the disagreement this compiler produces most often.
          const meth = lookupMethod(sName, structResolvedIndex(baseT), fe.name, ctx);
          if (meth) return funcReturnType(meth);
        }
      }
      if (e.callee.kind === "ident") {
        const v = env.get(e.callee.name);
        if (v?.kind === "funcref") return v.ret;
        const calleeName = (e.callee as { kind: "ident"; name: string }).name;
        const scoped = ctx.result.fileScopes.get(ctx.currentFile)?.get(calleeName);
        if (scoped?.kind === "func") return funcReturnType(scoped.entry);
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
      // A payload-less variant used as a value, e.g. `Shape.Point`.
      if (e.variantTypeIndex !== undefined) {
        const v = variantStructType(e.variantTypeIndex, ctx);
        if (v) return v;
      }
      const baseT = typeOfExpr(e.expr, env, ctx);
      const sName = structName(baseT);
      if (sName) {
        const f = ctx.structFields.get(structLookupKey(baseT)!)?.find(f => f.name === e.name);
        if (f) return f.type;
        const meth = resolveStructEntry(sName, ctx, structResolvedIndex(baseT))?.methods.get(e.name);
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
      if (!arr) return I32;
      // A packed element reads as i32 — array.get_s/get_u yield i32 — so that is
      // the type of the *value*, which is what every consumer here needs. The type
      // checker already normalises this (inferExpr's "index" case); without the
      // same normalisation the cast path looked for a u8 -> i64 conversion, found
      // none, and emitted no widening at all: valid types, invalid wasm.
      const el = arr.elem;
      if (el.kind === "prim" &&
          (el.name === "i8" || el.name === "i16" || el.name === "u8" || el.name === "u16")) {
        return I32;
      }
      return el;
    }
    case "construct": {
      // For struct types, return the struct type; for function-named constructs, return the func return type.
      if (e.ctype.kind === "struct" && structIdxInFile((e.ctype as { name: string }).name, ctx) === undefined) {
        const ctypeName = (e.ctype as { name: string }).name;
        // A local or parameter wins, and has to be looked at first — see the note in
        // emitConstruct, which had the same ordering and produced code that called an
        // unrelated function of the same name.
        const localT = env.get(ctypeName);
        if (localT?.kind === "funcref") return localT.ret;
        // The calling file's scope decides, for the same reason as in
        // emitConstruct: a bare name is not globally unique.
        const scopedFn = ctx.result.fileScopes.get(ctx.currentFile)?.get(ctypeName);
        if (scopedFn?.kind === "func") return funcReturnType(scopedFn.entry);
        const fi = ctx.result.funcs.find(f =>
          f.mangledName === ctypeName ||
          (f.origin.kind === "func" && f.origin.decl.name === ctypeName));
        if (fi) return funcReturnType(fi);
      }
      return e.ctype;
    }
    case "arrNew": return { kind: "array", elem: e.elem, line: 0, col: 0 };
    case "incr-expr": return lvalType(e.lval, env, ctx);
  }
}

/** Extract the struct name from a type (including nullable struct). */
function structName(t: WacType): string | null {
  if (t.kind === "struct") return t.name;
  if (t.kind === "nullable" && t.inner.kind === "struct") return t.inner.name;
  return null;
}

/**
 * Key to use for structFields/structTypeIdx lookups — prefers the `@<typeIndex>`
 * form (globally unique) when the type carries a resolvedTypeIndex, falling
 * back to the bare/aliased name otherwise (structFields/structTypeIdx register
 * both forms — see wasmBuildBin.ts's buildTypeCtx/buildStructFields).
 */
function structLookupKey(t: WacType): string | null {
  const s = t.kind === "struct" ? t : (t.kind === "nullable" && t.inner.kind === "struct" ? t.inner : null);
  if (!s) return null;
  return s.resolvedTypeIndex !== undefined ? `@${s.resolvedTypeIndex}` : s.name;
}

/** The resolvedTypeIndex carried by a struct (or nullable-struct) WacType, if known. */
function structResolvedIndex(t: WacType): number | undefined {
  if (t.kind === "struct") return t.resolvedTypeIndex;
  if (t.kind === "nullable" && t.inner.kind === "struct") return t.inner.resolvedTypeIndex;
  return undefined;
}

/** Type of an lvalue. */
function lvalType(lv: Lvalue, env: TypeEnv, ctx: WasmTypeCtx): WacType {
  switch (lv.kind) {
    case "lv-ident": return env.get(lv.name) ?? I32;
    case "lv-field": {
      const bt = lvalType(lv.base, env, ctx);
      const key = structLookupKey(bt);
      if (key) return ctx.structFields.get(key)?.find(f => f.name === lv.field)?.type ?? I32;
      return I32;
    }
    case "lv-index": {
      const bt = lvalType(lv.base, env, ctx);
      if (bt.kind === "array") return bt.elem;
      if (bt.kind === "nullable" && bt.inner.kind === "array") return bt.inner.elem;
      return I32;
    }
    case "lv-unwrap": {
      const bt = lvalType(lv.base, env, ctx);
      if (bt.kind === "nullable") return bt.inner;
      return bt;
    }
  }
}

// ── Local variable collection ─────────────────────────────────────────────────

type LocalDecl = { name: string; type: WacType };

/** Walk all statements (recursively) to collect local var declarations with unique keys. */
function collectLocals(stmts: Stmt[], reserved: string[] = []): {
  decls: LocalDecl[];
  keyMap: WeakMap<Stmt, string>;
  armKeys: WeakMap<MatchArm, string>;
  bindingKeys: WeakMap<MatchArm, string[]>;
  /** The shadow local an `if (x is T)` introduces for `x` inside its then-block. */
  narrowKeys: WeakMap<Stmt, string>;
} {
  const decls: LocalDecl[] = [];
  const count = new Map<string, number>(); // how many times each name has been declared
  // Parameters already occupy their names, so a local that shadows one must get a
  // suffixed key. Without this the shadow's key is the bare name, it overwrites the
  // parameter's entry in localMap, and the parameter reads back as the shadow's value
  // once the shadowing block has ended — a silent wrong answer, not a crash.
  for (const name of reserved) count.set(name, 1);
  const keyMap = new WeakMap<Stmt, string>(); // var stmt → unique key
  // A match arm is not a Stmt, so its narrowed shadow and its payload bindings need
  // their own key maps rather than riding on keyMap.
  const armKeys = new WeakMap<MatchArm, string>();
  const narrowKeys = new WeakMap<Stmt, string>();
  const bindingKeys = new WeakMap<MatchArm, string[]>();
  function walk(ss: Stmt[]): void {
    for (const s of ss) {
      // Every expression position has to be visited, because `match` used as an expression
      // declares locals for its arm bindings. Until it did, no expression declared anything
      // and this pass could ignore them entirely — so these calls are the new part, and
      // missing one shows up as an arm binding that reads as nothing and a stack left short
      // at validation, nowhere near the cause.
      if (s.kind === "var") {
        const n = count.get(s.name) ?? 0;
        count.set(s.name, n + 1);
        const key = n === 0 ? s.name : `${s.name}$${n}`;
        decls.push({ name: key, type: s.type });
        keyMap.set(s, key);
        walkExpr(s.init);
      } else if (s.kind === "if") {
        walkExpr(s.cond);
        // `if (x is T)` shadows `x` at the narrower type inside the then-block, which needs
        // a local of its own. Keyed like a match arm's shadow, for the same reason: the key
        // must not collide with a parameter or local of the same name, and this pass does not
        // know those names.
        if (s.narrowName !== undefined && s.narrowTypeIndex !== undefined) {
          const n = count.get(`#narrow:${s.narrowName}`) ?? 0;
          count.set(`#narrow:${s.narrowName}`, n + 1);
          const key = `#narrow:${s.narrowName}:${n}`;
          decls.push({
            name: key,
            type: { kind: "struct", name: s.narrowName,
                    resolvedTypeIndex: s.narrowTypeIndex, line: s.line, col: s.col },
          });
          narrowKeys.set(s, key);
        }
        walk(s.then.stmts);
        if (s.els?.kind === "else-block") walk(s.els.block.stmts);
        else if (s.els?.kind === "else-if") walk([s.els.stmt]);
      } else if (s.kind === "while" || s.kind === "dowhile") {
        walkExpr(s.cond);
        walk(s.body.stmts);
      } else if (s.kind === "for") {
        if (s.init) walk([s.init]);
        if (s.cond) walkExpr(s.cond);
        if (s.update) walk([s.update]);
        walk(s.body.stmts);
      } else if (s.kind === "switch") {
        walkExpr(s.expr);
        for (const c of s.cases) {
          if (c.value !== "default") walkExpr(c.value);
          walk(c.body);
        }
      } else if (s.kind === "match") {
        walkExpr(s.subject);
        armLocals(s.arms, s.subject, (body) => walk(body));
      } else if (s.kind === "block") {
        walk(s.block.stmts);
      } else if (s.kind === "return") {
        if (s.value) walkExpr(s.value);
      } else if (s.kind === "assign") {
        walkLvalExpr(s.lval);
        walkExpr(s.rhs);
      } else if (s.kind === "incr") {
        walkLvalExpr(s.lval);
      } else if (s.kind === "expr") {
        walkExpr(s.expr);
      }
    }
  }
  /**
   * Allocate the locals an arm needs: its payload bindings and the narrowed shadow of the
   * subject. Types come from the type checker's annotations, since this pass has no access
   * to the enum table.
   *
   * `onBody` is how the caller recurses into whatever the arm holds — statements for the
   * statement form, an expression for the expression form.
   */
  function armLocals(
    arms: MatchArm[], subject: Expr,
    onBody: (body: Stmt[]) => void,
  ): void {
    const subjName = subject.kind === "ident" ? subject.name : null;
    for (const arm of arms) {
      if (arm.variant === null) {
        onBody(arm.body);
        if (arm.value) walkExpr(arm.value);
        continue;
      }

      if (subjName !== null && arm.variantTypeIndex !== undefined) {
        // The key must not collide with a parameter of the same name, and this pass does
        // not know the parameter names — so the shadow gets a key that cannot be written
        // in source and therefore cannot clash with anything.
        const n = count.get(`#match:${subjName}`) ?? 0;
        count.set(`#match:${subjName}`, n + 1);
        const key = `#match:${subjName}:${n}`;
        decls.push({
          name: key,
          type: { kind: "struct", name: arm.variant,
                  resolvedTypeIndex: arm.variantTypeIndex, line: arm.line, col: arm.col },
        });
        armKeys.set(arm, key);
      }

      const bkeys: string[] = [];
      for (let i = 0; i < arm.bindings.length; i++) {
        const name = arm.bindings[i];
        const type = arm.bindingTypes?.[i];
        if (name === "_" || type === undefined) { bkeys.push(""); continue; }
        const n = count.get(name) ?? 0;
        count.set(name, n + 1);
        const key = n === 0 ? name : `${name}$${n}`;
        decls.push({ name: key, type });
        bkeys.push(key);
      }
      bindingKeys.set(arm, bkeys);
      onBody(arm.body);
      if (arm.value) walkExpr(arm.value);
    }
  }

  /**
   * Walk an expression looking for `match` used as one.
   *
   * Nothing else in an expression declares a local, which is why this pass walked only
   * statements until now — and why the walk has to be added rather than extended. A
   * `matchExpr` nested anywhere an expression can appear needs its arm locals allocated, so
   * "anywhere" is what this covers.
   */
  function walkExpr(e: Expr): void {
    switch (e.kind) {
      case "matchExpr":
        walkExpr(e.subject);
        armLocals(e.arms, e.subject, (body) => walk(body));
        return;
      case "unary": case "unwrap":
        return walkExpr(e.expr);
      case "binary":
        walkExpr(e.left); return walkExpr(e.right);
      case "cast":
        return walkExpr(e.expr);
      case "is":
        walkExpr(e.expr);
        // The right side is a type, the string "null", or an expression; only the last
        // can contain a nested match.
        if (typeof e.rhs === "object" && "kind" in e.rhs &&
            !["prim", "struct", "array", "nullable", "funcref"].includes(e.rhs.kind)) {
          walkExpr(e.rhs as Expr);
        }
        return;
      case "ternary":
        walkExpr(e.cond); walkExpr(e.then); return walkExpr(e.else_);
      case "call":
        walkExpr(e.callee); for (const a of e.args) walkExpr(a); return;
      case "index":
        walkExpr(e.expr); return walkExpr(e.idx);
      case "field":
        return walkExpr(e.expr);
      case "construct":
        for (const a of e.args) walkExpr(a);
        for (const n of e.named ?? []) walkExpr(n.val);
        return;
      case "arrNew":
        if (e.size) walkExpr(e.size);
        if (e.fill) walkExpr(e.fill);
        for (const el of e.fixed) walkExpr(el);
        return;
      case "incr-expr":
        return walkLvalExpr(e.lval);
      // Leaves: nothing nested to find.
      case "int": case "float": case "string": case "bool": case "null": case "ident":
        return;
    }
  }

  /** Expressions reachable through an lvalue — an index, or a nested base. */
  function walkLvalExpr(lv: Lvalue): void {
    if (lv.kind === "lv-index") { walkLvalExpr(lv.base); walkExpr(lv.idx); return; }
    if (lv.kind === "lv-field" || lv.kind === "lv-unwrap") return walkLvalExpr(lv.base);
  }

  walk(stmts);
  return { decls, keyMap, armKeys, bindingKeys, narrowKeys };
}

// ── String encoding ───────────────────────────────────────────────────────────

/**
 * UTF-8 bytes of a string literal's value.
 *
 * The value arrives already unescaped — `lexString` resolved `\n`, `\\` and the
 * rest when it built the token. Decoding a second time here would find the
 * resolved backslash of a `\\` and treat it as the start of a fresh escape,
 * swallowing whatever followed it, so this is a plain encode.
 */
export function encodeString(value: string): number[] {
  return [...new TextEncoder().encode(value)];
}

// ── Function body emitter ─────────────────────────────────────────────────────

type LocalInfo = { idx: number; type: WacType };

/** Rewind a live scope map to a saved snapshot: entries the inner scope
 *  shadowed are restored, entries it introduced are removed. */
function restoreScope<K, V>(live: Map<K, V>, saved: Map<K, V>): void {
  for (const k of [...live.keys()]) {
    if (saved.has(k)) live.set(k, saved.get(k)!);
    else live.delete(k);
  }
}

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
  /** Maps a match arm to the key of its narrowed shadow of the subject. */
  armKeys: WeakMap<MatchArm, string> = new WeakMap();
  /** Maps a match arm to its payload binding keys, "" where the binding is `_`. */
  bindingKeys: WeakMap<MatchArm, string[]> = new WeakMap();
  /** Maps an `if (x is T)` to the key of the shadow it introduces for `x`. */
  narrowKeys: WeakMap<Stmt, string> = new WeakMap();
  private ctx: WasmTypeCtx;
  private returnType: WacType;
  private loopStack: LoopCtx[] = [];
  /** Number of structured control blocks currently open. */
  private labelDepth = 0;
  /** Scratch local indices for checked/saturating casts (set by wacEmitFunc). */
  tempI64Local = -1;
  tempI32Local = -1;
  tempF32Local = -1;
  tempF64Local = -1;
  /** anyref scratch, for holding an array while a fill loop runs. */
  tempAnyLocal = -1;
  /**
   * Three scratch locals per width, for holding both operands and the result of a
   * checked add/sub/mul. Declared only when checking, so an ordinary build is
   * byte-identical to one from a compiler without the flag.
   *
   * Safe to share across nested arithmetic: both operands are fully evaluated
   * before either is stored, so an inner operation has finished with the scratch
   * by the time an outer one writes to it.
   */
  /** Cursor scratch for trace instrumentation. Its own local: the index being
   *  recorded is held in tempI32Local, which this must not clobber. */
  tempTraceLocal = -1;
  chk32A = -1; chk32B = -1; chk32S = -1;
  chk64A = -1; chk64B = -1; chk64S = -1;

  constructor(ctx: WasmTypeCtx, returnType: WacType) {
    this.ctx = ctx;
    this.returnType = returnType;
  }

  getBytes(): number[] { return this.out; }

  private emit(...bytes: number[]): void { this.out.push(...bytes); }

  /**
   * Record a branch point and emit its counter increment. No-op when coverage is
   * off, so every call site can be unconditional.
   *
   * The counters live in a WasmGC i32 array held in global 0. Incrementing one
   * is `counters[i] = counters[i] + 1`, which in stack order means pushing the
   * array and index for the store, then reading the old value and adding one:
   *
   *   global.get 0 ; i32.const i          -- destination for array.set
   *   global.get 0 ; i32.const i ; array.get ; i32.const 1 ; i32.add
   *   array.set
   *
   * The global is nullable and starts null, so __cov_init must run first — a
   * missing init traps on the first increment rather than corrupting counts.
   */
  /** Record the "this function ran" point. Public shim over emitCovPoint. */
  emitEntryPoint(entry: FuncEntry, body: Block): void {
    const line = entry.origin.kind === "func" ? entry.origin.decl.line : entry.origin.decl.line;
    const col  = entry.origin.kind === "func" ? entry.origin.decl.col  : entry.origin.decl.col;
    this.emitCovPoint("entry", line ?? body.line, col ?? body.col);
  }

  /**
   * Clear the trap message at the start of an exported function.
   *
   * Without it the global is *stale* rather than absent: a call that trapped with a
   * message, followed by one that hit a bounds check, would report the first call's
   * message for the second's failure. Wrong beats missing here.
   */
  emitTrapClear(): void {
    const g = this.ctx.trapGlobalIdx;
    if (g < 0) return;
    this.emit(0xD0, ...sleb(this.ctx.stringTypeIdx)); // ref.null $str
    this.emit(0x24, ...uleb(g));                      // global.set
  }

  private emitCovPoint(kind: CoveragePoint["kind"], line: number, col: number): void {
    const cov = this.ctx.coverage;
    if (!cov) return;

    const index = cov.points.length;
    cov.points.push({ index, file: cov.file, line, col, kind });
    if (cov.trace) { this.emitTraceAppend(index, [0x41, 0x00]); return; }

    const aIdx = this.ctx.arrTypeIdx.get(typeKey(I32))!;
    this.emit(0x23, 0x00);                        // global.get 0
    this.emit(0x41, ...sleb(index));              // i32.const index
    this.emit(0x23, 0x00);                        // global.get 0
    this.emit(0x41, ...sleb(index));              // i32.const index
    this.emit(0xFB, 0x0B, ...uleb(aIdx));         // array.get
    this.emit(0x41, 0x01);                        // i32.const 1
    this.emit(0x6A);                              // i32.add
    this.emit(0xFB, 0x0E, ...uleb(aIdx));         // array.set
  }

  /**
   * Record an index expression, leaving it on the stack for the access that follows.
   *
   * Woven into the access rather than emitted beside it, because the value being
   * recorded is the one about to be consumed — `local.tee` keeps a copy without
   * disturbing the stack.
   */
  private emitTraceIndex(line: number, col: number): void {
    const cov = this.ctx.coverage;
    if (!cov?.trace) return;
    const index = cov.points.length;
    cov.points.push({ index, file: cov.file, line, col, kind: "index" });
    this.emit(0x22, ...uleb(this.tempI32Local));   // local.tee — keep the index
    this.emitTraceAppend(index, [0x20, ...uleb(this.tempI32Local)]);
  }

  /**
   * Append `(site, value)` to the trace log.
   *
   * The log is the coverage array used as a journal: slot 0 is the write cursor and
   * events follow in pairs. That avoids a second global, and the host reads it with
   * the accessors coverage already exports.
   *
   * The bounds test is a branch, but on the cursor rather than on anything the
   * program computed, so it never varies between two runs of the same length —
   * which is the only property this instrumentation has to preserve.
   */
  private emitTraceAppend(site: number, valueBytes: number[]): void {
    const aIdx = this.ctx.arrTypeIdx.get(typeKey(I32))!;
    const cur = this.tempTraceLocal;
    const arr = () => this.emit(0x23, 0x00);              // global.get 0

    arr(); this.emit(0x41, 0x00, 0xFB, 0x0B, ...uleb(aIdx)); // cursor = log[0]
    this.emit(0x22, ...uleb(cur));
    this.emit(0x41, 0x03, 0x6A);                          // cursor + 3
    arr(); this.emit(0xFB, 0x0F);                         // array.len
    this.emit(0x49);                                      // i32.lt_u
    this.emit(0x04, 0x40);                                // if (room)
    arr(); this.emit(0x20, ...uleb(cur), 0x41, 0x01, 0x6A);
    this.emit(0x41, ...sleb(site), 0xFB, 0x0E, ...uleb(aIdx));   // log[cur+1] = site
    arr(); this.emit(0x20, ...uleb(cur), 0x41, 0x02, 0x6A);
    this.emit(...valueBytes, 0xFB, 0x0E, ...uleb(aIdx));         // log[cur+2] = value
    arr(); this.emit(0x41, 0x00, 0x20, ...uleb(cur), 0x41, 0x02, 0x6A);
    this.emit(0xFB, 0x0E, ...uleb(aIdx));                        // log[0] = cur + 2
    this.emit(0x0B);                                      // end
  }

  // ── Block type encoding ──

  private blockType(t: WacType): number[] {
    if (t.kind === "prim" && t.name === "void") return [0x40];
    return wasmValType(t, this.ctx);
  }

  // ── Helper: compute br depth to a target saved label depth ──

  private brDepth(savedDepth: number): number {
    return this.labelDepth - savedDepth - 1;
  }

  // ── Nullable primitives: boxed, because no wasm numeric type has a null ──

  /**
   * Box the value on the stack into the struct that represents `P?`.
   *
   * `i32?` is stored as anyref, so an i32 going into one has to become a reference. A
   * one-field struct rather than `ref.i31`, which is free but holds only 31 bits: it would
   * truncate exactly the values a program is most careful about [issue 0045]. The struct is
   * synthesised by the resolver, so `struct.new` is all this needs.
   */
  private boxPrim(prim: string): void {
    const idx = this.ctx.structTypeIdx.get(boxStructName(prim));
    if (idx === undefined) return;    // no `P?` in the program, so nothing to box into
    this.emit(0xFB, 0x00, ...uleb(idx));   // struct.new $#box$P
  }

  /** The other direction: `x!` on a `P?`, which is a cast and a field read. */
  private unboxPrim(prim: string): void {
    const idx = this.ctx.structTypeIdx.get(boxStructName(prim));
    if (idx === undefined) return;
    // `ref.cast`'s immediate is a *heap type*, which is a signed LEB (s33) — not the unsigned type
    // index that `struct.get` below takes. They agree for indices under 64 and diverge at exactly
    // 64, where `uleb` emits the single byte 0x40 and a decoder reading s33 sees -64. See the note
    // on `sleb` and issue 0062.
    this.emit(0xFB, 0x16, ...sleb(idx));       // ref.cast (ref $#box$P) — also the null check
    this.emit(0xFB, 0x02, ...uleb(idx), 0x00); // struct.get $#box$P 0
  }

  /**
   * The expected type worth pushing into an expression, or nothing.
   *
   * Two reasons to push one: `null` has no type of its own, and a value going into a nullable
   * primitive has to be boxed. Not otherwise — a literal's width comes from what the checker
   * resolved, and pushing a type down unconditionally made the two disagree.
   */
  private hintFor(t: WacType | undefined, arg: Expr): WacType | undefined {
    if (t === undefined) return undefined;
    if (arg.kind === "null") return t;
    if (t.kind === "nullable" && needsBoxing(t.inner)) return t;
    return undefined;
  }

  /**
   * Box a just-emitted value if its slot is a nullable primitive and it is not one already.
   *
   * One hook rather than one per position: every expected-type position already threads
   * `expectType` through `emitExpr`, so this covers a declaration, an assignment, a call's
   * argument, a return, a field, an array element, a ternary branch and a match arm at once.
   */
  private boxForExpected(e: Expr, env: TypeEnv, expectType: WacType | undefined): void {
    if (expectType?.kind !== "nullable" || !needsBoxing(expectType.inner)) return;
    const want = (expectType.inner as { name: string }).name;
    const got = typeOfExpr(e, env, this.ctx);
    // Only a *raw* value of that primitive needs it. A `P?` value is already boxed, and
    // `null` is already a reference.
    if (got.kind !== "prim" || got.name !== want) return;
    this.boxPrim(want);
  }

  // ── Expression emitter ──

  emitExpr(e: Expr, env: TypeEnv, expectType?: WacType): void {
    this.emitExprRaw(e, env, expectType);
    this.boxForExpected(e, env, expectType);
  }

  private emitExprRaw(e: Expr, env: TypeEnv, expectType?: WacType): void {
    switch (e.kind) {
      case "int": {
        // Emission only runs after a successful typecheck, which rejects any
        // literal wacIntLit can't interpret — so this always narrows to ok.
        // Read once the width is known, not before: a hex literal read at 32 bits and
        // then widened is `0xFFFFFFFF` becoming -1 in an i64 [issue 0054].
        const litWidth = ((): 32 | 64 => {
          const res0 = e.resolved?.kind === "prim" ? e.resolved.name : undefined;
          if (res0 !== undefined) return res0 === "i64" || res0 === "u64" ? 64 : 32;
          if (expectType?.kind === "prim" && (expectType.name === "i64" || expectType.name === "u64")) return 64;
          return 32;
        })();
        const lit = wacIntLit(e.value, litWidth) as { ok: true; value: bigint; width: 32 | 64 };
        // The literal's own width decides as well as the expected type. Relying on
        // expectType alone emitted i32.const for an i64-typed literal wherever no
        // type was being pushed down — as a binary operand, for instance — which
        // is invalid wasm rather than a wrong value.
        // A literal typed from context wins: it already knows whether it is a
        // 32- or 64-bit value, and whether it is signed, so consult it first.
        const res = e.resolved?.kind === "prim" ? e.resolved.name : undefined;
        const isI64 = res !== undefined
          ? (res === "i64" || res === "u64")
          : lit.width === 64
            || (expectType?.kind === "prim" &&
                (expectType.name === "i64" || expectType.name === "u64"));
        if (isI64) {
          this.emit(0x42, ...slebBig(BigInt.asIntN(64, lit.value))); // i64.const
        } else {
          this.emit(0x41, ...sleb(Number(BigInt.asIntN(32, lit.value)))); // i32.const
        }
        break;
      }
      case "float": {
        const v = wacFloatLit(e.value);
        // `resolved` is what the type checker decided, and it wins over the expected
        // type for the same reason it does for integers: the checker's answer is the one
        // the program was checked against, and re-deriving it here is how the two came
        // to disagree about i64 literals.
        const isF32 = e.resolved?.kind === "prim"
          ? e.resolved.name === "f32"
          : expectType?.kind === "prim" && expectType.name === "f32";
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
      case "bool": {
        this.emit(0x41, e.value ? 1 : 0); // i32.const
        break;
      }
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
        // A module-level constant is substituted here rather than loaded: the
        // type checker has already established the initialiser is a
        // compile-time expression, so emitting it inline is the whole
        // implementation — no global, no initialisation order.
        if (e.constRef) {
          const g = this.ctx.constGlobalIdx.get(e.constRef);
          if (g !== undefined) { this.emit(0x23, ...uleb(g)); break; } // global.get
          this.emitExpr(e.constRef.init, env, e.constRef.type);
          break;
        }
        // Named function reference, through the calling file's scope — `ctx.funcIdx` maps bare names
        // globally and first-wins, so two files each with a private `helper` both reached whichever
        // registered first. The call sites have asked the file scope since 123ac4c; taking a *reference*
        // to one had not, and a funcref is the shape where the mistake travels furthest from its cause.
        const scopedRef = this.ctx.result.fileScopes.get(this.ctx.currentFile)?.get(e.name);
        const fIdx = scopedRef?.kind === "func"
          ? scopedRef.entry.funcIndex + this.ctx.funcBase
          : this.ctx.funcIdx.get(e.name);
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
            else if (prim === "i64" || prim === "u64") {
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
            // Width, not signedness, decides here — but u64 has to be named
            // explicitly or it falls through to the 32-bit form.
            if (prim === "i64" || prim === "u64") this.emit(0x42, 0x7F, 0x85); // i64.const -1; i64.xor
            else this.emit(0x41, 0x7F, 0x73);                 // i32.const -1; i32.xor
            break;
        }
        break;
      }
      case "binary": this.emitBinary(e, env); break;
      case "ternary": {
        const resT = typeOfExpr(e, env, this.ctx); // ternary case computes the LCA
        this.emitExpr(e.cond, env);
        this.emit(0x04, ...this.blockType(resT)); // if (result T)
        this.labelDepth++;
        this.emitCovPoint("ternary-then", e.then.line, e.then.col);
        // Both branches are emitted against the result type. A `null` branch needs it
        // in order to emit a typed `ref.null $T` rather than `ref.null any`, which the
        // block's declared result would then reject; a float branch needs it to pick
        // f32 over f64. The branches were previously emitted with no expected type at
        // all, which happened to work only because no branch had ever needed one.
        this.emitExpr(e.then, env, resT);
        this.emit(0x05); // else
        this.emitCovPoint("ternary-else", e.else_.line, e.else_.col);
        this.emitExpr(e.else_, env, resT);
        this.emit(0x0B); // end
        this.labelDepth--;
        break;
      }
      case "cast":   this.emitCast(e, env); break;
      case "is":     this.emitIs(e, env); break;
      case "incr-expr": this.emitIncrExpr(e, env); break;
      case "unwrap": {
        this.emitExpr(e.expr, env);
        const inner = typeOfExpr(e, env, this.ctx);
        // A boxed primitive needs unwrapping in the other sense too: `ref.cast` is the null
        // check *and* the way to the field, so `ref.as_non_null` would be redundant.
        if (needsBoxing(inner)) this.unboxPrim((inner as { name: string }).name);
        else this.emit(0xD4);  // ref.as_non_null
        break;
      }
      case "call":   this.emitCall(e, env); break;
      case "field":  this.emitField(e, env); break;
      case "index":  this.emitIndex(e, env); break;
      case "construct": this.emitConstruct(e, env); break;
      case "arrNew":    this.emitArrNew(e, env); break;
      case "matchExpr": this.emitMatchExpr(e, env); break;
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
      this.emitCovPoint("and-rhs", e.right.line, e.right.col);
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
      this.emitCovPoint("or-rhs", e.right.line, e.right.col);
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
      // A shift amount of any integer width, converted to the operand's.
      if (op === "<<" || op === ">>" || op === ">>>") {
        this.coerceShiftAmount(
          typeOfExpr(e.left, env, this.ctx),
          typeOfExpr(e.right, env, this.ctx),
        );
      }
    }

    const lt = typeOfExpr(e.left, env, this.ctx);
    const isStr = lt.kind === "prim" && lt.name === "string";

    // String operations via helper functions
    if (isStr) {
      const cmpIdx = this.ctx.helperIdx.get("__str_cmp")!;
      const concatIdx = this.ctx.helperIdx.get("__str_concat")!;
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

    // Six columns, not four: u32/u64 share i32/i64's storage but need the
    // unsigned opcode for the operations where the sign bit matters —
    // div_u, rem_u, shr_u and the four ordering comparisons. Everything else
    // (add, sub, mul, the bitwise ops, shl, eq, ne) is bit-identical for both
    // signednesses and simply repeats the signed column.
    const p = lt.kind === "prim" ? lt.name : "i32";
    // Packed elements are read out as i32 before any operation, so they use
    // the i32 column regardless of their own signedness.
    const k = p === "bool" || p === "i8" || p === "i16" || p === "u8" || p === "u16" ? "i32"
            : p === "i32" ? "i32" : p === "i64" ? "i64"
            : p === "u32" ? "u32" : p === "u64" ? "u64"
            : p === "f32" ? "f32" : "f64";
    type KT = "i32" | "i64" | "u32" | "u64" | "f32" | "f64";
    const ops: Record<string, Record<KT, number[]>> = {
      "+":   { i32:[0x6A], i64:[0x7C], u32:[0x6A], u64:[0x7C], f32:[0x92], f64:[0xA0] },
      "-":   { i32:[0x6B], i64:[0x7D], u32:[0x6B], u64:[0x7D], f32:[0x93], f64:[0xA1] },
      "*":   { i32:[0x6C], i64:[0x7E], u32:[0x6C], u64:[0x7E], f32:[0x94], f64:[0xA2] },
      //                               div_u       div_u
      "/":   { i32:[0x6D], i64:[0x7F], u32:[0x6E], u64:[0x80], f32:[0x95], f64:[0xA3] },
      // wasm has no f32.rem/f64.rem — float % is a call to the fmod helper,
      // which takes both operands off the stack just as an opcode would.
      //                               rem_u       rem_u
      "%":   { i32:[0x6F], i64:[0x81], u32:[0x70], u64:[0x82],
               f32:[0x10, ...uleb(this.ctx.helperIdx.get("__fmodf")!)],
               f64:[0x10, ...uleb(this.ctx.helperIdx.get("__fmod")!)] },
      "&":   { i32:[0x71], i64:[0x83], u32:[0x71], u64:[0x83], f32:[],     f64:[]     },
      "|":   { i32:[0x72], i64:[0x84], u32:[0x72], u64:[0x84], f32:[],     f64:[]     },
      "^":   { i32:[0x73], i64:[0x85], u32:[0x73], u64:[0x85], f32:[],     f64:[]     },
      "<<":  { i32:[0x74], i64:[0x86], u32:[0x74], u64:[0x86], f32:[],     f64:[]     },
      //                               shr_u       shr_u  — `>>` on an unsigned
      //                               type is already the logical shift
      ">>":  { i32:[0x75], i64:[0x87], u32:[0x76], u64:[0x88], f32:[],     f64:[]     },
      ">>>": { i32:[0x76], i64:[0x88], u32:[0x76], u64:[0x88], f32:[],     f64:[]     },
      "==":  { i32:[0x46], i64:[0x51], u32:[0x46], u64:[0x51], f32:[0x5B], f64:[0x61] },
      "!=":  { i32:[0x47], i64:[0x52], u32:[0x47], u64:[0x52], f32:[0x5C], f64:[0x62] },
      //                               lt_u        lt_u
      "<":   { i32:[0x48], i64:[0x53], u32:[0x49], u64:[0x54], f32:[0x5D], f64:[0x63] },
      "<=":  { i32:[0x4C], i64:[0x57], u32:[0x4D], u64:[0x58], f32:[0x5F], f64:[0x65] },
      ">":   { i32:[0x4A], i64:[0x55], u32:[0x4B], u64:[0x56], f32:[0x5E], f64:[0x64] },
      ">=":  { i32:[0x4E], i64:[0x59], u32:[0x4F], u64:[0x5A], f32:[0x60], f64:[0x66] },
    };
    const oc = ops[op]?.[k as KT] ?? [];
    // `--checked`: wrap add/sub/mul in an overflow test that traps. Whole-module by
    // design — it answers "what does my code depend on", not "which expression did I
    // mean to wrap". An expression-level opt-out is what a default flip would need,
    // and `wactest/itoa64.wac` is why: it negates i64's minimum deliberately, two
    // lines away from a digit loop that wants checking.
    if (this.ctx.checked && (op === "+" || op === "-" || op === "*") &&
        (k === "i32" || k === "i64" || k === "u32" || k === "u64")) {
      this.emitCheckedArith(op, k, oc);
      return;
    }
    this.emit(...oc);
  }

  /**
   * A checked add/sub/mul: operands are on the stack, result left on the stack,
   * `unreachable` on overflow.
   *
   * Add and sub use the sign identities, which cost a handful of instructions.
   * Signed 32-bit multiply widens to 64 and range-checks, which is exact and cheap.
   * 64-bit multiply verifies by division — the slow strategy, chosen here because it
   * is obviously correct; a shipped version would decompose into 32-bit halves.
   */
  private emitCheckedArith(op: string, k: string, oc: number[]): void {
    const is64 = k === "i64" || k === "u64";
    const uns = k === "u32" || k === "u64";
    const [A, B, S] = is64
      ? [this.chk64A, this.chk64B, this.chk64S]
      : [this.chk32A, this.chk32B, this.chk32S];
    const get = (i: number) => [0x20, ...uleb(i)];
    const set = (i: number) => [0x21, ...uleb(i)];
    // wasm opcodes, 32-bit then 64-bit
    const XOR = is64 ? 0x85 : 0x73, AND = is64 ? 0x83 : 0x71;
    const LT_S = is64 ? 0x53 : 0x48, LT_U = is64 ? 0x54 : 0x49;
    const CONST0 = is64 ? [0x42, 0x00] : [0x41, 0x00];
    const trapIf = (cond: number[]) => this.emit(...cond, 0x04, 0x40, 0x00, 0x0B); // if; unreachable; end

    this.emit(...set(B), ...set(A));                       // pop b, then a
    this.emit(...get(A), ...get(B), ...oc, ...set(S));     // s = a op b, stashed not left

    if (op === "*") {
      if (!is64) {
        // Redo the multiply at 64 bits and compare: exact, and no division.
        const ext = uns ? 0xAD : 0xAC;                      // i64.extend_i32_u / _s
        this.emit(...get(A), ext, ...get(B), ext, 0x7E, ...set(this.chk64S));
        const hi = uns ? [0x42, ...slebBig(4294967295n)] : [0x42, ...slebBig(2147483647n)];
        const lo = uns ? [0x42, 0x00] : [0x42, ...slebBig(-2147483648n)];
        trapIf([...get(this.chk64S), ...hi, 0x55]);          // > max  (i64.gt_s)
        trapIf([...get(this.chk64S), ...lo, 0x53]);          // < min  (i64.lt_s)
        this.emit(...get(S));
      } else {
        // Verify by division: a != 0 && s / a != b  =>  overflow. i64.div_s traps on
        // MIN / -1, so the signed form guards that pair separately.
        const DIV = uns ? 0x80 : 0x7F;
        const NE = 0x52, EQZ = 0x50;
        if (!uns) {
          trapIf([...get(A), 0x42, ...slebBig(-1n), 0x51,
                  ...get(B), 0x42, ...slebBig(-9223372036854775808n), 0x51, 0x71]);
          trapIf([...get(B), 0x42, ...slebBig(-1n), 0x51,
                  ...get(A), 0x42, ...slebBig(-9223372036854775808n), 0x51, 0x71]);
        }
        // A real branch, not an `and`: wasm evaluates both sides, and the division
        // itself traps on a zero divisor — so `a != 0 && s / a != b` written as `and`
        // trapped on every `0 * x`. The sweep caught it; the hand-written version
        // looked obviously correct.
        this.emit(...get(A), EQZ, 0x45, 0x04, 0x40);        // if (a != 0) {
        trapIf([...get(S), ...get(A), DIV, ...get(B), NE]); //   trap if s / a != b
        this.emit(0x0B);                                    // }
        this.emit(...get(S));
      }
      return;
    }

    if (uns) {
      // Unsigned add overflows iff the sum is below either operand; unsigned sub
      // iff the subtrahend exceeds the minuend.
      trapIf(op === "+"
        ? [...get(S), ...get(A), LT_U]
        : [...get(A), ...get(B), LT_U]);
      this.emit(...get(S));
      return;
    }
    // Signed: add overflows iff the operands agree in sign and the sum differs;
    // sub iff the operands differ in sign and the result differs from the minuend.
    trapIf(op === "+"
      ? [...get(A), ...get(S), XOR, ...get(B), ...get(S), XOR, AND, ...CONST0, LT_S]
      : [...get(A), ...get(B), XOR, ...get(A), ...get(S), XOR, AND, ...CONST0, LT_S]);
    this.emit(...get(S));
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
      // `as~` is the truncating cast, and `ref.i31` truncating is precisely what it means: keep
      // the low thirty-one bits, whatever was above them. Nothing was emitted for it at all, so
      // the i32 stayed on the stack where an i31ref was wanted and the module did not validate —
      // which is the spelling the checker's own hint recommends when `as` is refused as lossy.
      if (e.op === "as~") {
        if (fromT.kind === "prim" && fromT.name === "i32" &&
            toT.kind === "prim" && toT.name === "i31ref") {
          this.emit(0xFB, 0x1C); // ref.i31
          return;
        }
        if (fromT.kind === "prim" && fromT.name === "i31ref" &&
            toT.kind === "prim" && toT.name === "i32") {
          this.emit(0xFB, 0x1D); // i31.get_s
          return;
        }
      }
      if (e.op === "as!") {
        // i32 → i31ref: checked, then ref.i31.
        //
        // `ref.i31` keeps the low thirty-one bits and says nothing about the rest, so on its own it
        // is the *unchecked* cast: 2^30 came back as -2^30, having silently changed sign [issue
        // 0085]. `as!` promises exact-or-trap for every other member of the family, and an i31
        // holds a signed 31-bit value — so anything outside [-2^30, 2^30-1] traps here rather than
        // arriving as a different number.
        if (fromT.kind === "prim" && fromT.name === "i32" &&
            toT.kind === "prim" && toT.name === "i31ref") {
          const I31MAX = 1073741823, I31MIN = -1073741824;
          this.guardI32(I31MAX, 0x4A);   // x >s  2^30 - 1
          this.guardI32(I31MIN, 0x48);   // x <s -2^30
          this.emit(0xFB, 0x1C);         // ref.i31
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

  /** Trap unless the i32 on the stack satisfies a predicate, leaving it there.
   *  `cmp` is the comparison opcode applied against `bound`; it must be the
   *  *failing* condition. Used by the checked (`as!`) signedness changes. */
  private guardI32(bound: number, cmp: number): void {
    const t = this.tempI32Local;
    this.emit(0x22, ...uleb(t));         // local.tee $t
    this.emit(0x41, ...sleb(bound));     // i32.const bound
    this.emit(cmp);                      // compare — true means out of range
    this.emit(0x04, 0x40, 0x00, 0x0B);   // if { unreachable }
    this.emit(0x20, ...uleb(t));         // local.get $t
  }

  private guardI64(bound: bigint, cmp: number): void {
    const t = this.tempI64Local;
    this.emit(0x22, ...uleb(t));
    this.emit(0x42, ...slebBig(bound));
    this.emit(cmp);
    this.emit(0x04, 0x40, 0x00, 0x0B);
    this.emit(0x20, ...uleb(t));
  }

  /** Fill an array on the stack with a freshly built default per element.
   *
   *  Takes the array off the stack, writes `arr[i] = default` for every i, and
   *  leaves the array back on it. The array lives in the anyref scratch local
   *  rather than one local per array type — anyref holds any of them, and a
   *  ref.cast on the way out costs a great deal less than threading a typed
   *  scratch local through local allocation. */
  private emitFillLoop(elem: WacType, aIdx: number): void {
    const arrT: WacType = { kind: "array", elem, line: 0, col: 0 };
    const cast = () => {
      this.emit(0x20, ...uleb(this.tempAnyLocal));            // local.get $any
      this.emit(0xFB, 0x16, ...heapTypeBytes(arrT, this.ctx)); // ref.cast (ref $arr)
    };
    const i = this.tempI32Local;
    this.emit(0x21, ...uleb(this.tempAnyLocal));  // local.set $any  (array)
    this.emit(0x41, 0x00);                        // i32.const 0
    this.emit(0x21, ...uleb(i));                  // local.set $i
    this.emit(0x02, 0x40);                        // block (void)
    this.emit(0x03, 0x40);                        //   loop (void)
    this.emit(0x20, ...uleb(i));                  //     local.get $i
    cast();
    this.emit(0xFB, 0x0F);                        //     array.len
    this.emit(0x4F);                              //     i32.ge_u
    this.emit(0x0D, 0x01);                        //     br_if 1  (out of block)
    cast();
    this.emit(0x20, ...uleb(i));                  //     local.get $i
    this.emitDefaultValue(elem);                  //     a fresh element
    this.emit(0xFB, 0x0E, ...uleb(aIdx));         //     array.set $arr
    this.emit(0x20, ...uleb(i), 0x41, 0x01, 0x6A); //    i + 1
    this.emit(0x21, ...uleb(i));                  //     local.set $i
    this.emit(0x0C, 0x00);                        //     br 0  (continue)
    this.emit(0x0B);                              //   end loop
    this.emit(0x0B);                              // end block
    cast();                                       // result: the filled array
  }

  /** Trap unless the float on the stack is already an integer, leaving it there.
   *
   *  `x != trunc(x)` is true for a fractional value and also for NaN, which the
   *  following trunc opcode would reject anyway — so NaN still traps, just one
   *  instruction earlier. Infinities equal their own truncation and fall through
   *  to the range check, which rejects them. */
  private guardIntegral(isF32: boolean): void {
    const t = isF32 ? this.tempF32Local : this.tempF64Local;
    this.emit(0x22, ...uleb(t));         // local.tee $t        (x)
    this.emit(isF32 ? 0x8F : 0x9D);      // fN.trunc            (trunc(x))
    this.emit(0x20, ...uleb(t));         // local.get $t        (x)
    this.emit(isF32 ? 0x5C : 0x62);      // fN.ne               (trunc(x) != x)
    this.emit(0x04, 0x40, 0x00, 0x0B);   // if { unreachable }
    this.emit(0x20, ...uleb(t));         // local.get $t
  }

  /** Conversions where either side is unsigned. Returns true if handled.
   *
   *  Signedness is a property of the wac type, not of the storage, so a
   *  same-width change (i32<->u32, i64<->u64) moves no bits: `as@` emits
   *  nothing at all, and `as!` emits only a range check. The float and
   *  narrowing rows mirror their signed equivalents with the _u opcodes. */
  /** `x < bound ? bound : x` at 64 bits, signed — the low end of an `as~` clamp. */
  private clampI64Low(bound: bigint): void {
    const t = this.tempI64Local;
    this.emit(0x22, ...uleb(t));
    this.emit(0x42, ...slebBig(bound), 0x53);        // i64.const bound; i64.lt_s
    this.emit(0x04, 0x7E, 0x42, ...slebBig(bound), 0x05);
    this.emit(0x20, ...uleb(t), 0x0B);
  }

  /** `x > bound ? bound : x` at 64 bits, signed. */
  private clampI64HighS(bound: bigint): void {
    const t = this.tempI64Local;
    this.emit(0x22, ...uleb(t));
    this.emit(0x42, ...slebBig(bound), 0x55);        // i64.const bound; i64.gt_s
    this.emit(0x04, 0x7E, 0x42, ...slebBig(bound), 0x05);
    this.emit(0x20, ...uleb(t), 0x0B);
  }

  /** `x >u bound ? bound : x` at 64 bits — the unsigned reading, for a u64 source. */
  private clampI64HighU(bound: bigint): void {
    const t = this.tempI64Local;
    this.emit(0x22, ...uleb(t));
    this.emit(0x42, ...slebBig(bound), 0x56);        // i64.const bound; i64.gt_u
    this.emit(0x04, 0x7E, 0x42, ...slebBig(bound), 0x05);
    this.emit(0x20, ...uleb(t), 0x0B);
  }

  private emitUnsignedCast(from: string, to: string, op: string): boolean {
    const I32MAX = 2147483647, U32MAX = 4294967295n;
    const I64MAX = 9223372036854775807n;

    if (op === "as") {
      // Widening out of u32 is always exact: zero-extend, or convert.
      if (from === "u32" && (to === "u64" || to === "i64")) { this.emit(0xAD); return true; } // i64.extend_i32_u
      if (from === "u32" && to === "f64") { this.emit(0xB8); return true; }  // f64.convert_i32_u
      if (from === "bool" && to === "u32") return true;                       // already 0 or 1
      if (from === "bool" && to === "u64") { this.emit(0xAD); return true; }  // i64.extend_i32_u
    }

    if (op === "as@") {
      // Same width: a reinterpretation, so there is nothing to emit.
      if ((from === "i32" && to === "u32") || (from === "u32" && to === "i32") ||
          (from === "i64" && to === "u64") || (from === "u64" && to === "i64")) return true;
      if ((from === "u64" && (to === "u32" || to === "i32")) ||
          (from === "i64" && to === "u32")) { this.emit(0xA7); return true; }  // i32.wrap_i64
      if (from === "f64" && to === "u32") { this.emit(0xFC, 0x03); return true; } // trunc_sat_f64_u
      if (from === "f32" && to === "u32") { this.emit(0xFC, 0x01); return true; } // trunc_sat_f32_u
    }

    if (op === "as~") {
      if (from === "u32" && to === "f32") { this.emit(0xB3); return true; }  // f32.convert_i32_u
      if (from === "u64" && to === "f64") { this.emit(0xBA); return true; }  // f64.convert_i64_u
      if (from === "u64" && to === "f32") { this.emit(0xB5); return true; }  // f32.convert_i64_u
      // Round to nearest, then saturate — never traps, matching the signed rows.
      if (from === "f64" && to === "u32") { this.emit(0x9E, 0xFC, 0x03); return true; }
      if (from === "f32" && to === "u32") { this.emit(0x90, 0xFC, 0x01); return true; }
      if (from === "f64" && to === "u64") { this.emit(0x9E, 0xFC, 0x07); return true; }
      if (from === "f32" && to === "u64") { this.emit(0x90, 0xFC, 0x05); return true; }
      if (from === "u32" && to === "bool") { this.emit(0x45, 0x45); return true; } // x != 0
      // Same-width signedness change, clamping instead of trapping.
      if (from === "i32" && to === "u32") {  // negatives clamp to 0
        const t = this.tempI32Local;
        this.emit(0x22, ...uleb(t));
        this.emit(0x41, 0x00, 0x48);                 // i32.const 0; i32.lt_s
        this.emit(0x04, 0x7F, 0x41, 0x00, 0x05);     // if (i32) { 0 } else {
        this.emit(0x20, ...uleb(t), 0x0B);           //   $t }
        return true;
      }
      if (from === "u32" && to === "i32") {  // above i32 max clamps to i32 max
        const t = this.tempI32Local;
        this.emit(0x22, ...uleb(t));
        this.emit(0x41, ...sleb(I32MAX), 0x4B);      // i32.const MAX; i32.gt_u
        this.emit(0x04, 0x7F, 0x41, ...sleb(I32MAX), 0x05);
        this.emit(0x20, ...uleb(t), 0x0B);
        return true;
      }
      // The 64-bit and cross-width rows. Every one of these was in the type checker's narrowing
      // table — so `as~` was accepted — and had no case here, which meant the cast emitted
      // *nothing*: `i32 as~ u64` produced invalid wasm, and `i64 as~ u64` of -1 silently
      // reinterpreted the bits instead of clamping, which is what `as@` means. The 32-bit pair
      // above was right and its 64-bit mirror had never been written [found by the cast sweep].
      if (from === "i64" && to === "u64") { this.clampI64Low(0n); return true; }
      if (from === "u64" && to === "i64") { this.clampI64HighU(I64MAX); return true; }
      if (from === "i32" && to === "u64") {
        const t = this.tempI32Local;
        this.emit(0x22, ...uleb(t));
        this.emit(0x41, 0x00, 0x48);                 // i32.const 0; i32.lt_s
        this.emit(0x04, 0x7F, 0x41, 0x00, 0x05);     // if (i32) { 0 } else {
        this.emit(0x20, ...uleb(t), 0x0B);           //   $t }
        this.emit(0xAD);                             // i64.extend_i32_u
        return true;
      }
      if (from === "i64" && to === "u32") {
        this.clampI64Low(0n);                        // negatives to 0 first, then the top
        this.clampI64HighS(U32MAX);
        this.emit(0xA7);                             // i32.wrap_i64
        return true;
      }
      if (from === "u64" && to === "i32") { this.clampI64HighU(BigInt(I32MAX)); this.emit(0xA7); return true; }
      if (from === "u64" && to === "u32") { this.clampI64HighU(U32MAX); this.emit(0xA7); return true; }
      // Nonzero is true. Only the u64 row belongs here: this function is reached only when one
      // side is unsigned, so `i64 -> bool` and the float rows live in the signed table.
      if (from === "u64" && to === "bool") { this.emit(0x50, 0x45); return true; }
    }

    if (op === "as!") {
      // To bool: only an exact 0 or 1 has a reading, so anything else traps. The i32 row lives in
      // the signed table; these are its wider and floating-point mirrors.
      if (from === "u64" && to === "bool") { this.checkedToBool64(); return true; }
      if (from === "u32" && to === "bool") { this.checkedToBool32(); return true; }
      // Same width: check the value has a reading in the destination type.
      if (from === "i32" && to === "u32") { this.guardI32(0, 0x48); return true; }        // x < 0
      if (from === "u32" && to === "i32") { this.guardI32(I32MAX, 0x4B); return true; }   // x >u MAX
      if (from === "i64" && to === "u64") { this.guardI64(0n, 0x53); return true; }       // x < 0
      if (from === "u64" && to === "i64") { this.guardI64(I64MAX, 0x56); return true; }   // x >u MAX
      if (from === "i32" && to === "u64") { this.guardI32(0, 0x48); this.emit(0xAD); return true; }
      // Narrowing: range-check at 64 bits, then wrap.
      if (from === "u64" && to === "u32") { this.guardI64(U32MAX, 0x56); this.emit(0xA7); return true; }
      if (from === "u64" && to === "i32") { this.guardI64(BigInt(I32MAX), 0x56); this.emit(0xA7); return true; }
      if (from === "i64" && to === "u32") {
        // Must be in [0, 2^32) — reject negatives and anything too large.
        this.guardI64(0n, 0x53);
        this.guardI64(U32MAX, 0x55);   // i64.gt_s is fine here: already non-negative
        this.emit(0xA7);
        return true;
      }
      // float -> unsigned: the trapping trunc opcodes reject negative,
      // out-of-range and NaN inputs; the guard adds the fractional case, so
      // these behave exactly like their signed counterparts.
      if (from === "f64" && to === "u32") { this.guardIntegral(false); this.emit(0xAB); return true; }
      if (from === "f32" && to === "u32") { this.guardIntegral(true);  this.emit(0xA9); return true; }
      if (from === "f64" && to === "u64") { this.guardIntegral(false); this.emit(0xB1); return true; }
      if (from === "f32" && to === "u64") { this.guardIntegral(true);  this.emit(0xAF); return true; }
      // unsigned -> float: exact iff converting back round-trips. Mirrors the
      // signed i64->f32/f64 cases, with 2^64 as the saturation boundary.
      if (from === "u32" && to === "f32") {
        const i = this.tempI32Local, b = this.tempF32Local;
        this.emit(0x22, ...uleb(i));
        this.emit(0xB3);                   // f32.convert_i32_u  (c)
        this.emit(0x22, ...uleb(b));
        this.emit(0xBB);                   // f64.promote_f32
        this.emit(0x20, ...uleb(i));
        this.emit(0xB8);                   // f64.convert_i32_u  (exact for all u32)
        this.emit(0x62);                   // f64.ne
        this.emit(0x04, 0x40, 0x00, 0x0B);
        this.emit(0x20, ...uleb(b));
        return true;
      }
      if (from === "u64" && (to === "f64" || to === "f32")) {
        const isF32 = to === "f32";
        const l = this.tempI64Local, d = isF32 ? this.tempF32Local : this.tempF64Local;
        this.emit(0x22, ...uleb(l));
        this.emit(isF32 ? 0xB5 : 0xBA);          // fN.convert_i64_u  (c)
        this.emit(0x21, ...uleb(d));
        this.emit(0x20, ...uleb(d));
        this.emit(0xFC, isF32 ? 0x05 : 0x07);    // i64.trunc_sat_fN_u (back)
        this.emit(0x20, ...uleb(l));
        this.emit(0x52);                         // i64.ne
        this.emit(0x20, ...uleb(d));
        if (isF32) this.emit(0x43, 0x00, 0x00, 0x80, 0x5F);                       // f32.const 2^64
        else       this.emit(0x44, 0, 0, 0, 0, 0, 0, 0xF0, 0x43);                 // f64.const 2^64
        this.emit(isF32 ? 0x5B : 0x61);          // fN.eq  (saturation boundary)
        this.emit(0x72);                         // i32.or
        this.emit(0x04, 0x40, 0x00, 0x0B);
        this.emit(0x20, ...uleb(d));
        return true;
      }
    }
    return false;
  }

  /**
   * `as!` to bool from a 32-bit integer: only an exact 0 or 1 has a reading.
   *
   * `i32 -> bool` was in the type checker's narrowing table from the start and had no case here, so
   * `3 as! bool` returned `true` — a checked cast that checked nothing. Found by contrast with the
   * 64-bit row, which is why adding a missing case is worth doing even when the existing one looks
   * fine [the cast sweep].
   */
  private checkedToBool32(): void {
    const t = this.tempI32Local;
    this.emit(0x22, ...uleb(t));
    this.emit(0x41, 0x01, 0x4B);                 // i32.const 1; i32.gt_u
    this.emit(0x04, 0x40, 0x00, 0x0B);           // if { unreachable }
    this.emit(0x20, ...uleb(t));                 // local.get $t — already 0 or 1
  }

  /** `as!` to bool from a 64-bit integer: only an exact 0 or 1 has a reading. */
  private checkedToBool64(): void {
    const t = this.tempI64Local;
    this.emit(0x22, ...uleb(t));
    this.emit(0x42, 0x01, 0x56);                 // i64.const 1; i64.gt_u
    this.emit(0x04, 0x40, 0x00, 0x0B);           // if { unreachable }
    this.emit(0x20, ...uleb(t), 0xA7);           // local.get $t; i32.wrap_i64
  }

  /** `as!` to bool from a float: 0.0 and 1.0 convert, anything else traps. */
  private checkedToBoolFloat(wide: boolean): void {
    const t = wide ? this.tempF64Local : this.tempF32Local;
    const zero = wide ? [0x44, 0, 0, 0, 0, 0, 0, 0, 0] : [0x43, 0, 0, 0, 0];
    const one  = wide ? [0x44, 0, 0, 0, 0, 0, 0, 0xF0, 0x3F] : [0x43, 0, 0, 0x80, 0x3F];
    const eq = wide ? 0x61 : 0x5B, ne = wide ? 0x62 : 0x5C;
    this.emit(0x22, ...uleb(t));
    this.emit(...zero, eq);                      // x == 0
    this.emit(0x20, ...uleb(t), ...one, eq);     // x == 1
    this.emit(0x72, 0x45);                       // i32.or; i32.eqz -> neither
    this.emit(0x04, 0x40, 0x00, 0x0B);           // if { unreachable }
    this.emit(0x20, ...uleb(t), ...zero, ne);    // result: x != 0
  }

  private emitNumericCast(from: string, to: string, op: string): void {
    if (from === to) return;
    if (from === "u32" || from === "u64" || to === "u32" || to === "u64") {
      if (this.emitUnsignedCast(from, to, op)) return;
    }
    // Lossless (as)
    if (op === "as") {
      if (from === "i32"  && to === "i64") { this.emit(0xAC); return; } // i32.extend_s
      if (from === "bool" && to === "i32") return;
      if (from === "i32"  && to === "f64") { this.emit(0xB7); return; } // f64.convert_i32_s
      if (from === "f32"  && to === "f64") { this.emit(0xBB); return; } // f64.promote_f32
      if (from === "bool" && to === "i64") { this.emit(0xAC); return; }
      if (from === "bool" && to === "f64") { this.emit(0xB8); return; }  // f64.convert_i32_u (0 or 1)
      if (from === "bool" && to === "f32") { this.emit(0xB3); return; }  // f32.convert_i32_u
      if (from === "i32"  && to === "f32") { this.emit(0xB2); return; } // f32.convert_i32_s
      if (from === "i64"  && to === "f64") { this.emit(0xB9); return; } // f64.convert_i64_s
    }
    // Checked (as!)
    if (op === "as!") {
      // To bool: only an exact 0 or 1 has a reading in it, so anything else traps.
      if (from === "i32" && to === "bool") { this.checkedToBool32(); return; }
      if (from === "i64" && to === "bool") { this.checkedToBool64(); return; }
      if (from === "f64" && to === "bool") { this.checkedToBoolFloat(true); return; }
      if (from === "f32" && to === "bool") { this.checkedToBoolFloat(false); return; }
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
      // The trunc opcodes trap on out-of-range and NaN but silently discard a
      // fractional part, so each needs the integrality guard first to make
      // `as!` mean "exact, or trap" [see casts.md].
      if (from === "f64" && to === "i32") { this.guardIntegral(false); this.emit(0xAA); return; }
      if (from === "f32" && to === "i32") { this.guardIntegral(true);  this.emit(0xA8); return; }
      if (from === "f64" && to === "i64") { this.guardIntegral(false); this.emit(0xB0); return; }
      if (from === "f32" && to === "i64") { this.guardIntegral(true);  this.emit(0xAE); return; }
      if (from === "f64" && to === "f32") {
        // Exact iff promote(demote(x)) == x. NaN never traps (x != x makes
        // the second conjunct false) [§wac-narrow-f32-*].
        const a = this.tempF64Local, b = this.tempF32Local;
        this.emit(0x22, ...uleb(a));       // local.tee $a       (x)
        this.emit(0xB6);                   // f32.demote_f64     (d)
        this.emit(0x22, ...uleb(b));       // local.tee $b
        this.emit(0xBB);                   // f64.promote_f32    (p)
        this.emit(0x20, ...uleb(a));       // local.get $a
        this.emit(0x62);                   // f64.ne             (p != x)
        this.emit(0x20, ...uleb(a));
        this.emit(0x20, ...uleb(a));
        this.emit(0x61);                   // f64.eq             (x == x — false for NaN)
        this.emit(0x71);                   // i32.and
        this.emit(0x04, 0x40, 0x00, 0x0B); // if { unreachable }
        this.emit(0x20, ...uleb(b));       // result: d
        return;
      }
      if (from === "i32" && to === "f32") {
        // Exact iff the f32 value equals the (always exact) f64 image of x.
        const i = this.tempI32Local, b = this.tempF32Local;
        this.emit(0x22, ...uleb(i));       // local.tee $i       (x)
        this.emit(0xB2);                   // f32.convert_i32_s  (c)
        this.emit(0x22, ...uleb(b));       // local.tee $b
        this.emit(0xBB);                   // f64.promote_f32
        this.emit(0x20, ...uleb(i));
        this.emit(0xB7);                   // f64.convert_i32_s  (exact for all i32)
        this.emit(0x62);                   // f64.ne
        this.emit(0x04, 0x40, 0x00, 0x0B); // if { unreachable }
        this.emit(0x20, ...uleb(b));       // result: c
        return;
      }
      if (from === "i64" && to === "f32") {
        // Exact iff trunc_sat(c) round-trips to x AND c isn't the saturation
        // boundary 2^63 (where i64::MAX would falsely compare equal).
        const l = this.tempI64Local, b = this.tempF32Local;
        this.emit(0x22, ...uleb(l));       // local.tee $l       (x)
        this.emit(0xB4);                   // f32.convert_i64_s  (c)
        this.emit(0x21, ...uleb(b));       // local.set $b
        this.emit(0x20, ...uleb(b));
        this.emit(0xFC, 0x04);             // i64.trunc_sat_f32_s (back)
        this.emit(0x20, ...uleb(l));
        this.emit(0x52);                   // i64.ne             (back != x)
        this.emit(0x20, ...uleb(b));
        this.emit(0x43, 0x00, 0x00, 0x00, 0x5F); // f32.const 2^63
        this.emit(0x5B);                   // f32.eq             (c == 2^63)
        this.emit(0x72);                   // i32.or
        this.emit(0x04, 0x40, 0x00, 0x0B); // if { unreachable }
        this.emit(0x20, ...uleb(b));       // result: c
        return;
      }
      if (from === "i64" && to === "f64") {
        // Same shape as i64 -> f32, in f64.
        const l = this.tempI64Local, d = this.tempF64Local;
        this.emit(0x22, ...uleb(l));       // local.tee $l       (x)
        this.emit(0xB9);                   // f64.convert_i64_s  (c)
        this.emit(0x21, ...uleb(d));       // local.set $d
        this.emit(0x20, ...uleb(d));
        this.emit(0xFC, 0x06);             // i64.trunc_sat_f64_s (back)
        this.emit(0x20, ...uleb(l));
        this.emit(0x52);                   // i64.ne
        this.emit(0x20, ...uleb(d));
        this.emit(0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xE0, 0x43); // f64.const 2^63
        this.emit(0x61);                   // f64.eq
        this.emit(0x72);                   // i32.or
        this.emit(0x04, 0x40, 0x00, 0x0B); // if { unreachable }
        this.emit(0x20, ...uleb(d));       // result: c
        return;
      }
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
      if (from === "f64" && to === "i64") {
        this.emit(0x9E);                  // f64.nearest
        this.emit(0xFC, 0x06);            // i64.trunc_sat_f64_s (clamp on overflow, no trap)
        return;
      }
      if (from === "f32" && to === "i64") {
        this.emit(0x90);                  // f32.nearest
        this.emit(0xFC, 0x04);            // i64.trunc_sat_f32_s (clamp on overflow, no trap)
        return;
      }
      if (from === "f64" && to === "f32")  { this.emit(0xB6); return; }       // f32.demote
      if (from === "i64" && to === "f64")  { this.emit(0xB9); return; }
      if (from === "i64" && to === "f32")  { this.emit(0xB4); return; }       // f32.convert_i64_s (nearest)
      if (from === "i32" && to === "f32")  { this.emit(0xB2); return; }
      if (from === "i32" && to === "bool") { this.emit(0x41, 0x00, 0x47); return; } // i32.const 0; i32.ne -> canonical 0/1
      // The wider and floating-point rows of the same rule: nonzero is true. Absent before,
      // while the type checker's table promised them.
      if (from === "i64" && to === "bool") { this.emit(0x50, 0x45); return; }       // i64.eqz; i32.eqz
      if (from === "f64" && to === "bool") { this.emit(0x44, 0, 0, 0, 0, 0, 0, 0, 0, 0x62); return; }
      if (from === "f32" && to === "bool") { this.emit(0x43, 0, 0, 0, 0, 0x5C); return; }
    }
    // Raw (as@): only where a genuinely distinct raw form exists (int narrowing
    // keeps bits; float->int truncates toward zero) — the type checker rejects
    // every other pair (no "same as as~" fallback; see isRawNumericCast).
    if (op === "as@") {
      if (from === "i64" && to === "i32")  { this.emit(0xA7); return; }                 // i32.wrap_i64 (keep low bits)
      if (from === "f64" && to === "i32")  { this.emit(0xFC, 0x02); return; }           // i32.trunc_sat_f64_s (toward zero, saturate, never traps)
      if (from === "f32" && to === "i32")  { this.emit(0xFC, 0x00); return; }           // i32.trunc_sat_f32_s
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
    e: { kind: "field"; expr: Expr; name: string; variantTypeIndex?: number },
    env: TypeEnv,
  ): void {
    // Shape.Point — a payload-less variant is a value, so construct it here. Which
    // variant is the checker's answer, for the same reason as in emitCall: a name
    // search over every enum in the program picks the wrong one when two files
    // declare the same enum name.
    if (e.variantTypeIndex !== undefined) {
      const vEntry = this.variantByTypeIndex(e.variantTypeIndex);
      if (vEntry) {
        const tIdx = vEntry.entry.typeIndex;
        this.emit(0x41, ...sleb(vEntry.tag));
        this.emit(0xFB, 0x00, ...uleb(tIdx));   // struct.new — the tag is its only field
        return;
      }
    }

    // StructName.method used as a funcref value: emit ref.func
    if (e.expr.kind === "ident") {
      const exprName = (e.expr as { name: string }).name;
      if (structIdxInFile(exprName, this.ctx) !== undefined) {
        const structEntry = resolveStructEntry(exprName, this.ctx);
        const methEntry = structEntry?.methods.get(e.name);
        if (methEntry) {
          // The entry's own index, not its mangled name — `Struct$method` is not unique across files,
          // and this entry came from the right struct. Same as the call sites in `emitCall` (0076); a
          // `ref.func` to the wrong one is worse, because the mismatch surfaces wherever it is *called*.
          this.emit(0xD2, ...uleb(methEntry.funcIndex + this.ctx.funcBase)); // ref.func
          return;
        }
      }
    }
    const baseT = typeOfExpr(e.expr, env, this.ctx);
    const sName = structName(baseT);
    if (sName) {
      const fields = this.ctx.structFields.get(structLookupKey(baseT)!) ?? [];
      const fi = fields.find(f => f.name === e.name);
      if (fi) {
        this.emitExpr(e.expr, env);
        const tIdx = structResolvedIndex(baseT) ?? structIdxInFile(sName, this.ctx)!;
        this.emit(0xFB, 0x02, ...uleb(tIdx), ...uleb(fi.absIdx)); // struct.get
        return;
      }
      // Method reference (not called here, handled in emitCall)
      const methEntry = resolveStructEntry(sName, this.ctx, structResolvedIndex(baseT))?.methods.get(e.name);
      if (methEntry) {
        this.emit(0xD2, ...uleb(methEntry.funcIndex + this.ctx.funcBase)); // ref.func
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
      this.emit(0x10, ...uleb(this.ctx.helperIdx.get("__str_idx")!)); // call __str_idx
      return;
    }
    const elem = t.kind === "array" ? t.elem
               : t.kind === "nullable" && t.inner.kind === "array" ? t.inner.elem
               : I32;
    const aIdx = this.ctx.arrTypeIdx.get(typeKey(elem))!;
    this.emitExpr(e.expr, env);
    this.emitExpr(e.idx, env);
    this.emitTraceIndex(e.idx.line ?? 0, e.idx.col ?? 0);
    // Packed elements are narrower than any value wasm computes with, so the
    // read has to extend them. Which way is exactly what the element type says:
    // i8/i16 sign-extend, u8/u16 zero-extend. Same storage either way.
    const en = elem.kind === "prim" ? elem.name : "";
    if (en === "i8" || en === "i16")      this.emit(0xFB, 0x0C, ...uleb(aIdx)); // array.get_s
    else if (en === "u8" || en === "u16") this.emit(0xFB, 0x0D, ...uleb(aIdx)); // array.get_u
    else                                  this.emit(0xFB, 0x0B, ...uleb(aIdx)); // array.get
    // Non-nullable ref elements stored as nullable in wasm; unwrap to non-null
    if (elem.kind === "struct" || elem.kind === "array" || elem.kind === "funcref") {
      this.emit(0xD4); // ref.as_non_null
    }
  }

  /** Emit call arguments with the callee's declared parameter types as
   *  expected types, so a bare `null` gets the parameter's heap type (not
   *  anyref) and literals get the parameter's width/boxing. Non-literal
   *  arguments ignore the expected type. */
  private emitArgs(args: Expr[], params: (WacType | undefined)[], env: TypeEnv): void {
    for (let i = 0; i < args.length; i++) {
      this.emitExpr(args[i], env, params[i]);
    }
  }

  /**
   * The tag a variant's constructor stores, or null if the type is not a variant.
   *
   * Looked up from the resolver's enum table by struct type index, since the emitter
   * has no file scope to ask.
   */
  /** The variant a type index denotes, or null when it is not a variant's. */
  private variantByTypeIndex(typeIndex: number) {
    for (const e of this.ctx.result.enums) {
      for (const v of e.variants) {
        if (v.entry.typeIndex === typeIndex) return v;
      }
    }
    return null;
  }

  private variantTagOf(typeIndex: number): number | null {
    for (const e of this.ctx.result.enums) {
      for (const v of e.variants) {
        if (v.entry.typeIndex === typeIndex) return v.tag;
      }
    }
    return null;
  }

  private emitCall(
    e: { kind: "call"; callee: Expr; args: Expr[]; variantTypeIndex?: number },
    env: TypeEnv,
  ): void {
    // Variant construction: Shape.Circle(args). The tag comes first because it is the
    // base struct's only field, so every variant shares that layout prefix.
    //
    // Which variant is the type checker's answer, not a name lookup here. Searching
    // `result.enums` by name was wrong as soon as two files declared enums with the
    // same name: the search found the first, its variant list did not contain this
    // name, and the whole branch was skipped — so the value silently emitted nothing
    // and the surrounding `array.set` failed wasm validation two arguments short.
    if (e.variantTypeIndex !== undefined) {
      const vEntry = this.variantByTypeIndex(e.variantTypeIndex);
      if (vEntry) {
        const tIdx = vEntry.entry.typeIndex;
        this.emit(0x41, ...sleb(vEntry.tag));
        const fields = this.ctx.structFields.get(`@${tIdx}`) ?? [];
        // Skip the tag, which was just pushed; the rest are the payload in order.
        const payload = fields.filter(f => f.name !== ENUM_TAG_FIELD);
        this.emitArgs(e.args, payload.map(f => f.type), env);
        this.emit(0xFB, 0x00, ...uleb(tIdx));   // struct.new
        return;
      }
    }

    // Method call: base.method(args)
    if (e.callee.kind === "field") {
      const fe = e.callee as { kind: "field"; expr: Expr; name: string };
      const baseT = typeOfExpr(fe.expr, env, this.ctx);
      // Built-in len() — works on arrays and strings, but NOT on struct methods named "len"
      if (fe.name === "len") {
        const elemType = baseT.kind === "array" ? baseT.elem
                       : baseT.kind === "nullable" && baseT.inner.kind === "array" ? baseT.inner.elem
                       : null;
        const isStr = baseT.kind === "prim" && baseT.name === "string";
        const aIdx2 = elemType ? (this.ctx.arrTypeIdx.get(typeKey(elemType)) ?? -1)
                    : isStr ? this.ctx.stringTypeIdx : -1;
        if (aIdx2 >= 0) {
          this.emitExpr(fe.expr, env);
          this.emit(0xFB, 0x0F); // array.len (no immediate)
          return;
        }
        // Fall through to method dispatch if base is a struct with a len() method
      }

      // Bulk array operations — one instruction each, where the language previously
      // offered only the element loop [issue 0056].
      if (fe.name === "copyFrom" || fe.name === "fill") {
        const dstElem = baseT.kind === "array" ? baseT.elem
                      : baseT.kind === "nullable" && baseT.inner.kind === "array" ? baseT.inner.elem
                      : null;
        const dstIdx = dstElem ? (this.ctx.arrTypeIdx.get(typeKey(dstElem)) ?? -1) : -1;
        if (dstElem && dstIdx >= 0) {
          if (fe.name === "copyFrom") {
            // array.copy takes (dst, dstOffset, src, srcOffset, len) with the destination
            // type index first. The wac argument order is the issue's: the receiver is the
            // destination, so `src` and its start come before the destination's start.
            const srcT = typeOfExpr(e.args[0], env, this.ctx);
            const srcElem = srcT.kind === "array" ? srcT.elem
                          : srcT.kind === "nullable" && srcT.inner.kind === "array" ? srcT.inner.elem
                          : dstElem;
            const srcIdx = this.ctx.arrTypeIdx.get(typeKey(srcElem)) ?? dstIdx;
            this.emitExpr(fe.expr, env);      // dst
            this.emitExpr(e.args[2], env);    // dstStart
            this.emitExpr(e.args[0], env);    // src
            this.emitExpr(e.args[1], env);    // srcStart
            this.emitExpr(e.args[3], env);    // count
            this.emit(0xFB, 0x11, ...uleb(dstIdx), ...uleb(srcIdx)); // array.copy
            return;
          }
          // array.fill takes (array, offset, value, len).
          this.emitExpr(fe.expr, env);        // array
          this.emitExpr(e.args[1], env);      // start
          this.emitExpr(e.args[0], env, dstElem); // value
          this.emitExpr(e.args[2], env);      // count
          this.emit(0xFB, 0x10, ...uleb(dstIdx)); // array.fill
          return;
        }
        // Not an array: fall through, in case a struct has a method of that name.
      }

      // String method calls
      if (baseT.kind === "prim" && baseT.name === "string") {
        if (fe.name === "slice") {
          this.emitExpr(fe.expr, env); // push string
          for (const arg of e.args) this.emitExpr(arg, env);
          this.emit(0x10, ...uleb(this.ctx.helperIdx.get("__str_slice")!)); // call __str_slice
          return;
        }
        if (fe.name === "indexOf") {
          this.emitExpr(fe.expr, env); // push string
          for (const arg of e.args) this.emitExpr(arg, env);
          this.emit(0x10, ...uleb(this.ctx.helperIdx.get("__str_indexof")!)); // call __str_indexof
          return;
        }
        if (fe.name === "toBytes") {
          this.emitExpr(fe.expr, env); // push string
          this.emit(0x10, ...uleb(this.ctx.helperIdx.get("__str_to_bytes")!));
          return;
        }
      }

      const sName = structName(baseT);
      if (sName) {
        // Instance method call: emit receiver, then args (walk inheritance chain)
        const meth = lookupMethodInChain(sName, fe.name, this.ctx, structResolvedIndex(baseT));
        if (meth) {
          this.emitExpr(fe.expr, env); // push receiver
          this.emitArgs(e.args, funcParams(meth).map(p => p.type), env);
          // **The entry's own index, not its name.** A method's mangled name is `Struct$method`, and a
          // struct name is only unique within its file — so two packages with a `Writer` both mangle to
          // `Writer$create` and `ctx.funcIdx` answers with whichever registered first. The entry here
          // came from the *right* struct, so it already knows which function it is (wac 0076).
          this.emit(0x10, ...uleb(meth.funcIndex + this.ctx.funcBase)); // call
          return;
        }
      }

      // Static method call: TypeName.method(args)
      if (fe.expr.kind === "ident") {
        const typeName = (fe.expr as { name: string }).name;
        if ((typeName === "f64" || typeName === "f32")
            && (fe.name === "toBits" || fe.name === "fromBits")) {
          // Single reinterpret opcodes, one pair per width:
          //   i64.reinterpret_f64 0xBD / f64.reinterpret_i64 0xBF
          //   i32.reinterpret_f32 0xBC / f32.reinterpret_i32 0xBE
          for (const arg of e.args) this.emitExpr(arg, env);
          if (typeName === "f64") {
            this.emit(fe.name === "toBits" ? 0xBD : 0xBF);
          } else {
            this.emit(fe.name === "toBits" ? 0xBC : 0xBE);
          }
          return;
        }
        if (typeName === "string" && (fe.name === "fromCodepoint" || fe.name === "fromBytes")) {
          const helper = fe.name === "fromCodepoint" ? "__str_from_cp" : "__str_from_bytes";
          for (const arg of e.args) this.emitExpr(arg, env);
          this.emit(0x10, ...uleb(this.ctx.helperIdx.get(helper)!));
          return;
        }
        if (structIdxInFile(typeName, this.ctx) !== undefined) {
          const structEntry2 = resolveStructEntry(typeName, this.ctx);
          const meth2 = structEntry2?.methods.get(fe.name);
          if (meth2) {
            // Counter.inc(receiver, ...) — the receiver is the `this` argument
            const declared = funcParams(meth2).map(p => p.type);
            const hasThis = meth2.origin.kind === "method" && meth2.origin.decl.hasThis;
            const thisT: WacType = {
              kind: "struct", name: structEntry2!.name,
              resolvedTypeIndex: structEntry2!.typeIndex, line: 0, col: 0,
            };
            this.emitArgs(e.args, hasThis ? [thisT, ...declared] : declared, env);
            // The entry's own index rather than its mangled name — see the instance call above.
            this.emit(0x10, ...uleb(meth2.funcIndex + this.ctx.funcBase));
            return;
          }
        }
      }
    }

    // There is deliberately no `e.callee.kind === "ident"` branch here.
    //
    // `foo(1)` never arrives as a call: the parser calls every `ident(...)` a
    // *construction*, because it cannot tell a struct name from a function name without
    // a symbol table. So a direct call to a plain function is emitted by
    // `emitConstruct`, in the branch where the name resolves to no struct type.
    //
    // A branch for it did exist and was unreachable, which cost real time once: while
    // fixing bare-name resolution in 123ac4c the fix was applied here first, changed
    // nothing, and only then was the live path found. Anyone changing call emission will
    // look here, so this comment is the point of the change rather than an aside.
    // `typeOfExpr`'s "construct" case is arranged the same way, for the same reason.

    // Funcref indirect call: f(args)
    const calleeT = typeOfExpr(e.callee, env, this.ctx);
    if (calleeT.kind === "funcref") {
      this.emitArgs(e.args, calleeT.params, env);
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
      const tIdx  = e.ctype.resolvedTypeIndex ?? structIdxInFile(sName, this.ctx);
      if (tIdx === undefined) {
        // The parser calls any `ident(...)` a construction, so an ordinary call
        // to a plain function arrives here — this is where *every* direct call is
        // emitted, not a fallback. `emitCall` handles only the shapes the parser does
        // produce as calls: a method call, an indirect funcref call, and variant
        // construction.
        //
        // **A local or parameter is looked at before any function**, which is the
        // ordinary shadowing rule and was not what this did. The funcref case sat below
        // the global lookup, so `pump(fn[bool(u8[])] write)` calling `write(bytes)`
        // reached a *different module's* top-level `write` — one this file does not
        // import and cannot name. Where the arities differed the module failed to
        // validate, which is how it was found; where they matched it validated and
        // silently called the wrong function, never invoking the callback at all.
        const localT = env.get(sName);
        if (localT?.kind === "funcref") {
          this.emitArgs(e.args, localT.params, env);
          this.emit(0x20, ...uleb(this.localMap.get(sName)!.idx)); // local.get
          const sIdx = this.ctx.sigTypeIdx.get(sigKey(localT.params, localT.ret))!;
          this.emit(0x14, ...uleb(sIdx)); // call_ref $type
          return;
        }
        // Otherwise a function, resolved through the calling
        // file's scope: ctx.funcIdx maps bare names globally and first-wins, so
        // two files each declaring a private `helper` would both reach
        // whichever was registered first, with the wrong signature.
        const scopedFn = this.ctx.result.fileScopes.get(this.ctx.currentFile)?.get(sName);
        const fIdx = scopedFn?.kind === "func"
          ? scopedFn.entry.funcIndex + this.ctx.funcBase
          : this.ctx.funcIdx.get(sName);
        if (fIdx !== undefined) {
          // funcs are in funcIndex order, and funcIndex is a position — so the
          // emitted index has to come back down through funcBase to index it.
          const callee = this.ctx.result.funcs[fIdx - this.ctx.funcBase];
          this.emitArgs(e.args, callee ? funcParams(callee).map(p => p.type) : [], env);
          this.emit(0x10, ...uleb(fIdx));
          return;
        }
        // A funcref local is handled above, before the function lookup.
        return;
      };
      const fields = this.ctx.structFields.get(`@${tIdx}`)
        ?? this.ctx.structFields.get(sName) ?? [];

      if (e.args.length === 0 && (!e.named || e.named.length === 0)) {
        // Default construction: use struct.new_default if all fields are directly defaultable,
        // otherwise recursively emit defaults for each field and use struct.new.
        // struct.new_default requires every field's storage type to itself be
        // wasm-defaultable — non-null struct and array refs aren't (only
        // numeric/packed types and nullable refs are), so those need recursion.
        const allDirectlyDefaultable = fields.every(f => isWasmDefaultable(f.type));
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
          this.emitExpr(na.val, env, this.hintFor(f.type, na.val));
        }
      } else {
        // Positional: emit in order, passing field type as hint for null args
        for (let i = 0; i < e.args.length; i++) {
          const ft = i < fields.length ? fields[i].type : undefined;
          this.emitExpr(e.args[i], env, this.hintFor(ft, e.args[i]));
        }
      }
      this.emit(0xFB, 0x00, ...uleb(tIdx)); // struct.new $t
      return;
    }
    // Function call with named args or plain call via construct syntax, through the calling file's
    // scope for the same reason as everywhere else: a bare name is not globally unique.
    if (e.ctype.kind === "prim") {
      const scopedC = this.ctx.result.fileScopes.get(this.ctx.currentFile)?.get(e.ctype.name);
      const fIdx = scopedC?.kind === "func"
        ? scopedC.entry.funcIndex + this.ctx.funcBase
        : this.ctx.funcIdx.get(e.ctype.name);
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
        if (t.name === "i32" || t.name === "bool" || t.name === "i8" || t.name === "i16" ||
            t.name === "u8" || t.name === "u16")
          this.emit(0x41, 0x00); // i32.const 0
        else if (t.name === "i64")
          this.emit(0x42, 0x00); // i64.const 0
        else if (t.name === "f32")
          this.emit(0x43, 0x00, 0x00, 0x00, 0x00); // f32.const 0.0
        else if (t.name === "f64")
          this.emit(0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00); // f64.const 0.0
        else if (t.name === "string")
          // The empty string: a zero-length array of the string type.
          this.emit(0xFB, 0x08, ...uleb(this.ctx.stringTypeIdx), 0x00); // array.new_fixed 0
        break;
      case "nullable": {
        // ref.null with the inner type's heap type
        const hb = heapTypeBytes(t.inner, this.ctx);
        this.emit(0xD0, ...hb); // ref.null $t
        break;
      }
      case "struct": {
        const idx = structTypeIndexOf(t, this.ctx);
        const fields = this.ctx.structFields.get(structLookupKey(t)!) ?? [];
        const allDirectlyDefaultable = fields.every(f => isWasmDefaultable(f.type));
        if (allDirectlyDefaultable) {
          this.emit(0xFB, 0x01, ...uleb(idx)); // struct.new_default $t
        } else {
          for (const f of fields) this.emitDefaultValue(f.type);
          this.emit(0xFB, 0x00, ...uleb(idx)); // struct.new $t
        }
        break;
      }
      case "array": {
        // Non-null array field with no size context: default to an empty
        // (zero-length) array — the element type's own defaultability is
        // irrelevant, since there are no elements to construct.
        const aIdx = this.ctx.arrTypeIdx.get(typeKey(t.elem))!;
        this.emit(0xFB, 0x08, ...uleb(aIdx), ...uleb(0)); // array.new_fixed $t, 0
        break;
      }
      case "funcref":
        // Non-null funcref has no default at all — already rejected at
        // typecheck (hasDefault returns false for funcref), so this case
        // should be unreachable in practice.
        break;
    }
  }

  private emitArrNew(
    e: { kind: "arrNew"; elem: WacType; size: Expr | null; fixed: Expr[]; fill?: Expr },
    env: TypeEnv,
  ): void {
    const aIdx = this.ctx.arrTypeIdx.get(typeKey(e.elem))!;
    if (e.fixed.length > 0) {
      for (const item of e.fixed) this.emitExpr(item, env, e.elem);
      this.emit(0xFB, 0x08, ...uleb(aIdx), ...uleb(e.fixed.length)); // array.new_fixed
    } else if (e.size !== null) {
      // `T[n](fill: v)` — one value replicated by array.new, which is the instruction
      // this form exists to reach. Every element is the *same* reference when the
      // element type is a reference type; arrays.md says so, because the alternative is
      // a loop that constructs n copies and the caller asking for one value cannot want
      // that.
      if (e.fill !== undefined) {
        // A packed element is written as an i32 and truncates, exactly as an indexed
        // assignment does.
        const packed = e.elem.kind === "prim" &&
          (e.elem.name === "i8" || e.elem.name === "i16" ||
           e.elem.name === "u8" || e.elem.name === "u16");
        this.emitExpr(e.fill, env, packed ? I32 : e.elem);
        this.emitExpr(e.size, env);
        this.emit(0xFB, 0x06, ...uleb(aIdx)); // array.new $t
        return;
      }
      // Struct element + literal size: initialize each element with default struct
      if (e.elem.kind === "struct" && e.size.kind === "int") {
        const n = parseInt(e.size.value);
        // emitDefaultValue rather than struct.new_default directly: the struct
        // may itself hold a field with no wasm default, such as a string.
        for (let i = 0; i < n; i++) this.emitDefaultValue(e.elem);
        this.emit(0xFB, 0x08, ...uleb(aIdx), ...uleb(n)); // array.new_fixed N
      } else if (isStringPrim(e.elem)) {
        // array.new_default needs a wasm-defaultable element, and a string is a
        // non-null ref. Build the "" value once and let array.new replicate it —
        // every element aliases the same immutable empty string, which is
        // indistinguishable from separate ones.
        this.emitDefaultValue(e.elem);
        this.emitExpr(e.size, env);
        this.emit(0xFB, 0x06, ...uleb(aIdx)); // array.new $t
      } else if (!isWasmDefaultable(e.elem)) {
        // A struct or array element is stored as a *nullable* ref, so
        // array.new_default validates but fills the array with nulls — and
        // every read unwraps with ref.as_non_null, so the first access traps.
        // arrays.md promises a distinct default per element, which rules out
        // array.fill too: one value replicated would alias. So: allocate, then
        // loop and construct each element.
        this.emitExpr(e.size, env);
        this.emit(0xFB, 0x07, ...uleb(aIdx));   // array.new_default $t (nulls)
        this.emitFillLoop(e.elem, aIdx);
      } else {
        this.emitExpr(e.size, env);
        this.emit(0xFB, 0x07, ...uleb(aIdx)); // array.new_default $t
      }
    } else if (isStringPrim(e.elem)) {
      this.emit(0xFB, 0x08, ...uleb(aIdx), 0x00); // array.new_fixed 0 — empty
    } else {
      this.emit(0x41, 0x00, 0xFB, 0x07, ...uleb(aIdx)); // size=0, array.new_default
    }
  }

  // ── Statement emitter ──

  /** Every Block is a scope: emit its statements, then unwind any name
   *  bindings (shadowing) and env entries the block introduced. */
  emitBlock(block: Block, env: TypeEnv): void {
    this.emitScoped(block.stmts, env);
  }

  private emitScoped(stmts: Stmt[], env: TypeEnv): void {
    const savedKeys = new Map(this.nameToKey);
    const savedEnv  = new Map(env);
    for (const s of stmts) this.emitStmt(s, env);
    restoreScope(this.nameToKey, savedKeys);
    restoreScope(env, savedEnv);
  }

  emitStmt(s: Stmt, env: TypeEnv): void {
    switch (s.kind) {
      case "var": {
        const init = s.init;
        const isNull = init.kind === "null";
        // The declared type is pushed down for `null` (which has no type of its own) and for a
        // nullable primitive (whose value has to be boxed on the way in). Not otherwise: a
        // literal's width comes from what the checker resolved, and pushing a type down here
        // once made the two disagree.
        const wantsBox = s.type.kind === "nullable" && needsBoxing(s.type.inner);
        this.emitExpr(init, env, isNull || wantsBox ? s.type : undefined);
        const varKey = this.keyMap.get(s) ?? s.name;
        this.emit(0x21, ...uleb(this.localMap.get(varKey)!.idx)); // local.set
        this.nameToKey.set(s.name, varKey); // update scope: name → unique key
        env.set(s.name, s.type);
        break;
      }
      case "block":
        this.emitBlock(s.block, env);
        break;
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
      case "match":   this.emitMatch(s, env); break;
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
      case "trap": {
        // The message goes into a global *before* the trap, because after it there is
        // no code left to run — the host reads it once the trap has unwound.
        if (s.value && this.ctx.trapGlobalIdx >= 0) {
          this.emitExpr(s.value, env, { kind: "prim", name: "string", line: 0, col: 0 });
          this.emit(0x24, ...uleb(this.ctx.trapGlobalIdx)); // global.set
        }
        this.emit(0x00); // unreachable
        break;
      }
      case "expr": {
        const t = typeOfExpr(s.expr, env, this.ctx);
        this.emitExpr(s.expr, env);
        const isVoid = t.kind === "prim" && t.name === "void";
        if (!isVoid) this.emit(0x1A); // drop result
        break;
      }
    }
  }

  /** ++/-- as an expression: postfix leaves the old value on the stack,
   *  prefix the new one. */
  private emitIncrExpr(
    e: { kind: "incr-expr"; op: "++" | "--"; prefix: boolean; lval: Lvalue },
    env: TypeEnv,
  ): void {
    const t = lvalType(e.lval, env, this.ctx);
    const is64 = t.kind === "prim" && t.name === "i64";
    const one  = is64 ? [0x42, 0x01] : [0x41, 0x01];                       // const 1
    const add  = is64 ? (e.op === "++" ? 0x7C : 0x7D) : (e.op === "++" ? 0x6A : 0x6B);
    const undo = is64 ? (e.op === "++" ? 0x7D : 0x7C) : (e.op === "++" ? 0x6B : 0x6A);
    if (e.lval.kind === "lv-ident") {
      const key = this.nameToKey.get(e.lval.name) ?? e.lval.name;
      const idx = this.localMap.get(key)!.idx;
      if (e.prefix) {
        this.emit(0x20, ...uleb(idx));       // local.get
        this.emit(...one, add);              // ±1
        this.emit(0x22, ...uleb(idx));       // local.tee — leaves the new value
      } else {
        this.emit(0x20, ...uleb(idx));       // old value (stays on stack)
        this.emit(0x20, ...uleb(idx));
        this.emit(...one, add);              // ±1
        this.emit(0x21, ...uleb(idx));       // local.set
      }
      return;
    }
    // Field / array-element operand: statement-style read-modify-write, then
    // re-read for the value. NOTE: this re-evaluates the base/index
    // expressions — a side-effecting index inside an incr-expression operand
    // runs twice.
    this.emitFieldIncrAssign(e.lval, e.op === "++" ? "+=" : "-=", env, t);
    this.emitLvalGet(e.lval, env);           // new value
    if (!e.prefix) {
      this.emit(...one, undo);               // postfix: old = new ∓ 1
      // …and a packed element does not survive that arithmetic. The value in the array was
      // truncated to 8 or 16 bits when it was stored, so `255 + 1 - 1` is 255 only if the
      // narrowing happens again: without it `u8 255` postfix-incremented answered -1, and
      // `i8 127` answered -129 — values the array cannot hold [issue 0084].
      this.emitPackedNarrow(e.lval, env);
    }
  }

  /** Narrow a computed i32 back to what a packed element would hold, as a store-and-read would. */
  private emitPackedNarrow(lv: Lvalue, env: TypeEnv): void {
    if (lv.kind !== "lv-index") return;
    const bt = lvalType(lv.base, env, this.ctx);
    const elem = bt.kind === "array" ? bt.elem
               : bt.kind === "nullable" && bt.inner.kind === "array" ? bt.inner.elem
               : I32;
    const en = elem.kind === "prim" ? elem.name : "";
    if (en === "u8")       this.emit(0x41, 0xFF, 0x01, 0x71);  // i32.const 255;   i32.and
    else if (en === "u16") this.emit(0x41, 0xFF, 0xFF, 0x03, 0x71); // i32.const 65535; i32.and
    else if (en === "i8")  this.emit(0xC0);                    // i32.extend8_s
    else if (en === "i16") this.emit(0xC1);                    // i32.extend16_s
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
        const lt = lvalType(lval, env, this.ctx);
        this.emitCompoundRhs(rhs, env, lt, op.slice(0,-1));
        this.emitBinOpCode(op.slice(0,-1), lt);
      } else {
        this.emitExpr(rhs, env, this.hintFor(lvalType(lval, env, this.ctx), rhs));
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
    const tIdx = structResolvedIndex(bt) ?? this.ctx.structTypeIdx.get(sn)!;
    const fi = this.ctx.structFields.get(structLookupKey(bt)!)!.find(f => f.name === lval.field)!;
    const ft = fi.type;

    if (op !== "=") {
      // compound: need base twice. For simple ident bases, emit twice.
      this.emitLvalGet(lval.base, env); // base ref for struct.set (stays on stack)
      this.emitLvalGet(lval.base, env); // base ref for struct.get
      this.emit(0xFB, 0x02, ...uleb(tIdx), ...uleb(fi.absIdx)); // struct.get (read old)
      this.emitCompoundRhs(rhs, env, ft, op.slice(0,-1));
      this.emitBinOpCode(op.slice(0,-1), ft);
    } else {
      this.emitLvalGet(lval.base, env); // base ref for struct.set
      this.emitExpr(rhs, env, this.hintFor(ft, rhs));
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
      this.emitArrayGet(aIdx, elem); // read old, extended as its type says
      this.emitCompoundRhs(rhs, env, elem, op.slice(0,-1));
      this.emitBinOpCode(op.slice(0,-1), elem);
    } else {
      this.emitLvalGet(lval.base, env); // arr ref
      this.emitExpr(lval.idx, env);     // idx
      this.emitExpr(rhs, env, this.hintFor(elem, rhs));
    }
    this.emit(0xFB, 0x0E, ...uleb(aIdx)); // array.set
  }

  /** Emit the rhs of a compound assignment, converting a shift amount as the binary
   *  form does — `u64 <<= i32` is legal, same as `u64 << i32` [see operators.md]. */
  private emitCompoundRhs(rhs: Expr, env: TypeEnv, target: WacType, op: string): void {
    this.emitExpr(rhs, env);
    if (op !== "<<" && op !== ">>" && op !== ">>>") return;
    this.coerceShiftAmount(target, typeOfExpr(rhs, env, this.ctx));
  }

  /**
   * Convert an already-emitted shift amount to the width the operand needs.
   *
   * A shift amount is not like the other operands. Everywhere else, mixing widths is a
   * real question about what a value means; a count is never the thing being widened and
   * has no lossy case, because wasm masks it to the operand width regardless. So any
   * integer count is accepted and adjusted here rather than demanding a cast that could
   * not mean anything else.
   *
   * `i64.extend_i32_s` rather than `_u` only because it is what this emitted before: for
   * a count the two are indistinguishable, since 2^32 and 2^64 are both multiples of 64
   * and the mask therefore sees the same value either way.
   */
  private coerceShiftAmount(operand: WacType, amount: WacType): void {
    const wide = (t: WacType) =>
      t.kind === "prim" && (t.name === "i64" || t.name === "u64");
    const narrow = (t: WacType) =>
      t.kind === "prim" && (t.name === "i32" || t.name === "u32" ||
        t.name === "u8" || t.name === "u16");
    if (wide(operand) && narrow(amount)) this.emit(0xAC);        // i64.extend_i32_s
    else if (narrow(operand) && wide(amount)) this.emit(0xA7);   // i32.wrap_i64
  }


  /** Emit the operation opcode for compound assignment (op without '='). */
  private emitBinOpCode(op: string, t: WacType): void {
    const p = t.kind === "prim" ? t.name : "i32";

    // `s += t` on strings is concatenation, which is a helper call rather than an
    // opcode [see strings.md]. Without this, "string" falls through the numeric
    // mapping below to the f64 column and emits f64.add on two string refs —
    // invalid wasm.
    if (p === "string") {
      if (op === "+") {
        this.emit(0x10, ...uleb(this.ctx.helperIdx.get("__str_concat")!));
      }
      return;
    }

    // Mirrors emitBinary's table — see there for why unsigned needs its own
    // columns rather than sharing the signed ones.
    const k = p === "bool" || p === "i8" || p === "i16" || p === "u8" || p === "u16" ? "i32"
            : p === "i32" ? "i32" : p === "i64" ? "i64"
            : p === "u32" ? "u32" : p === "u64" ? "u64"
            : p === "f32" ? "f32" : "f64";
    type KT = "i32"|"i64"|"u32"|"u64"|"f32"|"f64";
    const ops: Record<string, Record<KT, number[]>> = {
      "+":  { i32:[0x6A], i64:[0x7C], u32:[0x6A], u64:[0x7C], f32:[0x92], f64:[0xA0] },
      "-":  { i32:[0x6B], i64:[0x7D], u32:[0x6B], u64:[0x7D], f32:[0x93], f64:[0xA1] },
      "*":  { i32:[0x6C], i64:[0x7E], u32:[0x6C], u64:[0x7E], f32:[0x94], f64:[0xA2] },
      "/":  { i32:[0x6D], i64:[0x7F], u32:[0x6E], u64:[0x80], f32:[0x95], f64:[0xA3] },
      // See emitBinary: float % is a helper call, not an opcode.
      "%":  { i32:[0x6F], i64:[0x81], u32:[0x70], u64:[0x82],
              f32:[0x10, ...uleb(this.ctx.helperIdx.get("__fmodf")!)],
              f64:[0x10, ...uleb(this.ctx.helperIdx.get("__fmod")!)] },
      "&":  { i32:[0x71], i64:[0x83], u32:[0x71], u64:[0x83], f32:[],     f64:[]     },
      "|":  { i32:[0x72], i64:[0x84], u32:[0x72], u64:[0x84], f32:[],     f64:[]     },
      "^":  { i32:[0x73], i64:[0x85], u32:[0x73], u64:[0x85], f32:[],     f64:[]     },
      "<<": { i32:[0x74], i64:[0x86], u32:[0x74], u64:[0x86], f32:[],     f64:[]     },
      ">>": { i32:[0x75], i64:[0x87], u32:[0x76], u64:[0x88], f32:[],     f64:[]     },
      ">>>":{ i32:[0x76], i64:[0x88], u32:[0x76], u64:[0x88], f32:[],     f64:[]     },
    };
    this.emit(...(ops[op]?.[k as KT] ?? []));
  }

  private emitFieldIncrAssign(lval: Lvalue, compOp: string, env: TypeEnv, t: WacType): void {
    // For a non-ident lval like arr[i]++ or obj.x++: a compound assignment of 1.
    //
    // `resolved` is what the type checker writes on a literal that took its type from context,
    // and this literal has never been near the checker — it is made here. Leaving it off left
    // the width to a default of i32, so `p.x++` on an `i64` field emitted `i64.add` over an
    // `i32.const` and the module did not validate [issue 0082]. The same `p.x += 1` written out
    // works precisely because the checker resolved *its* literal.
    const rhs: Expr = { kind: "int", value: "1", line: 0, col: 0, resolved: t };
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

  /**
   * Read an array element, extending a packed one the way its type says.
   *
   * There is one right answer per element type and three places that need it — reading an
   * index expression, reading the old value of a compound assignment, and reading back what
   * `++` produced — and they disagreed. `array.get` on a packed array is not valid wasm at all
   * [issue 0084], and `array.get_u` on an `i8[]` is valid and wrong: `a[0] /= 2` on -8 read 248
   * and stored 124. Add/sub hid it, because they wrap the same either way.
   */
  private emitArrayGet(aIdx: number, elem: WacType): void {
    const en = elem.kind === "prim" ? elem.name : "";
    if (en === "i8" || en === "i16")      this.emit(0xFB, 0x0C, ...uleb(aIdx)); // array.get_s
    else if (en === "u8" || en === "u16") this.emit(0xFB, 0x0D, ...uleb(aIdx)); // array.get_u
    else                                  this.emit(0xFB, 0x0B, ...uleb(aIdx)); // array.get
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
        const tIdx = structResolvedIndex(bt) ?? this.ctx.structTypeIdx.get(sn)!;
        const fi   = this.ctx.structFields.get(structLookupKey(bt)!)!.find(f => f.name === lv.field)!;
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
        this.emitArrayGet(aIdx, elem);
        break;
      }
      case "lv-unwrap": {
        this.emitLvalGet(lv.base, env);
        this.emit(0xD4); // ref.as_non_null
        break;
      }
    }
  }

  private emitIf(s: Stmt & { kind: "if" }, env: TypeEnv): void {
    this.emitExpr(s.cond, env);
    this.emit(0x04, 0x40); // if void
    this.labelDepth++;
    this.emitCovPoint("then", s.then.line, s.then.col);

    // `if (x is T)` narrows `x` inside the then-block. The condition has already tested the
    // type, so the cast cannot fail — it is the same unchecked downcast a `match` arm emits,
    // and for the same reason: the test that would justify it has just been performed.
    const narrowKey = s.narrowName !== undefined ? this.narrowKeys.get(s) : undefined;
    const savedKeys = narrowKey !== undefined ? new Map(this.nameToKey) : null;
    const savedEnv = narrowKey !== undefined ? new Map(env) : null;
    if (narrowKey !== undefined && s.narrowName !== undefined) {
      const local = this.localMap.get(narrowKey);
      const source = this.localMap.get(this.nameToKey.get(s.narrowName) ?? s.narrowName);
      if (local && source) {
        this.emit(0x20, ...uleb(source.idx));                       // local.get x
        this.emit(0xFB, 0x16, ...sleb(s.narrowTypeIndex!));         // ref.cast (ref T)
        this.emit(0x21, ...uleb(local.idx));                        // local.set shadow
        this.nameToKey.set(s.narrowName, narrowKey);
        env.set(s.narrowName, local.type);
      }
    }

    this.emitBlock(s.then, env);

    if (savedKeys && savedEnv) {
      restoreScope(this.nameToKey, savedKeys);
      restoreScope(env, savedEnv);
    }

    if (s.els) { this.emit(0x05); this.emitElse(s.els, env); }
    this.emit(0x0B); // end
    this.labelDepth--;
  }

  private emitElse(els: ElseBranch, env: TypeEnv): void {
    if (!els) return;
    if (els.kind === "else-block") {
      this.emitCovPoint("else", els.block.line, els.block.col);
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
    this.emitCovPoint("loop", s.body.line, s.body.col);
    this.emitBlock(s.body, env);
    this.loopStack.pop();

    this.emit(0x0C, ...uleb(this.brDepth(contLevel))); // br $cont (loop)
    this.emit(0x0B); this.labelDepth--; // end loop
    this.emit(0x0B); this.labelDepth--; // end block
  }

  private emitDoWhile(s: Stmt & { kind: "dowhile" }, env: TypeEnv): void {
    // block $brk { loop $again { block $cont { body } cond; br_if $again } }
    //
    // The body is wrapped so `continue` lands *before* the condition, which is the same shape
    // `emitFor` uses to land before the update. Without the wrapper, `continue` branched to the
    // loop label and restarted the body with the condition untested: the C-family answer for
    //
    //   i32 i = 0; do { i++; if (i % 2 == 0) { continue; } sum += i; } while (i < 10);
    //
    // is 25 and this gave 36, having run an eleventh iteration. `while` and `for` were both
    // right, which is why it went unnoticed — a do-while is the one loop whose test is at the
    // bottom, so it is the one where the continue target and the loop label differ.
    this.emit(0x02, 0x40); this.labelDepth++;
    const brkLevel = this.labelDepth - 1;
    this.emit(0x03, 0x40); this.labelDepth++;
    const againLevel = this.labelDepth - 1;
    this.emit(0x02, 0x40); this.labelDepth++;
    const contLevel = this.labelDepth - 1;

    this.loopStack.push({ breakTarget: brkLevel, continueTarget: contLevel });
    this.emitCovPoint("loop", s.body.line, s.body.col);
    this.emitBlock(s.body, env);
    this.loopStack.pop();
    this.emit(0x0B); this.labelDepth--;              // end $cont

    this.emitExpr(s.cond, env);
    this.emit(0x0D, ...uleb(this.brDepth(againLevel))); // br_if $again
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
    this.emitCovPoint("loop", s.body.line, s.body.col);
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
    // Restore outer scope after for-loop (init var is scoped to the loop)
    restoreScope(this.nameToKey, savedKeys);
    restoreScope(env, savedEnv);
  }

  /**
   * `match` — dispatch on the tag, then bind and run the selected arm.
   *
   * The subject is evaluated exactly once, into the anyref scratch, because it may
   * have side effects and every arm test needs it again. The tag is read through a
   * cast to the enum's base, which every variant extends.
   *
   * Dispatch is an if-else chain over the tag rather than a `br_table`, matching
   * `emitSwitch`. A table would be one jump instead of up to one comparison per
   * variant; the tag makes that change possible later without touching anything
   * else, which is most of why it exists.
   *
   * Inside an arm the cast back to the variant is unchecked in the sense that it
   * cannot fail — the tag already established which variant this is — so the only
   * cost of narrowing is the cast instruction itself.
   */
  /**
   * Bring an arm's bindings into scope: the narrowed shadow of the subject, and the payload.
   *
   * Shared by the statement and expression forms of `match`. Both read out of
   * `this.tempAnyLocal`, which the caller has already loaded with the subject — evaluated
   * once, whichever form it is.
   */
  private bindArm(arm: MatchArm, subject: Expr, env: TypeEnv): void {
    // The narrowed shadow of the subject, if there was a name to shadow.
    const armKey = this.armKeys.get(arm);
    if (armKey !== undefined && subject.kind === "ident") {
      const local = this.localMap.get(armKey);
      if (local) {
        this.emit(0x20, ...uleb(this.tempAnyLocal));
        this.emit(0xFB, 0x16, ...sleb(arm.variantTypeIndex!));     // ref.cast (ref variant)
        this.emit(0x21, ...uleb(local.idx));
        this.nameToKey.set(subject.name, armKey);
        env.set(subject.name, local.type);
      }
    }

    // Payload bindings, read off the variant's own fields. Bindings are positional, so the
    // field is the i-th *payload* field — looking it up by the binding's name would never
    // match, since `case Circle(r)` binds `r` to a field called `radius`.
    const bkeys = this.bindingKeys.get(arm) ?? [];
    const payloadFields = (this.ctx.structFields.get(`@${arm.variantTypeIndex}`) ?? [])
      .filter(f => f.name !== ENUM_TAG_FIELD);
    for (let i = 0; i < bkeys.length; i++) {
      const key = bkeys[i];
      if (key === "") continue;                                    // `_` binds nothing
      const local = this.localMap.get(key);
      const field = payloadFields[i];
      if (!local || !field) continue;
      this.emit(0x20, ...uleb(this.tempAnyLocal));
      this.emit(0xFB, 0x16, ...sleb(arm.variantTypeIndex!));
      this.emit(0xFB, 0x02, ...uleb(arm.variantTypeIndex!), ...uleb(field.absIdx));
      this.emit(0x21, ...uleb(local.idx));
      this.nameToKey.set(arm.bindings[i], key);
      env.set(arm.bindings[i], local.type);
    }
  }

  private emitMatch(s: Stmt & { kind: "match" }, env: TypeEnv): void {
    const baseIdx = s.enumBaseTypeIndex;
    if (baseIdx === undefined) { this.emit(0x00); return; }   // unchecked match

    // Evaluate the subject once. anyref holds any struct reference, so this needs no
    // per-enum scratch local.
    this.emitExpr(s.subject, env);
    this.emit(0x21, ...uleb(this.tempAnyLocal));

    // tag = (subject as base).#tag
    // structFields is keyed by "@typeIndex" precisely so a same-named struct in
    // another file cannot be picked up here.
    const baseFields = this.ctx.structFields.get(`@${baseIdx}`) ?? [];
    const tagField = baseFields.find(f => f.name === ENUM_TAG_FIELD);
    // absIdx, not the array position: struct.get takes the wasm field index, and the
    // two only coincide when nothing is inherited.
    const tagIdx = tagField ? tagField.absIdx : 0;
    this.emit(0x20, ...uleb(this.tempAnyLocal));
    this.emit(0xFB, 0x16, ...sleb(baseIdx));                        // ref.cast (ref base)
    this.emit(0xFB, 0x02, ...uleb(baseIdx), ...uleb(tagIdx));
    this.emit(0x21, ...uleb(this.tempI32Local));

    const variantArms = s.arms.filter(a => a.variant !== null);
    const elseArm = s.arms.find(a => a.variant === null);

    // One `if` per variant arm, nested in the else branches, so the arms are tried in
    // source order and the else arm — or nothing — sits at the bottom.
    let opened = 0;
    for (const arm of variantArms) {
      this.emit(0x20, ...uleb(this.tempI32Local));
      this.emit(0x41, ...sleb(arm.tag ?? 0));
      this.emit(0x46);                                             // i32.eq
      this.emit(0x04, 0x40);                                       // if (void)
      this.labelDepth++;
      opened++;

      // An arm is a branch, so it needs a counter. Without one, branch coverage
      // reported a `match` as fully covered no matter how many arms never ran — the
      // whole statement had only its function's `entry` point, while a `switch` of the
      // same shape got one per case. Silent under-reporting in a tool whose only job is
      // to tell you what has not been exercised.
      this.emitCovPoint("case", arm.line, arm.col);

      const savedKeys = new Map(this.nameToKey);
      const savedEnv = new Map(env);
      this.bindArm(arm, s.subject, env);

      for (const st of arm.body) this.emitStmt(st, env);

      restoreScope(this.nameToKey, savedKeys);
      restoreScope(env, savedEnv);

      this.emit(0x05);                                             // else
    }

    if (elseArm) {
      // The `else` arm is a branch too, matching `switch`'s `default`.
      this.emitCovPoint("case", elseArm.line, elseArm.col);
      this.emitScoped(elseArm.body, env);
    }

    // Close every `if` opened above.
    for (let i = 0; i < opened; i++) {
      this.emit(0x0B);
      this.labelDepth--;
    }
  }

  /**
   * `match` as an expression: the same dispatch as `emitMatch`, but every arm leaves a
   * value and the blocks carry a result type.
   *
   * The two are not merged because the shapes genuinely differ — a statement's arms emit
   * into a void block and an expression's must each produce exactly one value of the
   * result type — and a merged version would be a parameter-driven fork at every step.
   * What they *do* share is the checker's arm analysis [see checkMatchArms], which is where
   * the subtle rules live.
   */
  private emitMatchExpr(e: Expr & { kind: "matchExpr" }, env: TypeEnv): void {
    const baseIdx = e.enumBaseTypeIndex;
    const resT = e.resultType;
    if (baseIdx === undefined || resT === undefined) { this.emit(0x00); return; }

    // Subject once into the scratch local, as the statement form does.
    this.emitExpr(e.subject, env);
    this.emit(0x21, ...uleb(this.tempAnyLocal));

    const baseFields = this.ctx.structFields.get(`@${baseIdx}`) ?? [];
    const tagField = baseFields.find(f => f.name === ENUM_TAG_FIELD);
    this.emit(0x20, ...uleb(this.tempAnyLocal));
    this.emit(0xFB, 0x16, ...sleb(baseIdx));                      // ref.cast (ref base)
    this.emit(0xFB, 0x02, ...uleb(baseIdx), ...uleb(tagField?.absIdx ?? 0)); // struct.get
    this.emit(0x21, ...uleb(this.tempI32Local));

    const variantArms = e.arms.filter(a => a.variant !== null);
    const elseArm = e.arms.find(a => a.variant === null);

    let opened = 0;
    for (const arm of variantArms) {
      this.emit(0x20, ...uleb(this.tempI32Local));
      this.emit(0x41, ...sleb(arm.tag ?? 0));
      this.emit(0x46);                                            // i32.eq
      this.emit(0x04, ...this.blockType(resT));                   // if (result T)
      this.labelDepth++;
      opened++;

      // Arms are branches, so they are counted, exactly as the statement form's are.
      this.emitCovPoint("case", arm.line, arm.col);

      const savedKeys = new Map(this.nameToKey);
      const savedEnv = new Map(env);
      this.bindArm(arm, e.subject, env);
      if (arm.value) this.emitExpr(arm.value, env, resT);
      restoreScope(this.nameToKey, savedKeys);
      restoreScope(env, savedEnv);

      this.emit(0x05);                                            // else
    }

    // The innermost else. The arms are total — the checker rejects an expression match that
    // is not — so this is only reached when an `else` arm exists; without one the value is
    // unreachable rather than absent, which keeps the block's type honest.
    if (elseArm) {
      this.emitCovPoint("case", elseArm.line, elseArm.col);
      const savedKeys = new Map(this.nameToKey);
      const savedEnv = new Map(env);
      this.bindArm(elseArm, e.subject, env);
      if (elseArm.value) this.emitExpr(elseArm.value, env, resT);
      restoreScope(this.nameToKey, savedKeys);
      restoreScope(env, savedEnv);
    } else {
      this.emit(0x00);                                            // unreachable
    }

    for (let i = 0; i < opened; i++) {
      this.emit(0x0B);
      this.labelDepth--;
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
      this.emitCovPoint("case", c.line, c.col);
      this.emitScoped(c.body, env);
      // Implicit break after case body (no fall-through in wac)
      this.emit(0x0C, ...uleb(this.brDepth(brkLevel))); // br $brk
      this.emit(0x0B); // end if
      this.labelDepth--;
    }
    if (def) {
      this.emitCovPoint("case", def.line, def.col);
      this.emitScoped(def.body, env);
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
    const thisType: WacType = {
      kind: "struct", name: structName, resolvedTypeIndex: entry.origin.structTypeIndex,
      line: 0, col: 0,
    };
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

  // Collect and map local variables (unique keys for shadowed vars).
  //
  // Parameter names are reserved, so a local that shadows a parameter gets its own
  // slot instead of aliasing the parameter's. Aliasing looked harmless — the name
  // resolves to the same index either way — but it means the parameter reads back as
  // the shadow's value once the shadowing block has ended, which is a silent wrong
  // answer rather than an error.
  const paramNames = new Set([...params.map(p => p.name),
    ...(entry.origin.kind === "method" && entry.origin.decl.hasThis ? ["this"] : [])]);
  const { decls: allLocals, keyMap, armKeys, bindingKeys, narrowKeys } =
    collectLocals(body.stmts, [...paramNames]);
  emitter.keyMap = keyMap;
  emitter.armKeys = armKeys;
  emitter.narrowKeys = narrowKeys;
  emitter.bindingKeys = bindingKeys;
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

  // Allocate scratch locals for checked/saturating casts (i64/i32/f32/f64 —
  // the round-trip checks of `as!` need the source value and the converted
  // value available twice each).
  emitter.tempI64Local = localIdx;
  emitter.tempI32Local = localIdx + 1;
  emitter.tempF32Local = localIdx + 2;
  emitter.tempF64Local = localIdx + 3;
  emitter.tempAnyLocal = localIdx + 4;
  emitter.tempTraceLocal = localIdx + 5;
  // Only when checking, so an ordinary build is byte-identical to one from a compiler
  // without the flag — verified by hashing a compiled artifact across the change.
  if (ctx.checked) {
    emitter.chk32A = localIdx + 6; emitter.chk32B = localIdx + 7; emitter.chk32S = localIdx + 8;
    emitter.chk64A = localIdx + 9; emitter.chk64B = localIdx + 10; emitter.chk64S = localIdx + 11;
  }
  ctx.currentFile = entry.filePath;

  const localsVec: number[] = [];
  localsVec.push(...uleb(groups.length + 6 + (ctx.checked ? 2 : 0)));
  for (const g of groups) {
    localsVec.push(...uleb(g.count));
    localsVec.push(...wasmValType(g.type, ctx));
  }
  localsVec.push(0x01, 0x7E); // 1 × i64 scratch local
  localsVec.push(0x01, 0x7F); // 1 × i32 scratch local
  localsVec.push(0x01, 0x7D); // 1 × f32 scratch local
  localsVec.push(0x01, 0x7C); // 1 × f64 scratch local
  localsVec.push(0x01, 0x6E); // 1 × anyref scratch local
  localsVec.push(0x01, 0x7F); // 1 × i32 trace-cursor scratch
  if (ctx.checked) {
    localsVec.push(0x03, 0x7F); // 3 × i32 scratch — checked arithmetic
    localsVec.push(0x03, 0x7E); // 3 × i64 scratch — checked arithmetic
  }

  // Coverage points are attributed to the file the function was declared in.
  if (ctx.coverage) {
    ctx.coverage.file = entry.filePath;
  }

  // Emit body, preceded by an entry counter so "was this function ever called"
  // is answerable on its own.
  emitter.emitEntryPoint(entry, body);
  // Only exported functions: an internal call clearing the message would wipe one set
  // by an outer frame that is still unwinding.
  if (entry.exportName) emitter.emitTrapClear();
  emitter.emitBlock(body, env);

  // For non-void functions, emit unreachable before the function end so the wasm
  // validator is satisfied when all execution paths end with explicit return/trap.
  const isVoid = retType.kind === "prim" && retType.name === "void";
  return [...localsVec, ...emitter.getBytes(), ...(isVoid ? [] : [0x00]), 0x0B]; // 0x0B = end
}
