// wasmBuildBin — assembles a complete WebAssembly GC binary from a wac program.
//
// Builds the type context (struct/array/funcsig type indices), emits each
// function body via wacEmitFunc, and assembles the wasm sections.
//
// V8/Deno WasmGC encoding (inverted from final spec):
//   0x50 = sub non-final (can be extended)
//   0x4F = sub final
//   Subtype structs must list ALL fields (inherited + own) in their field list.

import {
  type WacType, type FieldDecl, type StructDecl, type FuncDecl,
  type MethodDecl, type Stmt, type Expr, type Block,
} from "./wacParse.ts";
import {
  type ResolveResult, type FuncEntry, type StructEntry,
  funcParams, funcReturnType,
} from "./wacResolve.ts";
import {
  wacEmitFunc, typeKey, sigKey, wasmValType, heapTypeBytes,
  type WasmTypeCtx, type StructFieldInfo, type CoverageCtx,
} from "./wacEmitFunc.ts";

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

function section(id: number, content: number[]): number[] {
  return [id, ...uleb(content.length), ...content];
}

function vec(items: number[][]): number[] {
  return [...uleb(items.length), ...items.flat()];
}

// ── Helper: full parameter types including `this` for methods ─────────────────

function fullParamTypes(f: FuncEntry): WacType[] {
  const declared = funcParams(f).map((p: { type: WacType }) => p.type);
  if (f.origin.kind === "method" && f.origin.decl.hasThis) {
    const thisType: WacType = {
      kind: "struct", name: f.origin.structName, resolvedTypeIndex: f.origin.structTypeIndex,
      line: 0, col: 0,
    } as WacType;
    return [thisType, ...declared];
  }
  return declared;
}

// ── Type section encoding helpers ─────────────────────────────────────────────

/** Wasm packed type byte for i8/i16 array elements. */
function packedType(name: string): number {
  if (name === "i8" || name === "u8")  return 0x78;
  if (name === "i16" || name === "u16") return 0x77;
  return 0x7F; // fallback i32
}

/** Encode a wam field type for a struct field declaration. */
function fieldType(t: WacType, ctx: WasmTypeCtx, mutable: boolean): number[] {
  const mut = mutable ? 0x01 : 0x00;
  return [...wasmValType(t, ctx), mut];
}

/** Collect all array element types used anywhere in the program. */
function collectArrayTypes(result: ResolveResult, programs: Map<string, unknown>): WacType[] {
  const seen = new Set<string>();
  const types: WacType[] = [];

  function addType(t: WacType): void {
    const k = typeKey(t);
    if (seen.has(k)) return;
    seen.add(k);
    types.push(t);
    // Also add element type if nested
    if (t.kind === "array") addType(t.elem);
    if (t.kind === "nullable") {
      if (t.inner.kind === "array") addType(t.inner.elem);
    }
  }

  function scanType(t: WacType): void {
    if (t.kind === "array") { addType(t.elem); scanType(t.elem); }
    else if (t.kind === "nullable") scanType(t.inner);
    else if (t.kind === "funcref") { t.params.forEach(scanType); scanType(t.ret); }
  }

  function scanExpr(e: Expr): void {
    if (e.kind === "arrNew") { scanType(e.elem); scanType({ kind: "array", elem: e.elem, line: 0, col: 0 }); }
    else if (e.kind === "construct" && e.ctype.kind === "array") scanType(e.ctype);
    else if (e.kind === "cast") scanType(e.type);
    if ("args" in e) (e as { args: Expr[] }).args.forEach(scanExpr);
    if ("left" in e) scanExpr((e as { left: Expr }).left);
    if ("right" in e) scanExpr((e as { right: Expr }).right);
    if ("expr" in e) scanExpr((e as { expr: Expr }).expr);
    if ("cond" in e) scanExpr((e as { cond: Expr }).cond);
    if ("then" in e && typeof (e as { then: unknown }).then !== "string") scanExpr((e as { then: Expr }).then);
    if ("else_" in e) scanExpr((e as { else_: Expr }).else_);
    if ("idx" in e) scanExpr((e as { idx: Expr }).idx);
    if ("named" in e && Array.isArray((e as { named: unknown }).named)) {
      for (const n of (e as { named: { name: string; val: Expr }[] }).named) scanExpr(n.val);
    }
  }

  function scanBlock(b: Block): void {
    for (const s of b.stmts) scanStmt(s);
  }

  function scanStmt(s: Stmt): void {
    if (s.kind === "var") { scanType(s.type); scanExpr(s.init); }
    else if (s.kind === "if") {
      scanExpr(s.cond); scanBlock(s.then);
      if (s.els?.kind === "else-if") scanStmt(s.els.stmt);
      else if (s.els?.kind === "else-block") scanBlock(s.els.block);
    }
    else if (s.kind === "while" || s.kind === "dowhile") { scanExpr(s.cond); scanBlock(s.body); }
    else if (s.kind === "for") {
      if (s.init) scanStmt(s.init);
      if (s.cond) scanExpr(s.cond);
      if (s.update) scanStmt(s.update);
      scanBlock(s.body);
    }
    else if (s.kind === "switch") {
      scanExpr(s.expr);
      for (const c of s.cases) { if (c.value !== "default") scanExpr(c.value); c.body.forEach(scanStmt); }
    }
    else if (s.kind === "return" && s.value) scanExpr(s.value);
    else if (s.kind === "assign") scanExpr(s.rhs);
    else if (s.kind === "expr") scanExpr(s.expr);
    else if (s.kind === "block") scanBlock(s.block);
  }

  // Scan all struct fields
  for (const s of result.structs) {
    for (const f of s.structDecl.fields) scanType(f.type);
    for (const m of s.structDecl.methods) {
      for (const p of m.params) scanType(p.type);
      scanType(m.returnType);
      scanBlock(m.body);
    }
  }
  // Scan all function params/returns and bodies
  for (const f of result.funcs) {
    for (const p of funcParams(f)) scanType(p.type);
    scanType(funcReturnType(f));
    if (f.origin.kind === "func") scanBlock(f.origin.decl.body);
    else if (f.origin.kind === "method") scanBlock(f.origin.decl.body);
  }

  return types;
}

/** Collect all unique funcref signatures used in the program. */
function collectFuncSigs(result: ResolveResult): { params: WacType[]; ret: WacType }[] {
  const seen = new Set<string>();
  const sigs: { params: WacType[]; ret: WacType }[] = [];

  function addSig(params: WacType[], ret: WacType): void {
    const k = sigKey(params, ret);
    if (seen.has(k)) return;
    seen.add(k);
    sigs.push({ params, ret });
  }

  // Each function generates a func type entry
  for (const f of result.funcs) {
    addSig(fullParamTypes(f), funcReturnType(f));
  }

  // Also scan for funcref types used in fields/params
  function scanType(t: WacType): void {
    if (t.kind === "funcref") { addSig(t.params, t.ret); }
    else if (t.kind === "array") scanType(t.elem);
    else if (t.kind === "nullable") scanType(t.inner);
  }
  for (const s of result.structs) {
    for (const f of s.structDecl.fields) scanType(f.type);
    for (const m of s.structDecl.methods) {
      for (const p of m.params) scanType(p.type);
      scanType(m.returnType);
      for (const st of m.body.stmts) scanBodyStmt(st);
    }
  }
  for (const f of result.funcs) {
    for (const p of funcParams(f)) scanType(p.type);
    scanType(funcReturnType(f));
    const body = f.origin.kind === "func" ? f.origin.decl.body : f.origin.decl.body;
    for (const st of body.stmts) scanBodyStmt(st);
  }

  function scanBodyStmt(s: Stmt): void {
    if (s.kind === "var") scanType(s.type);
    if (s.kind === "if") {
      s.then.stmts.forEach(scanBodyStmt);
      if (s.els?.kind === "else-if") scanBodyStmt(s.els.stmt);
      else if (s.els?.kind === "else-block") s.els.block.stmts.forEach(scanBodyStmt);
    }
    if (s.kind === "while" || s.kind === "dowhile") s.body.stmts.forEach(scanBodyStmt);
    if (s.kind === "for") {
      if (s.init) scanBodyStmt(s.init);
      s.body.stmts.forEach(scanBodyStmt);
    }
    if (s.kind === "switch") for (const c of s.cases) c.body.forEach(scanBodyStmt);
    if (s.kind === "block") s.block.stmts.forEach(scanBodyStmt);
  }

  return sigs;
}

// ── Build the full type context ───────────────────────────────────────────────

/** Collect all field info (including inherited) for every struct.
 * Keys: struct name AND "@<typeIndex>" (unique key) to handle name collisions. */
function buildStructFields(
  structs: StructEntry[],
): Map<string, StructFieldInfo[]> {
  const fieldMap = new Map<string, StructFieldInfo[]>();
  // Also build by typeIndex key for unambiguous lookup
  const byIdx = new Map<number, StructFieldInfo[]>();

  // Build an ordered list: process base structs before derived
  // (structs are already in topological order from resolver)
  for (const s of structs) {
    // parentEntry was resolved through the declaring file's scope by wacResolve
    const parentFields = s.parentEntry ? (byIdx.get(s.parentEntry.typeIndex) ?? []) : [];
    const ownFields: StructFieldInfo[] = s.structDecl.fields.map((f, i) => ({
      name: f.name,
      type: f.type,
      isConst: f.isConst || s.structDecl.isConst,
      absIdx: parentFields.length + i,
    }));
    const allFields = [...parentFields, ...ownFields];
    fieldMap.set(s.name, allFields);  // by name (may overwrite for same-name structs)
    byIdx.set(s.typeIndex, allFields);  // by typeIndex (always unique)
  }

  // Expose byIdx entries as "@N" keys so alias code can look up by typeIndex
  for (const [idx, fields] of byIdx) fieldMap.set(`@${idx}`, fields);

  return fieldMap;
}

