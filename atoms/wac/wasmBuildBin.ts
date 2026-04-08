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
  type WasmTypeCtx, type StructFieldInfo,
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
      kind: "struct", name: f.origin.structName, line: 0, col: 0,
    } as WacType;
    return [thisType, ...declared];
  }
  return declared;
}

// ── Type section encoding helpers ─────────────────────────────────────────────

/** Wasm packed type byte for i8/i16 array elements. */
function packedType(name: string): number {
  if (name === "i8")  return 0x78;
  if (name === "i16") return 0x77;
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
    const parent = s.structDecl.parent;
    // Look up parent fields by typeIndex to handle name collisions
    const parentEntry = parent ? structs.find(x => x.name === parent && x.filePath === s.filePath)
      ?? structs.find(x => x.name === parent) : null;
    const parentFields = parentEntry ? (byIdx.get(parentEntry.typeIndex) ?? []) : [];
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
  const structParent = new Map<string, string | null>(
    result.structs.map(s => [s.name, s.structDecl.parent ?? null]),
  );
  // Add alias entries for structFields and structParent too.
  for (const scope of result.fileScopes.values()) {
    for (const [alias, entry] of scope) {
      if (entry.kind === "struct" && !structFields.has(alias)) {
        // Use "@typeIndex" key for unambiguous lookup (handles same-name structs from different files)
        const fields = structFields.get(`@${entry.entry.typeIndex}`) ?? [];
        structFields.set(alias, fields);
        const parentName = entry.entry.structDecl.parent ?? null;
        structParent.set(alias, parentName);
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
    structFields, structParent, funcIdx, result,
    strHelperIdx: new Map<string, number>(),
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
  const parent = s.structDecl.parent;
  const isParent = [...ctx.structParent.values()].some(p => p === s.name);

  // Encode all fields (inherited + own)
  const fieldsBytes: number[] = [];
  fieldsBytes.push(...uleb(allFields.length)); // field count
  for (const f of allFields) {
    const mutable = !f.isConst;
    fieldsBytes.push(...fieldType(f.type, ctx, mutable));
  }
  const structBody = [0x5F, ...fieldsBytes]; // 0x5F = struct

  if (parent !== null && parent !== undefined) {
    const parentIdx = ctx.structTypeIdx.get(parent)!;
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
  if (elem.kind === "prim" && (elem.name === "i8" || elem.name === "i16")) {
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
  const prims = new Set(["i32","i64","f32","f64","bool","i8","i16","anyref","i31ref","string"]);
  if (prims.has(key)) return { kind: "prim", name: key, ...p };
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
  strHelperIdx: Map<string, number>;
  /** Bind helpers (string + array accessors) exported for use by generated TS. */
  bindHelpers: BindHelperSpec[];
};

function buildTypeCtxFull(
  result: ResolveResult,
  programs: Map<string, unknown>,
): WasmTypeCtxFull {
  const base = buildTypeCtx(result, programs);

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

  // String helper function indices: placed after all user functions
  const numUserFuncs = base.result.funcs.length;
  const helperNames = ["__str_concat", "__str_cmp", "__str_idx", "__str_slice", "__str_indexof"];
  const strHelperIdx = new Map<string, number>();
  for (let i = 0; i < helperNames.length; i++) {
    strHelperIdx.set(helperNames[i], numUserFuncs + i);
  }

  // Populate base.strHelperIdx (WasmTypeCtx) and the full ctx one
  base.strHelperIdx = strHelperIdx;

  // Bind helpers come after the 5 string helpers
  const partialCtx = { ...base, orderedArrayElems, orderedSigs, strHelperIdx };
  const bindHelpers = buildBindHelpers(result, partialCtx);

  return { ...partialCtx, bindHelpers };
}

// ── String helper function signatures ─────────────────────────────────────────
// All helpers use non-null string ref (0x64 sleb(si)) for string params/results.

/** Return the 5 string helper function type entries for the type section. */
function strHelperFuncTypes(si: number): number[][] {
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
  return [concat, cmp, idx, slice, iof];
}


/** Build all 5 string helper function bodies. Returns raw bytes for code section. */
function buildStrHelperBodies(si: number): number[] {
  const bodies: number[][] = [];
  bodies.push(makeConcat(si));
  bodies.push(makeCmp(si));
  bodies.push(makeIdx(si));
  bodies.push(makeSlice(si));
  bodies.push(makeIndexOf(si));
  // Wrap each body: [uleb(len), ...body_with_end]
  const encoded: number[] = [];
  for (const b of bodies) {
    encoded.push(...uleb(b.length), ...b);
  }
  return encoded;
}

// ── Bind helpers (accessor functions exported for JS bindgen use) ─────────────

/** Return the wasm element value type for a primitive element type at JS boundary.
 *  Packed types (i8, i16) are passed as i32. */
function bindElemValType(elem: WacType): number[] {
  if (elem.kind !== "prim") return [0x7F]; // fallback i32
  const map: Record<string, number> = {
    i8: 0x7F, i16: 0x7F, i32: 0x7F,
    i64: 0x7E, f32: 0x7D, f64: 0x7C,
  };
  return [map[elem.name] ?? 0x7F];
}

/** Return the array.get opcode byte for a given element type. */
function arrGetOp(elem: WacType): number {
  const name = elem.kind === "prim" ? elem.name : "";
  return (name === "i8" || name === "i16") ? 0x0D : 0x0B; // array.get_u or array.get
}

/** Build the bind helper specs needed for a compiled wac module. */
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
  for (const helperType of strHelperFuncTypes(ctx.stringTypeIdx)) {
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
function strHelperTypeIdx(ctx: WasmTypeCtxFull, helperIdx: number): number {
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
  // Add 5 string helper functions with their type indices
  // helper order: concat(0), cmp(1), idx(2), slice(3), indexof(4)
  for (let i = 0; i < 5; i++) {
    typeIdxEntries.push(...uleb(strHelperTypeIdx(ctx, i)));
  }
  // Add bind helper functions: their type indices follow the 5 string helper sigs
  const bindBaseTypeIdx = strHelperTypeIdx(ctx, 5); // = baseTypeIdx + 5 string helper sigs
  for (let i = 0; i < ctx.bindHelpers.length; i++) {
    typeIdxEntries.push(...uleb(bindBaseTypeIdx + i));
  }
  const totalFuncs = ctx.result.funcs.length + 5 + ctx.bindHelpers.length;
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
  // Also export bind helpers so generated TS wrappers can call them
  const bindBaseIdx = result.funcs.length + 5; // after 5 string helpers
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
  // Append the 5 string helper function bodies (each already size-prefixed)
  const helperBytes = buildStrHelperBodies(ctx.stringTypeIdx);
  // helperBytes already contains [uleb(len), ...body] for each of the 5 helpers,
  // so we need to split them into individual prefixed entries.
  // Actually buildStrHelperBodies returns them concatenated; re-encode as separate bodies.
  const si = ctx.stringTypeIdx;
  const helperBodies = [makeConcat(si), makeCmp(si), makeIdx(si), makeSlice(si), makeIndexOf(si)];
  for (const b of helperBodies) {
    bodies.push([...uleb(b.length), ...b]);
  }
  // Append bind helper bodies
  for (const bh of ctx.bindHelpers) {
    bodies.push([...uleb(bh.body.length), ...bh.body]);
  }
  return section(10, vec(bodies));
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
): Uint8Array {
  const ctx = buildTypeCtxFull(result, programs);

  const MAGIC   = [0x00, 0x61, 0x73, 0x6D];
  const VERSION = [0x01, 0x00, 0x00, 0x00];

  const typeSection   = buildTypeSectionFull(ctx);
  const funcSection   = buildFuncSection(ctx);
  const exportSection = buildExportSection(result, ctx);
  const elemSection   = buildElemSection(result);
  const codeSection   = buildCodeSection(ctx);

  return new Uint8Array([
    ...MAGIC, ...VERSION,
    ...typeSection, ...funcSection, ...exportSection, ...elemSection, ...codeSection,
  ]);
}
