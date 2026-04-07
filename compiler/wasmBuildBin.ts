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

type WasmTypeCtxFull = WasmTypeCtx & {
  orderedArrayElems: WacType[];
  orderedSigs: { params: WacType[]; ret: WacType }[];
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

  return { ...base, orderedArrayElems, orderedSigs };
}

function buildTypeSectionFull(ctx: WasmTypeCtxFull): number[] {
  const entries: number[][] = [];

  // Struct types: use "@typeIndex" key for unambiguous lookup when same-name structs exist
  for (const s of ctx.result.structs) {
    const allFields = ctx.structFields.get(`@${s.typeIndex}`) ?? ctx.structFields.get(s.name) ?? [];
    entries.push(encodeStructType(s, ctx, allFields));
  }

  // String type: immutable i8 array
  entries.push([0x5E, 0x78, 0x00]);

  // Array types
  for (const elem of ctx.orderedArrayElems) {
    entries.push(encodeArrayType(elem, ctx));
  }

  // Function signature types
  for (const sig of ctx.orderedSigs) {
    entries.push(encodeFuncType(sig.params, sig.ret, ctx));
  }

  // Wrap all types in a single rec group so they can mutually forward-reference.
  // V8 rejects forward references (e.g. struct field → later func sig) outside rec groups.
  const recGroup = [0x4E, ...uleb(entries.length), ...entries.flat()];
  return section(1, [0x01, ...recGroup]); // 1 rectype (the group)
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
  return section(3, [...uleb(ctx.result.funcs.length), ...typeIdxEntries]);
}

// ── Export section ────────────────────────────────────────────────────────────

function buildExportSection(result: ResolveResult): number[] {
  // Only export functions from the entry file (imports are internal to the module)
  const exported = result.funcs.filter(f => f.exportName !== null && f.filePath === result.entryPath);
  const entries: number[][] = exported.map(f => {
    const nameBytes = new TextEncoder().encode(f.exportName!);
    return [...uleb(nameBytes.length), ...nameBytes, 0x00, ...uleb(f.funcIndex)];
  });
  return section(7, vec(entries));
}

// ── Code section ──────────────────────────────────────────────────────────────

function buildCodeSection(ctx: WasmTypeCtxFull): number[] {
  const bodies: number[][] = [];
  for (const f of ctx.result.funcs) {
    const bodyBytes = wacEmitFunc(f, ctx);
    bodies.push([...uleb(bodyBytes.length), ...bodyBytes]);
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
  const exportSection = buildExportSection(result);
  const elemSection   = buildElemSection(result);
  const codeSection   = buildCodeSection(ctx);

  return new Uint8Array([
    ...MAGIC, ...VERSION,
    ...typeSection, ...funcSection, ...exportSection, ...elemSection, ...codeSection,
  ]);
}