function buildTypeCtx(
  result: ResolveResult,
  programs: Map<string, unknown>,
  coverage: boolean,
): WasmTypeCtx {
  // 1. Struct types: indices assigned by resolver (0-based, in order)
  const structTypeIdx = new Map<string, number>();
  for (const s of result.structs) structTypeIdx.set(s.name, s.typeIndex);
  // Also register aliases (e.g. `import { Point as Point2d }`) so the emitter can find them.
  for (const scope of result.fileScopes.values()) {
    for (const [alias, entry] of scope) {
      if (entry.kind === "struct" && !structTypeIdx.has(alias)) {
        structTypeIdx.set(alias, entry.entry.typeIndex);
      }
    }
  }
  const numStructs = result.structs.length;

  // 2. String type: special immutable i8 array
  const stringTypeIdx = numStructs; // first after structs

  // 3. Array types: one per unique element type
  const arrElements = collectArrayTypes(result, programs);
  // The coverage counters live in an i32[], which the program itself may not use.
  if (coverage && !arrElements.some(t => t.kind === "prim" && t.name === "i32")) {
    arrElements.push({ kind: "prim", name: "i32", line: 0, col: 0 });
  }
  // __str_from_bytes takes a u8[], so that array type has to exist even in a
  // module that never mentions one. Always adding it keeps the helper
  // unconditional — the alternative is a helper list whose length varies, and
  // every function index downstream is derived from that length.
  if (!arrElements.some(t => t.kind === "prim" && t.name === "u8")) {
    arrElements.push({ kind: "prim", name: "u8", line: 0, col: 0 });
  }
  const arrTypeIdx  = new Map<string, number>();
  let nextTypeIdx = numStructs + 1; // after string type
  for (const elem of arrElements) {
    const k = typeKey(elem);
    if (!arrTypeIdx.has(k)) {
      arrTypeIdx.set(k, nextTypeIdx++);
    }
  }

  // 4. Function signature types
  const sigs = collectFuncSigs(result);
  const sigTypeIdx = new Map<string, number>();
  for (const sig of sigs) {
    const k = sigKey(sig.params, sig.ret);
    if (!sigTypeIdx.has(k)) sigTypeIdx.set(k, nextTypeIdx++);
  }

  // 5. Struct fields (including inherited)
  const structFields = buildStructFields(result.structs);
  // Add alias entries for structFields too.
  for (const scope of result.fileScopes.values()) {
    for (const [alias, entry] of scope) {
      if (entry.kind === "struct" && !structFields.has(alias)) {
        // Use "@typeIndex" key for unambiguous lookup (handles same-name structs from different files)
        const fields = structFields.get(`@${entry.entry.typeIndex}`) ?? [];
        structFields.set(alias, fields);
      }
    }
  }

  // 6. Function index map (by mangled name and by short name for same-file calls)
  const funcIdx = new Map<string, number>();
  for (const f of result.funcs) funcIdx.set(f.mangledName, f.funcIndex);
  // Also map by the declared function name so calls using the short name resolve correctly.
  // Mangled names take precedence; short names only added if not already present.
  for (const f of result.funcs) {
    if (f.origin.kind === "func") {
      const shortName = f.origin.decl.name;
      if (!funcIdx.has(shortName)) funcIdx.set(shortName, f.funcIndex);
    }
  }
  // Also add aliases from all file scopes (for renamed imports like `{ foo as fooB }`).
  for (const scope of result.fileScopes.values()) {
    for (const [alias, entry] of scope) {
      if (entry.kind === "func" && !funcIdx.has(alias)) {
        funcIdx.set(alias, entry.entry.funcIndex);
      }
    }
  }

  return {
    structTypeIdx, arrTypeIdx, sigTypeIdx, stringTypeIdx,
    structFields, funcIdx, result,
    helperIdx: new Map<string, number>(),
  };
}

// ── Type section builder ──────────────────────────────────────────────────────

/** Encode a WacType as a wasm value type for use in function type params/results. */
function encodeValType(t: WacType, ctx: WasmTypeCtx): number[] {
  return wasmValType(t, ctx);
}

/** Encode a function signature type entry. */
function encodeFuncType(params: WacType[], ret: WacType, ctx: WasmTypeCtx): number[] {
  const paramBytes = params.flatMap(p => encodeValType(p, ctx));
  const retType = ret.kind === "prim" && ret.name === "void";
  const retBytes = retType ? [] : encodeValType(ret, ctx);
  return [0x60, ...uleb(params.length), ...paramBytes, ...uleb(retBytes.length > 0 ? 1 : 0), ...retBytes];
}

/** Encode a struct type entry (for the type section). */
function encodeStructType(s: StructEntry, ctx: WasmTypeCtx, allFields: StructFieldInfo[]): number[] {
  const parent = s.parentEntry;
  const isParent = ctx.result.structs.some(x => x.parentEntry?.typeIndex === s.typeIndex);

  // Encode all fields (inherited + own)
  const fieldsBytes: number[] = [];
  fieldsBytes.push(...uleb(allFields.length)); // field count
  for (const f of allFields) {
    const mutable = !f.isConst;
    fieldsBytes.push(...fieldType(f.type, ctx, mutable));
  }
  const structBody = [0x5F, ...fieldsBytes]; // 0x5F = struct

  if (parent !== null && parent !== undefined) {
    const parentIdx = parent.typeIndex;
    if (isParent) {
      // Non-final sub (0x50 in V8 encoding): has a parent AND is itself extended
      return [0x50, 0x01, ...uleb(parentIdx), ...structBody];
    }
    // Final sub: 0x4F (final sub in V8 encoding) with 1 supertype
    return [0x4F, 0x01, ...uleb(parentIdx), ...structBody];
  } else if (isParent) {
    // Open (non-final) struct that can be extended: 0x50 in V8 encoding
    return [0x50, 0x00, ...structBody];
  } else {
    // Plain final struct (no inheritance)
    return structBody; // just 0x5F directly
  }
}

/** Encode an array type entry. */
function encodeArrayType(elem: WacType, ctx: WasmTypeCtx): number[] {
  // For packed types (i8/i16)
  if (elem.kind === "prim" && (elem.name === "i8" || elem.name === "i16" ||
                               elem.name === "u8" || elem.name === "u16")) {
    return [0x5E, packedType(elem.name), 0x01]; // array, packed type, mutable
  }
  // For non-nullable ref element types (struct/array/funcref), use nullable
  // so that array.new_default can fill slots with null
  const valBytes = wasmValType(elem, ctx);
  if ((elem.kind === "struct" || elem.kind === "array" || elem.kind === "funcref") &&
      valBytes[0] === 0x64) {
    return [0x5E, 0x63, ...valBytes.slice(1), 0x01]; // array, nullable ref, mutable
  }
  return [0x5E, ...valBytes, 0x01]; // array, valtype, mutable
}

/** Rebuild element WacType from a typeKey string. */
function keyToElemType(key: string, ctx: WasmTypeCtx): WacType | null {
  // Keys:  "i32", "i64", "f32", "f64", "bool", "string", "S:Name", "A:key", "?:key", "F:sig"
  const p = { line: 0, col: 0 };
  const prims = new Set(["i32","i64","u32","u64","f32","f64","bool","i8","i16","u8","u16","anyref","i31ref","string"]);
  if (prims.has(key)) return { kind: "prim", name: key, ...p };
  if (key.startsWith("S:#")) {
    const idx = parseInt(key.slice(3));
    const entry = ctx.result.structs[idx];
    return { kind: "struct", name: entry?.name ?? "?", resolvedTypeIndex: idx, ...p };
  }
  if (key.startsWith("S:")) return { kind: "struct", name: key.slice(2), ...p };
  if (key.startsWith("A:")) {
    const inner = keyToElemType(key.slice(2), ctx);
    return inner ? { kind: "array", elem: inner, ...p } : null;
  }
  if (key.startsWith("?:")) {
    const inner = keyToElemType(key.slice(2), ctx);
    return inner ? { kind: "nullable", inner, ...p } : null;
  }
  if (key.startsWith("F:")) {
    // Can't easily reconstruct from key; skip
    return null;
  }
  return null;
}

// ── Revised approach: store actual types in context ───────────────────────────
// Instead of reconstructing from keys, let's extend WasmTypeCtx to include ordered arrays.

type BindHelperSpec = {
  /** Export name (e.g. "__bind_str_new"). */
  name: string;
  /** Wasm function type entry bytes (0x60 ...). */
  funcTypeEntry: number[];
  /** Wasm function body bytes (locals + instructions + 0x0B). */
  body: number[];
};

type WasmTypeCtxFull = WasmTypeCtx & {
  orderedArrayElems: WacType[];
  orderedSigs: { params: WacType[]; ret: WacType }[];
  helperIdx: Map<string, number>;
  /** Bind helpers (string + array accessors) exported for use by generated TS. */
  bindHelpers: BindHelperSpec[];
};

function buildTypeCtxFull(
  result: ResolveResult,
  programs: Map<string, unknown>,
  coverage: boolean,
): WasmTypeCtxFull {
  const base = buildTypeCtx(result, programs, coverage);

  // Build key → WacType map from collectArrayTypes to handle funcref element types
  // (keyToElemType cannot reconstruct funcref types from their key strings)
  const actualArrayElems = collectArrayTypes(result, programs);
  const elemByKey = new Map<string, WacType>();
  for (const t of actualArrayElems) elemByKey.set(typeKey(t), t);

  // Rebuild ordered arrays and sigs
  const arrEntries = [...base.arrTypeIdx.entries()].sort((a, b) => a[1] - b[1]);
  const orderedArrayElems: WacType[] = [];
  for (const [key, _] of arrEntries) {
    const elem = elemByKey.get(key) ?? keyToElemType(key, base);
    if (elem) orderedArrayElems.push(elem);
  }

  // Collect sigs for all functions (in type index order)
  const sigMap = new Map<string, { params: WacType[]; ret: WacType }>();
  for (const f of result.funcs) {
    const params = fullParamTypes(f);
    const ret = funcReturnType(f);
    const k = sigKey(params, ret);
    if (!sigMap.has(k)) sigMap.set(k, { params, ret });
  }
  // Also collect funcref sigs from struct fields
  function scanFuncref(t: WacType): void {
    if (t.kind === "funcref") {
      const k = sigKey(t.params, t.ret);
      if (!sigMap.has(k)) sigMap.set(k, { params: t.params, ret: t.ret });
    } else if (t.kind === "array") scanFuncref(t.elem);
    else if (t.kind === "nullable") scanFuncref(t.inner);
  }
  for (const s of result.structs) for (const f of s.structDecl.fields) scanFuncref(f.type);
  for (const f of result.funcs) {
    for (const p of funcParams(f)) scanFuncref(p.type);
    scanFuncref(funcReturnType(f));
  }
  // Also scan var decl types in function bodies (for funcref types only in local vars)
  function scanBodyFuncref(s: Stmt): void {
    if (s.kind === "var") scanFuncref(s.type);
    if (s.kind === "if") {
      s.then.stmts.forEach(scanBodyFuncref);
      if (s.els?.kind === "else-if") scanBodyFuncref(s.els.stmt);
      else if (s.els?.kind === "else-block") s.els.block.stmts.forEach(scanBodyFuncref);
    }
    if (s.kind === "while" || s.kind === "dowhile") s.body.stmts.forEach(scanBodyFuncref);
    if (s.kind === "for") {
      if (s.init) scanBodyFuncref(s.init);
      s.body.stmts.forEach(scanBodyFuncref);
    }
    if (s.kind === "switch") for (const c of s.cases) c.body.forEach(scanBodyFuncref);
    if (s.kind === "block") s.block.stmts.forEach(scanBodyFuncref);
  }
  for (const f of result.funcs) {
    const body = f.origin.kind === "func" ? f.origin.decl.body : f.origin.decl.body;
    body.stmts.forEach(scanBodyFuncref);
  }

  const sigEntries = [...base.sigTypeIdx.entries()].sort((a, b) => a[1] - b[1]);
  const orderedSigs: { params: WacType[]; ret: WacType }[] = [];
  for (const [k, _] of sigEntries) {
    const sig = sigMap.get(k);
    if (sig) orderedSigs.push(sig);
  }

  // Builtin helper function indices: placed after all user functions
  const numUserFuncs = base.result.funcs.length;
  const helperIdx = new Map<string, number>();
  const helpers = builtinHelpers(coverage);
  for (let i = 0; i < helpers.length; i++) {
    helperIdx.set(helpers[i], numUserFuncs + i);
  }

  // Populate base.helperIdx (WasmTypeCtx) and the full ctx one
  base.helperIdx = helperIdx;

  // Bind helpers come after the builtin helpers
  const partialCtx = { ...base, orderedArrayElems, orderedSigs, helperIdx };
  const bindHelpers = buildBindHelpers(result, partialCtx);

  return { ...partialCtx, bindHelpers };
}

// ── Builtin helper function signatures ────────────────────────────────────────
// String helpers use non-null string ref (0x64 sleb(si)) for params/results.

/**
 * Builtin helpers, in the order their function indices and type indices are
 * assigned. Everything downstream derives its counts from this list, so adding
 * a helper means adding a signature to helperFuncTypes and a body to
 * buildHelperBodies — and nothing else.
 */
const STRING_AND_MATH_HELPERS = [
  "__str_concat", "__str_cmp", "__str_idx", "__str_slice", "__str_indexof",
  "__str_from_cp", "__str_from_bytes", "__str_to_bytes",
  "__fmod", "__fmodf",
] as const;

/**
 * Helpers that only exist in an instrumented module: allocate the counter array,
 * report its length, and read one counter. Reading via an accessor rather than
 * returning the array keeps the host side free of array marshalling.
 */
const COVERAGE_HELPERS = ["__cov_init", "__cov_len", "__cov_get"] as const;

/**
 * The builtin helpers present in this module. Coverage helpers are appended only
 * when instrumenting, so an uninstrumented build is unchanged byte for byte.
 */
function builtinHelpers(coverage: boolean): readonly string[] {
  return coverage ? [...STRING_AND_MATH_HELPERS, ...COVERAGE_HELPERS] : STRING_AND_MATH_HELPERS;
}

/** Return the builtin helper function type entries for the type section. */
function helperFuncTypes(si: number, u8ArrIdx: number, coverage: boolean): number[][] {
  // non-null str ref: 0x64 sleb(si)
  const str = [0x64, ...sleb(si)];
  const i32 = [0x7F];
  // Helper signatures:
  // __str_concat(str, str) -> str
  const concat = [0x60, 0x02, ...str, ...str, 0x01, ...str];
  // __str_cmp(str, str) -> i32
  const cmp    = [0x60, 0x02, ...str, ...str, 0x01, ...i32];
  // __str_idx(str, i32) -> str
  const idx    = [0x60, 0x02, ...str, ...i32, 0x01, ...str];
  // __str_slice(str, i32, i32) -> str
  const slice  = [0x60, 0x03, ...str, ...i32, ...i32, 0x01, ...str];
  // __str_indexof(str, str) -> i32
  const iof    = [0x60, 0x02, ...str, ...str, 0x01, ...i32];
  // __str_from_cp(i32) -> str
  const fromCp = [0x60, 0x01, ...i32, 0x01, ...str];
  // __str_from_bytes(u8[]) -> str
  const u8arr    = [0x64, ...sleb(u8ArrIdx)];
  const fromBytes = [0x60, 0x01, ...u8arr, 0x01, ...str];
  // __str_to_bytes(str) -> u8[]
  const toBytes  = [0x60, 0x01, ...str, 0x01, ...u8arr];
  // __fmod(f64, f64) -> f64
  const f64    = [0x7C];
  const fmod   = [0x60, 0x02, ...f64, ...f64, 0x01, ...f64];
  // __fmodf(f32, f32) -> f32
  const f32    = [0x7D];
  const fmodf  = [0x60, 0x02, ...f32, ...f32, 0x01, ...f32];
  const base = [concat, cmp, idx, slice, iof, fromCp, fromBytes, toBytes, fmod, fmodf];
  if (!coverage) return base;
  // __cov_init() -> void, __cov_len() -> i32, __cov_get(i32) -> i32
  return [
    ...base,
    [0x60, 0x00, 0x00],
    [0x60, 0x00, 0x01, ...i32],
    [0x60, 0x01, ...i32, 0x01, ...i32],
  ];
}

/** Encode an f64.const instruction. */
function f64Const(v: number): number[] {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, v, true);
  return [0x44, ...new Uint8Array(buf)];
}


/**
 * __cov_init() — allocate the counter array and store it in global 0.
 *
 * The global starts null so the module needs no start section; the host (or the
 * bindgen wrapper) calls this before running instrumented code. Calling it again
 * allocates a fresh array, which is how counters are reset between runs.
 */
function makeCovInit(arrTypeIdx: number, numPoints: number): number[] {
  return [
    0x00,                                          // no locals
    0x41, ...sleb(numPoints),                      // i32.const numPoints
    0xFB, 0x07, ...uleb(arrTypeIdx),               // array.new_default
    0x24, 0x00,                                    // global.set 0
    0x0B,
  ];
}

/** __cov_len() -> i32 — how many counters exist. A constant, fixed at compile time. */
function makeCovLen(numPoints: number): number[] {
  return [0x00, 0x41, ...sleb(numPoints), 0x0B];
}

/** __cov_get(i: i32) -> i32 — read one counter. Traps if __cov_init was not called. */
function makeCovGet(arrTypeIdx: number): number[] {
  return [
    0x00,                                          // no locals
    0x23, 0x00,                                    // global.get 0
    0x20, 0x00,                                    // local.get 0 (index)
    0xFB, 0x0B, ...uleb(arrTypeIdx),               // array.get
    0x0B,
  ];
}

/**
 * Build all builtin helper function bodies, one per builtinHelpers() entry and in
 * that order. Bodies are returned unprefixed; the code section adds the length
 * prefix, as it does for user functions.
 *
 * @param fmodIdx function index of __fmod, which __fmodf calls
 */
function buildHelperBodies(
  si: number,
  u8ArrIdx: number,
  fmodIdx: number,
  cov: { arrTypeIdx: number; numPoints: number } | undefined,
): number[][] {
  const base = [
    makeConcat(si),
    makeCmp(si),
    makeIdx(si),
    makeSlice(si),
    makeIndexOf(si),
    makeFromCodepoint(si),
    makeFromBytes(si, u8ArrIdx),
    makeToBytes(si, u8ArrIdx),
    makeFmod(),
    makeFmodF(fmodIdx),
  ];
  if (!cov) return base;
  return [
    ...base,
    makeCovInit(cov.arrTypeIdx, cov.numPoints),
    makeCovLen(cov.numPoints),
    makeCovGet(cov.arrTypeIdx),
  ];
}

// ── Bind helpers (accessor functions exported for JS bindgen use) ─────────────

/** Return the wasm element value type for a primitive element type at JS boundary.
 *  Packed types (i8, i16) are passed as i32. */
function bindElemValType(elem: WacType): number[] {
  if (elem.kind !== "prim") return [0x7F]; // fallback i32
  const map: Record<string, number> = {
    i8: 0x7F, i16: 0x7F, i32: 0x7F, u8: 0x7F, u16: 0x7F, u32: 0x7F,
    i64: 0x7E, u64: 0x7E, f32: 0x7D, f64: 0x7C,
    anyref: 0x6E, i31ref: 0x6C,
  };
  return [map[elem.name] ?? 0x7F];
}

/** Return the array.get opcode byte for a given element type. */
function arrGetOp(elem: WacType): number {
  const name = elem.kind === "prim" ? elem.name : "";
  if (name === "i8" || name === "i16")  return 0x0C; // array.get_s — signed elements
  if (name === "u8" || name === "u16") return 0x0D; // array.get_u — unsigned
  return 0x0B;                                       // array.get
}

/** Build the bind helper specs needed for a compiled wac module. */
/**
 * Memory section (id 5) — a staging buffer for bulk data transfer.
 *
 * Without it, moving an array across the boundary costs one exported wasm call
 * per element: a 1 MiB byte array is a million calls each way, and the copy
 * dominates any real work. With it, JS does one `TypedArray.set` into wasm memory
 * and a single call runs a wasm-internal loop into the GC array.
 *
 * Starts at zero pages and grows on demand, so a module that never moves bulk
 * data pays nothing. Section id 5 precedes the global section (6), which wasm
 * requires.
 */
function buildMemorySection(): number[] {
  // one memory, flags 0 (min only), min 0 pages
  return section(5, [0x01, 0x00, 0x00]);
}

const PAGE_BITS = 16;   // 65536 bytes per wasm page

/**
 * __bind_mem_ensure(bytes) -> i32
 *
 * Grow the staging buffer to hold `bytes`, and return its size in bytes. The
 * caller must re-read `memory.buffer` afterwards: growing detaches the old
 * ArrayBuffer, so any view built before this call is dead.
 */
function makeMemEnsure(): number[] {
  return [
    0x01, 0x01, 0x7F,                  // local1 = needed pages
    // needPages = (bytes + 65535) >>> 16
    0x20, 0x00,
    0x41, ...sleb(0xFFFF), 0x6A,
    0x41, PAGE_BITS, 0x76,
    0x21, 0x01,
    // if (memory.size < needPages) memory.grow(needPages - memory.size)
    0x3F, 0x00,
    0x20, 0x01,
    0x49,                              // i32.lt_u
    0x04, 0x40,
      0x20, 0x01, 0x3F, 0x00, 0x6B,
      0x40, 0x00,                      // memory.grow
      0x1A,                            // drop — the caller checks the returned size
    0x0B,
    // return memory.size << 16
    0x3F, 0x00, 0x41, PAGE_BITS, 0x74,
    0x0B,
  ];
}

/** Byte width, load opcode and store opcode for a bulk-transferable element. */
function bulkOps(name: string): { width: number; load: number; store: number } | null {
  // The load is only ever a staging-buffer read on the way into a GC array,
  // where the value is about to be truncated to the element width again, so
  // the *_u forms serve signed and unsigned elements alike. What differs
  // between them is the array.get on the way out, which arrGetOp picks.
  const map: Record<string, { width: number; load: number; store: number }> = {
    u8:  { width: 1, load: 0x2D, store: 0x3A },   // i32.load8_u  / i32.store8
    i8:  { width: 1, load: 0x2D, store: 0x3A },
    u16: { width: 2, load: 0x2F, store: 0x3B },   // i32.load16_u / i32.store16
    i16: { width: 2, load: 0x2F, store: 0x3B },
    i32: { width: 4, load: 0x28, store: 0x36 },
    u32: { width: 4, load: 0x28, store: 0x36 },
    i64: { width: 8, load: 0x29, store: 0x37 },
    u64: { width: 8, load: 0x29, store: 0x37 },
    f32: { width: 4, load: 0x2A, store: 0x38 },
    f64: { width: 8, load: 0x2B, store: 0x39 },
  };
  return map[name] ?? null;
}

/** Multiply the index on the stack by the element width, unless it is 1. */
function scaleIndex(width: number): number[] {
  return width === 1 ? [] : [0x41, ...sleb(width), 0x6C];   // i32.const w; i32.mul
}

/**
 * __bind_<t>_from_mem(count) -> array
 *
 * Allocate an array of `count` elements and fill it from the staging buffer. The
 * loop runs entirely inside wasm, which is the whole point.
 */
function makeFromMem(arrTypeIdx: number, width: number, load: number): number[] {
  return [
    // local1 = the array (nullable, so it needs no initialiser), local2 = i
    0x02, 0x01, 0x63, ...sleb(arrTypeIdx), 0x01, 0x7F,
    0x20, 0x00, 0xFB, 0x07, ...uleb(arrTypeIdx), 0x21, 0x01,   // array.new_default
    0x41, 0x00, 0x21, 0x02,                                    // i = 0
    0x02, 0x40, 0x03, 0x40,                                    // block { loop {
      0x20, 0x02, 0x20, 0x00, 0x4E, 0x0D, 0x01,                //   if i >= count: break
      0x20, 0x01, 0x20, 0x02,                                  //   array, index
      0x20, 0x02, ...scaleIndex(width), load, 0x00, 0x00,      //   load(mem, i*w)
      0xFB, 0x0E, ...uleb(arrTypeIdx),                         //   array.set
      0x20, 0x02, 0x41, 0x01, 0x6A, 0x21, 0x02,                //   i++
      0x0C, 0x00,
    0x0B, 0x0B,
    0x20, 0x01, 0xD4,                                          // ref.as_non_null
    0x0B,
  ];
}

/**
 * __bind_<t>_to_mem(array) -> i32
 *
 * Copy an array into the staging buffer and return its length. Assumes the caller
 * has already called __bind_mem_ensure — writing past the end traps, which is the
 * correct outcome for a caller that skipped it.
 */
function makeToMem(arrTypeIdx: number, width: number, store: number, getOp: number): number[] {
  return [
    0x02, 0x01, 0x7F, 0x01, 0x7F,                              // local1 = i, local2 = n
    0x41, 0x00, 0x21, 0x01,                                    // i = 0
    0x20, 0x00, 0xFB, 0x0F, 0x21, 0x02,                        // n = array.len
    0x02, 0x40, 0x03, 0x40,                                    // block { loop {
      0x20, 0x01, 0x20, 0x02, 0x4E, 0x0D, 0x01,                //   if i >= n: break
      0x20, 0x01, ...scaleIndex(width),                        //   address = i*w
      0x20, 0x00, 0x20, 0x01, 0xFB, getOp, ...uleb(arrTypeIdx),//   array.get
      store, 0x00, 0x00,                                       //   store
      0x20, 0x01, 0x41, 0x01, 0x6A, 0x21, 0x01,                //   i++
      0x0C, 0x00,
    0x0B, 0x0B,
    0x20, 0x02,
    0x0B,
  ];
}

function buildBindHelpers(
  result: ResolveResult,
  ctx: WasmTypeCtx & { orderedArrayElems: WacType[]; orderedSigs: { params: WacType[]; ret: WacType }[] },
): BindHelperSpec[] {
  const helpers: BindHelperSpec[] = [];
  const si = ctx.stringTypeIdx;
  const str = [0x64, ...sleb(si)];
  const i32 = [0x7F];

  // String bind helpers — always included alongside the string helper functions
  const strNewBody   = [0x00, 0x20, 0x00, 0xFB, 0x07, ...uleb(si), 0x0B];
  const strGetBody   = [0x00, 0x20, 0x00, 0x20, 0x01, 0xFB, 0x0D, ...uleb(si), 0x0B];
  const strSetBody   = [0x00, 0x20, 0x00, 0x20, 0x01, 0x20, 0x02, 0xFB, 0x0E, ...uleb(si), 0x0B];
  const strLenBody   = [0x00, 0x20, 0x00, 0xFB, 0x0F, 0x0B];

  helpers.push({ name: "__bind_str_new", funcTypeEntry: [0x60, 0x01, ...i32, 0x01, ...str],             body: strNewBody });
  helpers.push({ name: "__bind_str_get", funcTypeEntry: [0x60, 0x02, ...str, ...i32, 0x01, ...i32],     body: strGetBody });
  helpers.push({ name: "__bind_str_set", funcTypeEntry: [0x60, 0x03, ...str, ...i32, ...i32, 0x00],     body: strSetBody });
  helpers.push({ name: "__bind_str_len", funcTypeEntry: [0x60, 0x01, ...str, 0x01, ...i32],             body: strLenBody });

  // Bulk transfer through the staging buffer. Strings are i8 arrays, so they use
  // the same shape as a byte array.
  helpers.push({
    name: "__bind_mem_ensure",
    funcTypeEntry: [0x60, 0x01, ...i32, 0x01, ...i32],
    body: makeMemEnsure(),
  });
  helpers.push({
    name: "__bind_str_from_mem",
    funcTypeEntry: [0x60, 0x01, ...i32, 0x01, ...str],
    body: makeFromMem(si, 1, 0x2D),
  });
  helpers.push({
    name: "__bind_str_to_mem",
    funcTypeEntry: [0x60, 0x01, ...str, 0x01, ...i32],
    body: makeToMem(si, 1, 0x3A, 0x0D),
  });

  // Array bind helpers — for each primitive array element type in exported signatures
  const seen = new Set<string>();
  for (const f of result.funcs) {
    if (!f.exportName || f.filePath !== result.entryPath) continue;
    const allTypes = [...funcParams(f).map(p => p.type), funcReturnType(f)];
    for (const t of allTypes) {
      const elem = t.kind === "array" && t.elem.kind === "prim" ? t.elem : null;
      if (!elem) continue;
      const key = typeKey(elem);
      if (seen.has(key)) continue;
      seen.add(key);

      const ai = ctx.arrTypeIdx.get(key)!;
      const aref = [0x64, ...sleb(ai)];
      const vt = bindElemValType(elem);
      const getOp = arrGetOp(elem);
      const suffix = key; // e.g. "i32", "i8", "f64"

      const arrNewBody = [0x00, 0x20, 0x00, 0xFB, 0x07, ...uleb(ai), 0x0B];
      const arrGetBody = [0x00, 0x20, 0x00, 0x20, 0x01, 0xFB, getOp, ...uleb(ai), 0x0B];
      const arrSetBody = [0x00, 0x20, 0x00, 0x20, 0x01, 0x20, 0x02, 0xFB, 0x0E, ...uleb(ai), 0x0B];
      const arrLenBody = [0x00, 0x20, 0x00, 0xFB, 0x0F, 0x0B];

      helpers.push({ name: `__bind_arr_${suffix}_new`, funcTypeEntry: [0x60, 0x01, ...i32, 0x01, ...aref],        body: arrNewBody });
      helpers.push({ name: `__bind_arr_${suffix}_get`, funcTypeEntry: [0x60, 0x02, ...aref, ...i32, 0x01, ...vt], body: arrGetBody });
      helpers.push({ name: `__bind_arr_${suffix}_set`, funcTypeEntry: [0x60, 0x03, ...aref, ...i32, ...vt, 0x00], body: arrSetBody });
      helpers.push({ name: `__bind_arr_${suffix}_len`, funcTypeEntry: [0x60, 0x01, ...aref, 0x01, ...i32],        body: arrLenBody });

      // Bulk path, for element types that have a memory representation. Anything
      // else keeps only the per-element accessors above.
      const bulk = elem.kind === "prim" ? bulkOps(elem.name) : null;
      if (bulk) {
        helpers.push({
          name: `__bind_arr_${suffix}_from_mem`,
          funcTypeEntry: [0x60, 0x01, ...i32, 0x01, ...aref],
          body: makeFromMem(ai, bulk.width, bulk.load),
        });
        helpers.push({
          name: `__bind_arr_${suffix}_to_mem`,
          funcTypeEntry: [0x60, 0x01, ...aref, 0x01, ...i32],
          body: makeToMem(ai, bulk.width, bulk.store, getOp),
        });
      }
    }
  }

  return helpers;
}

function makeConcat(si: number): number[] {
  // __str_concat(a:str, b:str) -> str
  // locals: local2=aLen(i32), local3=bLen(i32), local4=result(nullable str)
  const nullableStr = [0x63, ...sleb(si)];
  return [
    // local declarations: 2×i32, 1×nullable-str
    0x03, 0x01, 0x7F, 0x01, 0x7F, 0x01, ...nullableStr,
    // local2 = array.len(a)
    0x20, 0x00, 0xFB, 0x0F, 0x21, 0x02,
    // local3 = array.len(b)
    0x20, 0x01, 0xFB, 0x0F, 0x21, 0x03,
    // local4 = array.new_default $str (aLen+bLen)
    0x20, 0x02, 0x20, 0x03, 0x6A,
    0xFB, 0x07, ...uleb(si), 0x21, 0x04,
    // array.copy $str $str result 0 a 0 aLen
    0x20, 0x04, 0x41, 0x00, 0x20, 0x00, 0x41, 0x00, 0x20, 0x02,
    0xFB, 0x11, ...uleb(si), ...uleb(si),
    // array.copy $str $str result aLen b 0 bLen
    0x20, 0x04, 0x20, 0x02, 0x20, 0x01, 0x41, 0x00, 0x20, 0x03,
    0xFB, 0x11, ...uleb(si), ...uleb(si),
    // return ref.as_non_null result
    0x20, 0x04, 0xD4,
    0x0B, // end
  ];
}

function makeCmp(si: number): number[] {
  // __str_cmp(a:str, b:str) -> i32
  // locals: local2=aLen, local3=bLen, local4=i, local5=ba, local6=bb (all i32)
  // Note: loop label 0 = back to loop start (continue), block label 1 = exit block (break)
  return [
    0x01, 0x05, 0x7F, // 5 local i32s
    // local2 = array.len(a), local3 = array.len(b), local4 = 0
    0x20, 0x00, 0xFB, 0x0F, 0x21, 0x02,
    0x20, 0x01, 0xFB, 0x0F, 0x21, 0x03,
    // block + loop: block label=1 breaks out, loop label=0 continues
    0x02, 0x40, // block (void)
    0x03, 0x40, // loop (void)
      // break if i >= aLen (br 1 = exit block)
      0x20, 0x04, 0x20, 0x02, 0x4E, 0x0D, 0x01,
      // break if i >= bLen
      0x20, 0x04, 0x20, 0x03, 0x4E, 0x0D, 0x01,
      // ba = a[i], bb = b[i]
      0x20, 0x00, 0x20, 0x04, 0xFB, 0x0D, ...uleb(si), 0x21, 0x05,
      0x20, 0x01, 0x20, 0x04, 0xFB, 0x0D, ...uleb(si), 0x21, 0x06,
      // if ba != bb: return ba - bb
      0x20, 0x05, 0x20, 0x06, 0x47,
      0x04, 0x40,
        0x20, 0x05, 0x20, 0x06, 0x6B, 0x0F,
      0x0B,
      // i++, then continue loop
      0x20, 0x04, 0x41, 0x01, 0x6A, 0x21, 0x04,
      0x0C, 0x00, // br 0 = continue loop
    0x0B, // end loop
    0x0B, // end block
    // return aLen - bLen
    0x20, 0x02, 0x20, 0x03, 0x6B,
    0x0B, // end
  ];
}

function makeIdx(si: number): number[] {
  // __str_idx(s:str, i:i32) -> str
  // locals: local2=b0(i32), local3=len(i32), local4=sLen(i32), local5=end(i32), local6=result(nullable str)
  const nullableStr = [0x63, ...sleb(si)];
  // Note: 0xF8, 0xF0, 0xE0, 0xC0 as signed i7:
  //   0xF8 = -8 in signed = 0x78 in sleb
  //   0xF0 = -16 in signed = 0x70 in sleb
  //   0xE0 = -32 in signed = 0x60 in sleb
  //   0xC0 = -64 in signed = 0x40 in sleb
  // HOWEVER: i32.const uses sleb128, so for values >= 64 in the range 64-127:
  //   As signed i32: 64 = 0x40, but sleb for 64 is [0xC0, 0x00]
  //   Similarly 0xE0 as i32 = 224, sleb128 = [0xE0, 0x01]
  //   0xC0 as i32 = 192, sleb128 = [0xC0, 0x01]
  //   0xF0 as i32 = 240, sleb128 = [0xF0, 0x01]
  //   0xF8 as i32 = 248, sleb128 = [0xF8, 0x01]
  // Using sleb() function for correctness:
  const c0  = sleb(0xC0); // 192
  const e0  = sleb(0xE0); // 224
  const f0  = sleb(0xF0); // 240
  const f8  = sleb(0xF8); // 248
  return [
    // locals: 4×i32, 1×nullable-str
    0x02, 0x04, 0x7F, 0x01, ...nullableStr,
    // local4 = array.len(s)
    0x20, 0x00, 0xFB, 0x0F, 0x21, 0x04,
    // trap if i < 0 or i >= sLen
    0x20, 0x01, 0x41, 0x00, 0x48,        // i < 0
    0x20, 0x01, 0x20, 0x04, 0x4E,        // i >= sLen
    0x72,                                  // i32.or
    0x04, 0x40, 0x00, 0x0B,               // if: unreachable; end
    // b0 = s[i]
    0x20, 0x00, 0x20, 0x01, 0xFB, 0x0D, ...uleb(si), 0x21, 0x02,
    // Continuation byte check: if (b0 & 0xC0) == 0x80 → return ""
    0x20, 0x02, 0x41, ...sleb(0xC0), 0x71, // b0 & 0xC0
    0x41, ...sleb(0x80),                    // 0x80
    0x46,                                   // i32.eq
    0x04, 0x40,
      0x41, 0x00, 0xFB, 0x07, ...uleb(si), // i32.const 0; array.new_default $str
      0xD4, 0x0F,                           // ref.as_non_null; return
    0x0B,
    // Determine UTF-8 sequence length
    0x41, 0x01, 0x21, 0x03,               // len = 1
    // if (b0 & 0xE0) == 0xC0 → len=2
    0x20, 0x02, 0x41, ...e0, 0x71,        // b0 & 0xE0
    0x41, ...c0,                           // 0xC0
    0x46,                                  // i32.eq
    0x04, 0x40,
      0x41, 0x02, 0x21, 0x03,
    0x05, // else
      // if (b0 & 0xF0) == 0xE0 → len=3
      0x20, 0x02, 0x41, ...f0, 0x71,      // b0 & 0xF0
      0x41, ...e0,                         // 0xE0
      0x46,                                // i32.eq
      0x04, 0x40,
        0x41, 0x03, 0x21, 0x03,
      0x05, // else
        // if (b0 & 0xF8) == 0xF0 → len=4
        0x20, 0x02, 0x41, ...f8, 0x71,    // b0 & 0xF8
        0x41, ...f0,                       // 0xF0
        0x46,                              // i32.eq
        0x04, 0x40,
          0x41, 0x04, 0x21, 0x03,
        0x0B,
      0x0B,
    0x0B,
    // end = min(i + len, sLen)
    0x20, 0x01, 0x20, 0x03, 0x6A,         // i + len
    0x21, 0x05,                             // local.set 5 (end)
    // if end > sLen: end = sLen
    0x20, 0x05, 0x20, 0x04, 0x4A,          // end > sLen (i32.gt_s)
    0x04, 0x40,
      0x20, 0x04, 0x21, 0x05,              //   end = sLen
    0x0B,
    // actualLen = end - i
    0x20, 0x05, 0x20, 0x01, 0x6B,          // end - i
    // local6 = array.new_default $str (actualLen)
    0xFB, 0x07, ...uleb(si), 0x21, 0x06,   // array.new_default $str; local.set 6
    // array.copy $str $str result 0 s i (end-i)
    0x20, 0x06,                             // local.get 6 (result)
    0x41, 0x00,                             // i32.const 0
    0x20, 0x00,                             // local.get 0 (s)
    0x20, 0x01,                             // local.get 1 (i)
    0x20, 0x05, 0x20, 0x01, 0x6B,           // end - i
    0xFB, 0x11, ...uleb(si), ...uleb(si),   // array.copy $str $str
    // return ref.as_non_null result
    0x20, 0x06, 0xD4,
    0x0B, // end
  ];
}

function makeSlice(si: number): number[] {
  // __str_slice(s:str, start:i32, end:i32) -> str
  // locals: local3=sLen(i32), local4=actualLen(i32), local5=result(nullable str)
  const nullableStr = [0x63, ...sleb(si)];
  return [
    // locals: 2×i32, 1×nullable-str
    0x02, 0x02, 0x7F, 0x01, ...nullableStr,
    // local3 = array.len(s)
    0x20, 0x00, 0xFB, 0x0F, 0x21, 0x03,
    // clamp start to [0, sLen]: if start < 0: start=0
    0x20, 0x01, 0x41, 0x00, 0x48,
    0x04, 0x40, 0x41, 0x00, 0x21, 0x01, 0x0B,
    // if start > sLen: start=sLen
    0x20, 0x01, 0x20, 0x03, 0x4A,
    0x04, 0x40, 0x20, 0x03, 0x21, 0x01, 0x0B,
    // clamp end to [0, sLen]: if end < 0: end=0
    0x20, 0x02, 0x41, 0x00, 0x48,
    0x04, 0x40, 0x41, 0x00, 0x21, 0x02, 0x0B,
    // if end > sLen: end=sLen
    0x20, 0x02, 0x20, 0x03, 0x4A,
    0x04, 0x40, 0x20, 0x03, 0x21, 0x02, 0x0B,
    // if end < start: end=start
    0x20, 0x02, 0x20, 0x01, 0x48,
    0x04, 0x40, 0x20, 0x01, 0x21, 0x02, 0x0B,
    // actualLen = end - start
    0x20, 0x02, 0x20, 0x01, 0x6B, 0x21, 0x04,
    // local5 = array.new_default $str (actualLen)
    0x20, 0x04, 0xFB, 0x07, ...uleb(si), 0x21, 0x05,
    // array.copy $str $str result 0 s start actualLen
    0x20, 0x05, 0x41, 0x00, 0x20, 0x00, 0x20, 0x01, 0x20, 0x04,
    0xFB, 0x11, ...uleb(si), ...uleb(si),
    // return ref.as_non_null result
    0x20, 0x05, 0xD4,
    0x0B, // end
  ];
}

/**
 * __str_from_cp(cp:i32) -> str
 *
 * UTF-8 encode one Unicode scalar into a fresh string. Traps on a value with no
 * encoding — negative, above U+10FFFF, or a surrogate — because there is no
 * answer to return and silently substituting U+FFFD would hide the caller's bug.
 *
 * array.set on a packed i8 array truncates on store, so the byte expressions
 * need no masking beyond what the encoding itself requires.
 */
function makeFromCodepoint(si: number): number[] {
  const nullableStr = [0x63, ...sleb(si)];
  /** result = array.new_default $str(n) */
  const alloc = (n: number) => [0x41, ...sleb(n), 0xFB, 0x07, ...uleb(si), 0x21, 0x01];
  /** result[i] = <bytes on the stack> */
  const setByte = (i: number, value: number[]) =>
    [0x20, 0x01, 0x41, ...sleb(i), ...value, 0xFB, 0x0E, ...uleb(si)];
  /** cp >>> shift, then OR with a lead/continuation marker */
  const shifted = (marker: number, shift: number) =>
    [0x41, ...sleb(marker), 0x20, 0x00, 0x41, ...sleb(shift), 0x76, 0x72];
  /** (cp >>> shift) & 0x3F, OR'd with the 0x80 continuation marker */
  const cont = (shift: number) =>
    [0x41, ...sleb(0x80), 0x20, 0x00, 0x41, ...sleb(shift), 0x76, 0x41, ...sleb(0x3F), 0x71, 0x72];
  /** cp & 0x3F, OR'd with 0x80 — the final continuation byte */
  const contLow = [0x41, ...sleb(0x80), 0x20, 0x00, 0x41, ...sleb(0x3F), 0x71, 0x72];
  /** if (cp <cmp> bound) { trap } */
  const trapIf = (bound: number, cmp: number) =>
    [0x20, 0x00, 0x41, ...sleb(bound), cmp, 0x04, 0x40, 0x00, 0x0B];

  return [
    // locals: 1 × nullable str
    0x01, 0x01, ...nullableStr,

    ...trapIf(0, 0x48),         // cp < 0
    ...trapIf(0x10FFFF, 0x4A),  // cp > U+10FFFF
    // surrogates D800..DFFF have no UTF-8 form
    0x20, 0x00, 0x41, ...sleb(0xD800), 0x4E,
    0x04, 0x40,
      0x20, 0x00, 0x41, ...sleb(0xDFFF), 0x4C,
      0x04, 0x40, 0x00, 0x0B,
    0x0B,

    // 1 byte: cp < 0x80
    0x20, 0x00, 0x41, ...sleb(0x80), 0x48,
    0x04, 0x40,
      ...alloc(1),
      ...setByte(0, [0x20, 0x00]),
    0x05,
      // 2 bytes: cp < 0x800
      0x20, 0x00, 0x41, ...sleb(0x800), 0x48,
      0x04, 0x40,
        ...alloc(2),
        ...setByte(0, shifted(0xC0, 6)),
        ...setByte(1, contLow),
      0x05,
        // 3 bytes: cp < 0x10000
        0x20, 0x00, 0x41, ...sleb(0x10000), 0x48,
        0x04, 0x40,
          ...alloc(3),
          ...setByte(0, shifted(0xE0, 12)),
          ...setByte(1, cont(6)),
          ...setByte(2, contLow),
        0x05,
          // 4 bytes
          ...alloc(4),
          ...setByte(0, shifted(0xF0, 18)),
          ...setByte(1, cont(12)),
          ...setByte(2, cont(6)),
          ...setByte(3, contLow),
        0x0B,
      0x0B,
    0x0B,

    0x20, 0x01, 0xD4, // ref.as_non_null result
    0x0B,
  ];
}

/**
 * __str_from_bytes(bytes:u8[]) -> str
 *
 * Copy UTF-8 bytes into a fresh string. A copy rather than a reinterpret because
 * `string` and `u8[]` are distinct wasm array types with the same element type —
 * and because aliasing the caller's array would let a later write mutate a value
 * the language promises is immutable.
 *
 * The bytes are not validated. An ill-formed sequence yields a string whose
 * indexing returns "" at the bad offset, which is the same thing that happens to
 * a slice landing mid-character; validating here would cost a second pass on
 * every call for a guarantee the type does not otherwise make.
 */
function makeFromBytes(si: number, u8ArrIdx: number): number[] {
  const nullableStr = [0x63, ...sleb(si)];
  return [
    // locals: local1 = len(i32), local2 = result(nullable str)
    0x02, 0x01, 0x7F, 0x01, ...nullableStr,
    // len = array.len(bytes)
    0x20, 0x00, 0xFB, 0x0F, 0x21, 0x01,
    // result = array.new_default $str(len)
    0x20, 0x01, 0xFB, 0x07, ...uleb(si), 0x21, 0x02,
    // array.copy $str $u8 (result, 0, bytes, 0, len)
    0x20, 0x02, 0x41, 0x00, 0x20, 0x00, 0x41, 0x00, 0x20, 0x01,
    0xFB, 0x11, ...uleb(si), ...uleb(u8ArrIdx),
    // return ref.as_non_null result
    0x20, 0x02, 0xD4,
    0x0B,
  ];
}

/**
 * __str_to_bytes(s:str) -> u8[]
 *
 * The mirror of __str_from_bytes: a fresh u8[] holding the string's UTF-8 bytes.
 * A copy for the same reason — handing out the string's own storage would give
 * the caller a writable view of an immutable value.
 */
function makeToBytes(si: number, u8ArrIdx: number): number[] {
  const nullableArr = [0x63, ...sleb(u8ArrIdx)];
  return [
    // locals: local1 = len(i32), local2 = result(nullable u8[])
    0x02, 0x01, 0x7F, 0x01, ...nullableArr,
    // len = array.len(s)
    0x20, 0x00, 0xFB, 0x0F, 0x21, 0x01,
    // result = array.new_default $u8(len)
    0x20, 0x01, 0xFB, 0x07, ...uleb(u8ArrIdx), 0x21, 0x02,
    // array.copy $u8 $str (result, 0, s, 0, len)
    0x20, 0x02, 0x41, 0x00, 0x20, 0x00, 0x41, 0x00, 0x20, 0x01,
    0xFB, 0x11, ...uleb(u8ArrIdx), ...uleb(si),
    0x20, 0x02, 0xD4,
    0x0B,
  ];
}

function makeIndexOf(si: number): number[] {
  // __str_indexof(haystack:str, needle:str) -> i32
  // locals: local2=hLen(i32), local3=nLen(i32), local4=i(i32), local5=j(i32), local6=match(i32)
  // Structure: each loop wrapped in a block so br 1 = break, br 0 = continue
  return [
    0x01, 0x05, 0x7F, // 5 local i32s
    // local2 = array.len(haystack)
    0x20, 0x00, 0xFB, 0x0F, 0x21, 0x02,
    // local3 = array.len(needle)
    0x20, 0x01, 0xFB, 0x0F, 0x21, 0x03,
    // if nLen == 0: return 0 (empty needle found at 0)
    0x20, 0x03, 0x45, 0x04, 0x40, 0x41, 0x00, 0x0F, 0x0B,
    // outer: block + loop pair (block=label1 breaks, loop=label0 continues)
    0x02, 0x40, // outer block
    0x03, 0x40, // outer loop
      // if i + nLen > hLen: break outer
      0x20, 0x04, 0x20, 0x03, 0x6A,
      0x20, 0x02,
      0x4A,                                 // i32.gt_s
      0x0D, 0x01,                           // br_if 1 (exit outer block)
      // match = 1, j = 0
      0x41, 0x01, 0x21, 0x06,
      0x41, 0x00, 0x21, 0x05,
      // inner: block + loop pair
      0x02, 0x40, // inner block
      0x03, 0x40, // inner loop
        // if j >= nLen: break inner (all matched)
        0x20, 0x05, 0x20, 0x03, 0x4E, 0x0D, 0x01,  // br_if 1 = exit inner block
        // if haystack[i+j] != needle[j]: match=0, break inner
        0x20, 0x00, 0x20, 0x04, 0x20, 0x05, 0x6A,
        0xFB, 0x0D, ...uleb(si),
        0x20, 0x01, 0x20, 0x05,
        0xFB, 0x0D, ...uleb(si),
        0x47,                               // i32.ne
        0x04, 0x40,
          0x41, 0x00, 0x21, 0x06,           //   match = 0
          0x0C, 0x02,                        //   br 2 = exit inner block (past inner loop)
        0x0B,
        // j++, continue inner loop
        0x20, 0x05, 0x41, 0x01, 0x6A, 0x21, 0x05,
        0x0C, 0x00, // br 0 = continue inner loop
      0x0B, // end inner loop
      0x0B, // end inner block
      // if match: return i
      0x20, 0x06, 0x04, 0x40,
        0x20, 0x04, 0x0F,
      0x0B,
      // i++, continue outer loop
      0x20, 0x04, 0x41, 0x01, 0x6A, 0x21, 0x04,
      0x0C, 0x00, // br 0 = continue outer loop
    0x0B, // end outer loop
    0x0B, // end outer block
    // not found: return -1
    0x41, 0x7F,                             // i32.const -1
    0x0B, // end
  ];
}

/**
 * __fmod(x:f64, y:f64) -> f64 — floating-point remainder, as C fmod / IEEE 754
 * "remainder truncated toward zero". wasm has no f64.rem instruction, so this
 * is a software routine.
 *
 * `x - trunc(x/y)*y` is NOT this function: the quotient rounds, so trunc lands
 * on the wrong integer and the sign can invert. fmod(1.0, 0.1) that way gives
 * -2.2e-16 instead of 0.09999999999999995.
 *
 * Instead, shift-and-subtract in the float domain, which is exact:
 *
 *   r = |x|, s = |y|
 *   double s (counting the doublings in n) while 2s <= r
 *   then n+1 times: if r >= s, r -= s; halve s
 *   result = copysign(r, x)
 *
 * Every step is exact. Doubling and halving only change the exponent, so no
 * mantissa bit is ever lost — and s never overflows because it stays <= r.
 * Each subtraction runs with s <= r < 2s, where Sterbenz's lemma makes r - s
 * exactly representable. So the loop computes the true remainder, not an
 * approximation of it. The counter (rather than comparing s back to |y|)
 * guarantees termination even when y is subnormal.
 *
 * locals: local2 = r (f64), local3 = s (f64), local4 = n (i32)
 */
function makeFmod(): number[] {
  return [
    0x02, 0x02, 0x7C, 0x01, 0x7F, // locals: 2 f64, 1 i32

    // NaN in, NaN out — checked first so no comparison below sees a NaN.
    0x20, 0x00, 0x20, 0x00, 0x62,             // x != x
    0x04, 0x40, 0x20, 0x00, 0x0F, 0x0B,       //   return x
    0x20, 0x01, 0x20, 0x01, 0x62,             // y != y
    0x04, 0x40, 0x20, 0x01, 0x0F, 0x0B,       //   return y

    0x20, 0x00, 0x99, 0x21, 0x02,             // r = |x|
    0x20, 0x01, 0x99, 0x21, 0x03,             // s = |y|

    // fmod(±inf, y) and fmod(x, 0) are both NaN.
    0x20, 0x02, ...f64Const(Infinity), 0x61,
    0x04, 0x40, ...f64Const(NaN), 0x0F, 0x0B,
    0x20, 0x03, ...f64Const(0), 0x61,
    0x04, 0x40, ...f64Const(NaN), 0x0F, 0x0B,

    // fmod(x, ±inf) = x, and |x| < |y| means x is already the remainder.
    // Both return x rather than r, which keeps -0.0 and negative x intact.
    0x20, 0x03, ...f64Const(Infinity), 0x61,
    0x04, 0x40, 0x20, 0x00, 0x0F, 0x0B,
    0x20, 0x02, 0x20, 0x03, 0x63,             // r < s
    0x04, 0x40, 0x20, 0x00, 0x0F, 0x0B,       //   return x

    0x41, 0x00, 0x21, 0x04,                   // n = 0

    // Scale s up to the largest |y|*2^n that is still <= r.
    0x02, 0x40, // block
    0x03, 0x40, // loop
      0x20, 0x03, ...f64Const(2), 0xA2,       // s * 2
      0x20, 0x02, 0x64,                       //   > r ?
      0x0D, 0x01,                             //   yes -> exit block
      0x20, 0x03, ...f64Const(2), 0xA2, 0x21, 0x03, // s *= 2
      0x20, 0x04, 0x41, 0x01, 0x6A, 0x21, 0x04,     // n++
      0x0C, 0x00,                             // continue
    0x0B,
    0x0B,

    // Reduce: n+1 passes, s stepping back down from |y|*2^n to |y|.
    0x02, 0x40, // block
    0x03, 0x40, // loop
      0x20, 0x02, 0x20, 0x03, 0x66,           // r >= s ?
      0x04, 0x40,
        0x20, 0x02, 0x20, 0x03, 0xA1, 0x21, 0x02, // r -= s (exact)
      0x0B,
      0x20, 0x04, 0x45, 0x0D, 0x01,           // n == 0 -> exit block
      0x20, 0x03, ...f64Const(0.5), 0xA2, 0x21, 0x03, // s *= 0.5
      0x20, 0x04, 0x41, 0x01, 0x6B, 0x21, 0x04,       // n--
      0x0C, 0x00,                             // continue
    0x0B,
    0x0B,

    0x20, 0x02, 0x20, 0x00, 0xA6,             // copysign(r, x)
    0x0B, // end
  ];
}

/**
 * __fmodf(x:f32, y:f32) -> f32 — f32 remainder via the f64 routine.
 *
 * Promoting to f64 is exact, and the true remainder of two f32 values is itself
 * exactly representable as an f32, so computing it in f64 and demoting gives
 * the exact result with no double rounding. Having this as its own helper also
 * keeps the emitter simple: both operands are already on the stack as f32, and
 * wasm has no way to reach past the top one to promote it.
 *
 * @param fmodIdx function index of __fmod
 */
function makeFmodF(fmodIdx: number): number[] {
  return [
    0x00,                                     // no locals
    0x20, 0x00, 0xBB,                         // f64.promote_f32(x)
    0x20, 0x01, 0xBB,                         // f64.promote_f32(y)
    0x10, ...uleb(fmodIdx),                   // call __fmod
    0xB6,                                     // f32.demote_f64
    0x0B, // end
  ];
}

function buildTypeSectionFull(ctx: WasmTypeCtxFull): number[] {
  const entries: number[][] = [];

  // Struct types: use "@typeIndex" key for unambiguous lookup when same-name structs exist
  for (const s of ctx.result.structs) {
    const allFields = ctx.structFields.get(`@${s.typeIndex}`) ?? ctx.structFields.get(s.name) ?? [];
    entries.push(encodeStructType(s, ctx, allFields));
  }

  // String type: mutable i8 array (needed for array.set/array.copy in helpers)
  entries.push([0x5E, 0x78, 0x01]);

  // Array types
  for (const elem of ctx.orderedArrayElems) {
    entries.push(encodeArrayType(elem, ctx));
  }

  // Function signature types
  for (const sig of ctx.orderedSigs) {
    entries.push(encodeFuncType(sig.params, sig.ret, ctx));
  }

  // String helper function signatures (after user sigs)
  const u8ArrIdx = ctx.arrTypeIdx.get(typeKey({ kind: "prim", name: "u8", line: 0, col: 0 }))!;
  for (const helperType of helperFuncTypes(ctx.stringTypeIdx, u8ArrIdx, ctx.coverage !== undefined)) {
    entries.push(helperType);
  }

  // Bind helper function signatures (after string helper sigs)
  for (const bh of ctx.bindHelpers) {
    entries.push(bh.funcTypeEntry);
  }

  // Wrap all types in a single rec group so they can mutually forward-reference.
  // V8 rejects forward references (e.g. struct field → later func sig) outside rec groups.
  const recGroup = [0x4E, ...uleb(entries.length), ...entries.flat()];
  return section(1, [0x01, ...recGroup]); // 1 rectype (the group)
}

/** Compute the type index of the Nth string helper signature. */
function helperTypeIdx(ctx: WasmTypeCtxFull, helperIdx: number): number {
  // type indices: structs + string + arrays + userSigs + helperIdx
  return ctx.result.structs.length + 1 + ctx.orderedArrayElems.length + ctx.orderedSigs.length + helperIdx;
}

// ── Function section ──────────────────────────────────────────────────────────

function buildFuncSection(ctx: WasmTypeCtxFull): number[] {
  // Each function entry: its function signature type index
  const typeIdxEntries: number[] = [];
  for (const f of ctx.result.funcs) {
    const params = fullParamTypes(f);
    const ret = funcReturnType(f);
    const k = sigKey(params, ret);
    const tIdx = ctx.sigTypeIdx.get(k)!;
    typeIdxEntries.push(...uleb(tIdx));
  }
  // Add builtin helper functions with their type indices
  // helper order: concat(0), cmp(1), idx(2), slice(3), indexof(4)
  for (let i = 0; i < builtinHelpers(ctx.coverage !== undefined).length; i++) {
    typeIdxEntries.push(...uleb(helperTypeIdx(ctx, i)));
  }
  // Add bind helper functions: their type indices follow the builtin helper sigs
  const bindBaseTypeIdx = helperTypeIdx(ctx, builtinHelpers(ctx.coverage !== undefined).length);
  for (let i = 0; i < ctx.bindHelpers.length; i++) {
    typeIdxEntries.push(...uleb(bindBaseTypeIdx + i));
  }
  const totalFuncs = ctx.result.funcs.length + builtinHelpers(ctx.coverage !== undefined).length + ctx.bindHelpers.length;
  return section(3, [...uleb(totalFuncs), ...typeIdxEntries]);
}

// ── Export section ────────────────────────────────────────────────────────────

function buildExportSection(result: ResolveResult, ctx: WasmTypeCtxFull): number[] {
  // Only export functions from the entry file (imports are internal to the module)
  const exported = result.funcs.filter(f => f.exportName !== null && f.filePath === result.entryPath);
  const entries: number[][] = exported.map(f => {
    const nameBytes = new TextEncoder().encode(f.exportName!);
    return [...uleb(nameBytes.length), ...nameBytes, 0x00, ...uleb(f.funcIndex)];
  });
  // Export the staging buffer so the host can write into and read out of it.
  {
    const nameBytes = new TextEncoder().encode("__bind_mem");
    entries.push([...uleb(nameBytes.length), ...nameBytes, 0x02, 0x00]);  // kind 2 = memory
  }
  // Export the coverage helpers so a host can reset and read the counters.
  if (ctx.coverage) {
    for (const name of COVERAGE_HELPERS) {
      const nameBytes = new TextEncoder().encode(name);
      entries.push([...uleb(nameBytes.length), ...nameBytes, 0x00,
        ...uleb(ctx.helperIdx.get(name)!)]);
    }
  }
  // Also export bind helpers so generated TS wrappers can call them
  const bindBaseIdx = result.funcs.length + builtinHelpers(ctx.coverage !== undefined).length; // after the builtin helpers
  for (let i = 0; i < ctx.bindHelpers.length; i++) {
    const nameBytes = new TextEncoder().encode(ctx.bindHelpers[i].name);
    entries.push([...uleb(nameBytes.length), ...nameBytes, 0x00, ...uleb(bindBaseIdx + i)]);
  }
  return section(7, vec(entries));
}

// ── Code section ──────────────────────────────────────────────────────────────

function buildCodeSection(ctx: WasmTypeCtxFull): number[] {
  const bodies: number[][] = [];
  for (const f of ctx.result.funcs) {
    const bodyBytes = wacEmitFunc(f, ctx);
    bodies.push([...uleb(bodyBytes.length), ...bodyBytes]);
  }
  // Append the builtin helper function bodies. This must come after the user
  // bodies above: emitting them is what discovers the coverage points, and
  // __cov_init/__cov_len are built from the final count.
  const helperBodies = buildHelperBodies(
    ctx.stringTypeIdx,
    ctx.arrTypeIdx.get(typeKey({ kind: "prim", name: "u8", line: 0, col: 0 }))!,
    ctx.helperIdx.get("__fmod")!,
    ctx.coverage
      ? { arrTypeIdx: covArrayTypeIdx(ctx), numPoints: ctx.coverage.points.length }
      : undefined,
  );
  for (const b of helperBodies) {
    bodies.push([...uleb(b.length), ...b]);
  }
  // Append bind helper bodies
  for (const bh of ctx.bindHelpers) {
    bodies.push([...uleb(bh.body.length), ...bh.body]);
  }
  return section(10, vec(bodies));
}

/** Type index of the i32 array holding coverage counters. */
function covArrayTypeIdx(ctx: WasmTypeCtxFull): number {
  return ctx.arrTypeIdx.get("i32")!;
}

/**
 * Global section (id 6) — only emitted when instrumenting.
 *
 * One mutable global holding the counter array, typed nullable and initialised to
 * ref.null so the initialiser stays a constant expression. That avoids depending
 * on array.new_default being permitted in a global initialiser, which engines
 * vary on. __cov_init fills it in.
 *
 * Section id 6 sits between the function (3) and export (7) sections; wasm
 * requires sections in ascending order.
 */
function buildGlobalSection(ctx: WasmTypeCtxFull): number[] {
  if (!ctx.coverage) return [];
  const t = covArrayTypeIdx(ctx);
  const global = [
    0x63, ...sleb(t),        // (ref null $covArray)
    0x01,                    // mutable
    0xD0, ...sleb(t), 0x0B,  // ref.null $covArray; end
  ];
  return section(6, vec([global]));
}

// ── Element section ───────────────────────────────────────────────────────────

/** Declarative element section: declares all functions that may be used via ref.func. */
function buildElemSection(result: ResolveResult): number[] {
  const n = result.funcs.length;
  if (n === 0) return [];
  // flags=3: declarative, elemkind=0x00 (funcref), then func indices
  const segment = [0x03, 0x00, ...uleb(n), ...result.funcs.flatMap(f => uleb(f.funcIndex))];
  return section(9, vec([segment]));
}

// ── Main export ───────────────────────────────────────────────────────────────

/** Assemble a complete .wasm binary from a resolved wac program. */
export function wasmBuildBin(
  result: ResolveResult,
  programs: Map<string, unknown>,
  options: { coverage?: CoverageCtx } = {},
): Uint8Array {
  const ctx = buildTypeCtxFull(result, programs, options.coverage !== undefined);
  ctx.coverage = options.coverage;

  const MAGIC   = [0x00, 0x61, 0x73, 0x6D];
  const VERSION = [0x01, 0x00, 0x00, 0x00];

  // The code section is built first because emitting the bodies is what
  // discovers the coverage points, and the global and export sections depend on
  // knowing whether there are any. Section *bytes* are still concatenated in
  // ascending id order below, which is what wasm requires.
  const codeSection   = buildCodeSection(ctx);
  const typeSection   = buildTypeSectionFull(ctx);
  const funcSection   = buildFuncSection(ctx);
  const memorySection = buildMemorySection();
  const globalSection = buildGlobalSection(ctx);
  const exportSection = buildExportSection(result, ctx);
  const elemSection   = buildElemSection(result);

  return new Uint8Array([
    ...MAGIC, ...VERSION,
    ...typeSection, ...funcSection, ...memorySection, ...globalSection,
    ...exportSection, ...elemSection, ...codeSection,
  ]);
}
