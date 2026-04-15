// Assembles a complete .wasm binary from a TypedModule.
// Emits the type, function, export, and code sections with WasmGC types.
// GC struct and array types are wrapped in a single rec group (to allow
// self/mutual references). Function signature types follow individually.

import type { TypedModule } from "./wacTypeCheck.ts";
import type { WacType, FieldDecl, MethodDecl, FuncDecl, StructDecl, Block, Stmt, ForInit } from "./ast.ts";
import type { ResolvedModule } from "./wacResolve.ts";
import { wacEmitFunc, type EmitCtx, type EmitFunc } from "./wacEmitFunc.ts";

// ---- Exported types ----

export type WacParam   = { name: string; type: string };
export type WacExport  = { name: string; params: WacParam[]; ret: string };
export type WacCompiled = { wasm: Uint8Array; exports: WacExport[] };

// ---- Main export ----

export function wasmBuildBin(typed: TypedModule): WacCompiled {
  const { resolved, exprType } = typed;

  // 1. Struct types in topological order (parents before children).
  const orderedStructs = topoStructs(resolved);
  const structTypeIdx = new Map<string, number>(orderedStructs.map((n, i) => [n, i] as [string, number]));

  // 2. Array element types: i8 first (for string), then all others found in program.
  const arrayElems: WacType[] = [{ tag: "i8" }];
  function addArrayElem(t: WacType): void {
    if (!arrayElems.some(e => typeEq(e, t))) arrayElems.push(t);
  }
  // Resolve local struct names in a type to canonical names via the file's env.
  function resolveTypeForFile(t: WacType, filePath: string): WacType {
    const env = resolved.envs.get(filePath);
    function res(t: WacType): WacType {
      if (t.tag === "named")    return { tag: "named", name: env?.structs.get(t.name) ?? t.name };
      if (t.tag === "array")    return { tag: "array", elem: res(t.elem) };
      if (t.tag === "nullable") return { tag: "nullable", inner: res(t.inner) };
      if (t.tag === "funcref")  return { tag: "funcref", ret: res(t.ret), params: t.params.map(res) };
      return t;
    }
    return res(t);
  }
  function scanForArrayElems(t: WacType): void {
    if (t.tag === "string")   { addArrayElem({ tag: "i8" }); return; }
    if (t.tag === "array")    { addArrayElem(t.elem); scanForArrayElems(t.elem); return; }
    if (t.tag === "nullable") { scanForArrayElems(t.inner); return; }
    if (t.tag === "funcref")  { for (const p of t.params) scanForArrayElems(p); scanForArrayElems(t.ret); }
  }
  for (const [, rs] of resolved.structs) {
    for (const f of rs.decl.fields) scanForArrayElems(resolveTypeForFile(f.type, rs.filePath));
  }
  for (const [, rf] of resolved.funcs) {
    for (const p of rf.decl.params) scanForArrayElems(resolveTypeForFile(p.type, rf.filePath));
    scanForArrayElems(resolveTypeForFile(rf.decl.returnType, rf.filePath));
  }
  for (const [, rs] of resolved.structs) {
    for (const m of rs.decl.methods) {
      for (const p of m.params) scanForArrayElems(resolveTypeForFile(p.type, rs.filePath));
      scanForArrayElems(resolveTypeForFile(m.returnType, rs.filePath));
    }
  }
  // Scan local variable declarations in function and method bodies.
  function scanBlock(block: Block, filePath: string): void {
    for (const stmt of block.stmts) scanStmt(stmt, filePath);
  }
  function scanStmt(stmt: Stmt, filePath: string): void {
    if (stmt.tag === "var") { scanForArrayElems(resolveTypeForFile(stmt.type, filePath)); return; }
    if (stmt.tag === "if") {
      scanBlock(stmt.then, filePath);
      if (stmt.else_) { if ("stmts" in stmt.else_) scanBlock(stmt.else_, filePath); else scanStmt(stmt.else_, filePath); }
      return;
    }
    if (stmt.tag === "while")  { scanBlock(stmt.body, filePath); return; }
    if (stmt.tag === "for")    {
      if (stmt.init?.tag === "var") scanForArrayElems(resolveTypeForFile(stmt.init.type, filePath));
      scanBlock(stmt.body, filePath); return;
    }
    if (stmt.tag === "dowhile") { scanBlock(stmt.body, filePath); return; }
    if (stmt.tag === "block")   { scanBlock(stmt.block, filePath); return; }
    if (stmt.tag === "switch") {
      for (const c of stmt.cases) for (const s of c.body) scanStmt(s, filePath);
      if (stmt.default_) for (const s of stmt.default_) scanStmt(s, filePath);
    }
  }
  for (const [, rf] of resolved.funcs)    scanBlock(rf.decl.body, rf.filePath);
  for (const [, rs] of resolved.structs)  for (const m of rs.decl.methods) scanBlock(m.body, rs.filePath);

  const arrBase = orderedStructs.length;
  const arrayTypeIdx = (elem: WacType): number => {
    const i = arrayElems.findIndex(e => typeEq(e, elem));
    if (i < 0) throw new Error(`wasmBuildBin: unknown array elem ${JSON.stringify(elem)}`);
    return arrBase + i;
  };

  // 3. Function signatures: collected lazily via funcSigIdx.
  const sigBase = arrBase + arrayElems.length;
  const funcSigs: Array<{ params: WacType[]; ret: WacType }> = [];
  const funcSigIdx = (params: WacType[], ret: WacType): number => {
    let i = funcSigs.findIndex(s =>
      typeEq(s.ret, ret) && s.params.length === params.length &&
      s.params.every((p, j) => typeEq(p, params[j]!)));
    if (i < 0) { funcSigs.push({ params, ret }); i = funcSigs.length - 1; }
    return sigBase + i;
  };

  // 4. Function list: regular functions followed by struct methods.
  type RegularFuncEntry = { isPrebuilt: false; mangledName: string; fn: EmitFunc; isExport: boolean; exportName?: string; filePath: string };
  type PrebuiltFuncEntry = { isPrebuilt: true; mangledName: string; params: WacType[]; ret: WacType; body: number[]; isExport: boolean };
  type FuncEntry = RegularFuncEntry | PrebuiltFuncEntry;
  const funcList: FuncEntry[] = [];
  const funcIdx = new Map<string, number>();

  for (const [mname, rf] of resolved.funcs) {
    funcIdx.set(mname, funcList.length);
    funcList.push({
      isPrebuilt: false,
      mangledName: mname,
      fn: declToEmitFunc(rf.decl),
      isExport: rf.isWasmExport,
      exportName: rf.isWasmExport ? rf.decl.name : undefined,
      filePath: rf.filePath,
    });
  }
  for (const [canonicalStructName, rs] of resolved.structs) {
    for (const m of rs.decl.methods) {
      // Use canonical struct name in method key so lookup works with canonical types.
      const mname = `${canonicalStructName}$${m.name}`;
      funcIdx.set(mname, funcList.length);
      funcList.push({
        isPrebuilt: false,
        mangledName: mname,
        fn: methodToEmitFunc(m, canonicalStructName),
        isExport: false,
        filePath: rs.filePath,
      });
    }
  }

  // String helpers: pre-built wasm bytecode for string operations.
  const strHelpers = buildStringHelpers(arrayTypeIdx({ tag: "i8" }));
  const strHelperFuncIdxMap = new Map<string, number>();
  for (const h of strHelpers) {
    const mname = `$wac_str_${h.name}`;
    strHelperFuncIdxMap.set(h.name, funcList.length);
    funcIdx.set(mname, funcList.length);
    funcList.push({
      isPrebuilt: true,
      mangledName: mname,
      params: h.params,
      ret: h.ret,
      body: h.body,
      isExport: false,
    });
  }
  const stringHelperIdx = (name: string): number => {
    const idx = strHelperFuncIdxMap.get(name);
    if (idx === undefined) throw new Error(`unknown string helper: ${name}`);
    return idx;
  };

  // Pre-register nested funcref sigs depth-first (innermost first) to avoid forward
  // references in the type section. A func sig encoding ref null $N requires type $N
  // to already have been emitted (no forward refs allowed outside rec groups).
  function preScanFuncSigs(t: WacType): void {
    if (t.tag === "funcref") {
      // Recurse into params/ret first, then register this sig (post-order = inner first).
      for (const p of t.params) preScanFuncSigs(p);
      preScanFuncSigs(t.ret);
      funcSigIdx(t.params, t.ret);
    } else if (t.tag === "array")    { preScanFuncSigs(t.elem); }
    else if (t.tag === "nullable")   { preScanFuncSigs(t.inner); }
  }
  // Scan struct fields for nested funcref types first.
  for (const [, rs] of resolved.structs) {
    for (const f of rs.decl.fields) preScanFuncSigs(f.type);
  }
  // Scan all function param/return types for nested funcrefs (use canonical types).
  for (const fe of funcList) {
    if (fe.isPrebuilt) {
      for (const p of fe.params) preScanFuncSigs(p);
      preScanFuncSigs(fe.ret);
    } else {
      const resolve = (t: WacType) => resolveTypeForFile(t, fe.filePath);
      for (const p of fe.fn.params) preScanFuncSigs(resolve(p.type));
      preScanFuncSigs(resolve(fe.fn.returnType));
    }
  }

  // Pre-register all function signatures (bodies may add more via funcSigIdx).
  // All nested funcref sigs are already registered above, so no forward references.
  // Use resolved (canonical) types so struct names in sigs map to correct type indices.
  for (const fe of funcList) {
    if (fe.isPrebuilt) {
      funcSigIdx(fe.params, fe.ret);
    } else {
      const resolve = (t: WacType) => resolveTypeForFile(t, fe.filePath);
      funcSigIdx(fe.fn.params.map(p => resolve(p.type)), resolve(fe.fn.returnType));
    }
  }

  // 5. Emit function bodies.
  // wacEmitFunc looks up funcIdx by the name as it appears in the AST:
  //   - For regular calls: the LOCAL name (e.g. "factorial"), not the mangled name
  //   - For static/instance method calls: "StructName$methodName" (already mangled)
  // Build a per-function funcIdx that maps local names (via NameEnv) + struct method
  // mangled names to function indices.
  // Struct method keys are now "canonicalStructName$methodName".
  const structMethodNames = [...funcIdx.keys()].filter(k => {
    // A struct method key contains $ and its prefix (up to last $) is a canonical struct name.
    const lastDollar = k.lastIndexOf("$");
    return lastDollar > 0 && resolved.structs.has(k.slice(0, lastDollar));
  });

  function buildLocalFuncIdx(filePath: string): Map<string, number> {
    const env = resolved.envs.get(filePath);
    const m = new Map<string, number>();
    // Local function names → indices (via mangled name lookup).
    if (env) {
      for (const [localName, mangledName] of env.funcs) {
        const idx = funcIdx.get(mangledName);
        if (idx !== undefined) m.set(localName, idx);
      }
      // Also add canonical struct method names visible to this file.
      // For each struct in this file's env, add its method mangled names.
      for (const [, canonicalName] of env.structs) {
        for (const [key, idx] of funcIdx) {
          if (key.startsWith(canonicalName + "$")) m.set(key, idx);
        }
      }
    }
    // All struct method canonical names are visible everywhere (for inherited method dispatch).
    for (const mname of structMethodNames) {
      const idx = funcIdx.get(mname);
      if (idx !== undefined) m.set(mname, idx);
    }
    return m;
  }

  const bodies: Uint8Array[] = funcList.map(fe => {
    if (fe.isPrebuilt) {
      return new Uint8Array(fe.body);
    }
    const localFuncIdx = buildLocalFuncIdx(fe.filePath);
    const fileEnv = resolved.envs.get(fe.filePath);
    const ctx: EmitCtx = {
      structTypeIdx, arrayTypeIdx, funcSigIdx,
      funcIdx: localFuncIdx,
      structAllFields: (name) => allFieldsOf(resolved, name),
      structParent: (name) => canonicalParent(resolved, name),
      // Resolve a local struct name (e.g., "Point") to its canonical name (e.g., "m$Point").
      resolveStructName: (name) => fileEnv?.structs.get(name) ?? name,
      exprType,
      stringHelperIdx,
    };
    return wacEmitFunc(ctx, fe.fn);
  });
  const funcTypeIdxs: number[] = funcList.map(fe => {
    if (fe.isPrebuilt) return funcSigIdx(fe.params, fe.ret);
    const resolve = (t: WacType) => resolveTypeForFile(t, fe.filePath);
    return funcSigIdx(fe.fn.params.map(p => resolve(p.type)), resolve(fe.fn.returnType));
  });

  // 6. Assemble binary.
  const exporter = funcList
    .map((fe, i) => (fe.isExport && !fe.isPrebuilt ? { name: (fe as RegularFuncEntry).exportName!, idx: i } : null))
    .filter((e): e is { name: string; idx: number } => e !== null);

  // Compute set of structs that are extended (must be encoded as open sub types).
  // Use canonical names since orderedStructs / structTypeIdx use canonical names.
  const parentStructs = new Set<string>();
  for (const [k] of resolved.structs) {
    const parent = canonicalParent(resolved, k);
    if (parent) parentStructs.add(parent);
  }

  const wasm = buildBinary(
    orderedStructs, resolved, structTypeIdx,
    arrayElems, arrayTypeIdx,
    funcSigs, sigBase,
    funcTypeIdxs, exporter, bodies,
    parentStructs,
    funcSigIdx,
  );

  // 7. Export metadata.
  const exports: WacExport[] = funcList
    .filter(fe => fe.isExport && !fe.isPrebuilt)
    .map(fe => ({
      name: (fe as RegularFuncEntry).exportName!,
      params: (fe as RegularFuncEntry).fn.params.map(p => ({ name: p.name, type: typeStr(p.type) })),
      ret: typeStr((fe as RegularFuncEntry).fn.returnType),
    }));

  return { wasm, exports };
}

// ---- Binary assembly ----

function buildBinary(
  orderedStructs: string[],
  resolved: ResolvedModule,
  structTypeIdx: Map<string, number>,
  arrayElems: WacType[],
  arrayTypeIdx: (elem: WacType) => number,
  funcSigs: Array<{ params: WacType[]; ret: WacType }>,
  sigBase: number,
  funcTypeIdxs: number[],
  exporter: Array<{ name: string; idx: number }>,
  bodies: Uint8Array[],
  parentStructs: Set<string>,
  funcSigIdx?: (params: WacType[], ret: WacType) => number,
): Uint8Array {
  const enc: number[] = [0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00];

  // ---- Type section ----
  // All types (GC structs, arrays, func sigs) go in a single rec group when GC types
  // are present. This allows struct fields to reference func sig types without creating
  // forward references outside a rec group, which the wasm spec forbids.
  const gcCount = orderedStructs.length + arrayElems.length;
  const totalTypeCount = gcCount + funcSigs.length;
  const typeEntries: number[] = [];

  if (totalTypeCount > 0) {
    if (gcCount > 0) {
      // Single rec group containing ALL types (structs, arrays, and func sigs).
      // Mutual references between struct fields and func sigs are allowed inside a rec group.
      const groupEntries: number[] = [];
      for (const name of orderedStructs) {
        groupEntries.push(...encodeStructTypeDef(name, resolved, structTypeIdx, arrayTypeIdx, parentStructs, funcSigIdx));
      }
      for (const elem of arrayElems) {
        groupEntries.push(...encodeArrayTypeDef(elem, structTypeIdx, arrayTypeIdx, funcSigIdx));
      }
      for (const sig of funcSigs) {
        groupEntries.push(...encodeFuncSig(sig, structTypeIdx, arrayTypeIdx, funcSigIdx));
      }
      typeEntries.push(0x4E, ...uleb(totalTypeCount), ...groupEntries);
      enc.push(...section(1, [...uleb(1), ...typeEntries]));  // 1 rec group entry
    } else {
      // No GC types — emit func sigs as individual type entries.
      for (const sig of funcSigs) {
        typeEntries.push(...encodeFuncSig(sig, structTypeIdx, arrayTypeIdx, funcSigIdx));
      }
      enc.push(...section(1, [...uleb(funcSigs.length), ...typeEntries]));
    }
  }

  // ---- Function section ----
  enc.push(...section(3, [...uleb(funcTypeIdxs.length), ...funcTypeIdxs.flatMap(i => uleb(i))]));

  // ---- Export section ----
  const expBytes: number[] = [];
  for (const e of exporter) {
    const nb = new TextEncoder().encode(e.name);
    expBytes.push(...uleb(nb.length), ...nb, 0x00, ...uleb(e.idx));
  }
  enc.push(...section(7, [...uleb(exporter.length), ...expBytes]));

  // ---- Element section (declarative funcref segment) ----
  // Required for ref.func instructions (used by funcref values).
  // A declarative element segment makes all functions referenceable.
  if (funcTypeIdxs.length > 0) {
    const indices = Array.from({ length: funcTypeIdxs.length }, (_, i) => i);
    const elemSeg = [0x03, 0x00, ...uleb(indices.length), ...indices.flatMap(i => uleb(i))];
    enc.push(...section(9, [...uleb(1), ...elemSeg]));
  }

  // ---- Code section ----
  const codeEntries: number[] = [];
  for (const b of bodies) codeEntries.push(...uleb(b.length), ...b);
  enc.push(...section(10, [...uleb(bodies.length), ...codeEntries]));

  return new Uint8Array(enc);
}

function section(id: number, content: number[]): number[] {
  return [id, ...uleb(content.length), ...content];
}

// ---- Type definition encoding ----

function encodeStructTypeDef(
  name: string,
  resolved: ResolvedModule,
  structTypeIdx: Map<string, number>,
  arrayTypeIdx: (elem: WacType) => number,
  parentStructs: Set<string>,
  funcSigIdx?: (params: WacType[], ret: WacType) => number,
): number[] {
  const rs = resolved.structs.get(name)!;
  // Encode ALL fields (inherited first, then own) so struct.new receives them all.
  const allFields = allFieldsOf(resolved, name);
  const fieldBytes: number[] = [];
  for (const f of allFields) {
    fieldBytes.push(...encodeFieldType(f.type, structTypeIdx, arrayTypeIdx, funcSigIdx));
    fieldBytes.push(f.isConst ? 0x00 : 0x01);  // mutability
  }
  const structDef = [0x5F, ...uleb(allFields.length), ...fieldBytes];
  // Use canonical parent name (decl.parent is local; canonicalParent resolves via file env).
  const canonParent = canonicalParent(resolved, name);
  if (canonParent !== undefined) {
    // 0x50 = sub type, 1 supertype, parent index, then struct def.
    return [0x50, 0x01, ...uleb(structTypeIdx.get(canonParent)!), ...structDef];
  }
  if (parentStructs.has(name)) {
    // Open sub type (can be extended): 0x50 = sub, 0x00 = no supertypes, then struct def.
    return [0x50, 0x00, ...structDef];
  }
  return structDef;
}

function encodeArrayTypeDef(
  elem: WacType,
  structTypeIdx: Map<string, number>,
  arrayTypeIdx: (elem: WacType) => number,
  funcSigIdx?: (params: WacType[], ret: WacType) => number,
): number[] {
  // Array type: 0x5E <elem_field_type> <mutability=1>
  return [0x5E, ...encodeFieldType(elem, structTypeIdx, arrayTypeIdx, funcSigIdx), 0x01];
}

function encodeFuncSig(
  sig: { params: WacType[]; ret: WacType },
  structTypeIdx: Map<string, number>,
  arrayTypeIdx: (elem: WacType) => number,
  funcSigIdx?: (params: WacType[], ret: WacType) => number,
): number[] {
  const paramBytes = sig.params.flatMap(p => encodeValType(p, structTypeIdx, arrayTypeIdx, funcSigIdx));
  if (sig.ret.tag === "void") {
    return [0x60, ...uleb(sig.params.length), ...paramBytes, 0x00];
  }
  const retBytes = encodeValType(sig.ret, structTypeIdx, arrayTypeIdx, funcSigIdx);
  return [0x60, ...uleb(sig.params.length), ...paramBytes, 0x01, ...retBytes];
}

// ValType encoding: used in function signatures and local variable slots.
function encodeValType(
  t: WacType,
  sIdx: Map<string, number>,
  aIdx: (e: WacType) => number,
  fSig?: (params: WacType[], ret: WacType) => number,
): number[] {
  switch (t.tag) {
    case "i32": case "bool": return [0x7F];
    case "i64":  return [0x7E];
    case "f32":  return [0x7D];
    case "f64":  return [0x7C];
    case "anyref": return [0x6E];
    case "i31ref": return [0x6C];
    case "string": return [0x64, ...uleb(aIdx({ tag: "i8" }))];
    case "named":  return [0x64, ...uleb(sIdx.get(t.name)!)];
    case "array":  return [0x64, ...uleb(aIdx(t.elem))];
    case "nullable": {
      const i = t.inner;
      if (i.tag === "named")   return [0x63, ...uleb(sIdx.get(i.name)!)];
      if (i.tag === "array")   return [0x63, ...uleb(aIdx(i.elem))];
      if (i.tag === "anyref")  return [0x6E];
      if (i.tag === "i31ref")  return [0x6C];
      if (i.tag === "string")  return [0x63, ...uleb(aIdx({ tag: "i8" }))];
      if (i.tag === "funcref") {
        if (fSig) return [0x63, ...uleb(fSig(i.params, i.ret))];
        return [0x63, 0x70];  // fallback: opaque ref null func
      }
      return [0x63, ...uleb(aIdx(i))];
    }
    case "funcref": {
      // Typed funcref: ref null $sig_idx (non-nullable funcref in local/field position)
      if (fSig) return [0x63, ...uleb(fSig(t.params, t.ret))];
      return [0x63, 0x70];  // fallback: opaque ref null func
    }
    default: throw new Error(`encodeValType: unhandled ${(t as WacType).tag}`);
  }
}

// FieldType encoding: used in struct/array type definitions. Includes packed types.
function encodeFieldType(
  t: WacType,
  sIdx: Map<string, number>,
  aIdx: (e: WacType) => number,
  fSig?: (params: WacType[], ret: WacType) => number,
): number[] {
  if (t.tag === "i8")  return [0x78];
  if (t.tag === "i16") return [0x77];
  return encodeValType(t, sIdx, aIdx, fSig);
}

// ---- Helpers ----

// Get canonical parent name of a struct given its canonical name.
function canonicalParent(resolved: ResolvedModule, canonicalName: string): string | undefined {
  const rs = resolved.structs.get(canonicalName);
  if (!rs?.decl.parent) return undefined;
  // The parent is declared using a local name in the struct's file; resolve via that file's env.
  const env = resolved.envs.get(rs.filePath);
  return env?.structs.get(rs.decl.parent) ?? rs.decl.parent;
}

function topoStructs(resolved: ResolvedModule): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  function visit(name: string): void {
    if (visited.has(name)) return;
    const rs = resolved.structs.get(name);
    if (!rs) return;
    const parent = canonicalParent(resolved, name);
    if (parent) visit(parent);
    visited.add(name);
    result.push(name);
  }
  for (const name of resolved.structs.keys()) visit(name);
  return result;
}

function allFieldsOf(
  resolved: ResolvedModule, canonicalName: string,
): Array<{ name: string; type: WacType; isConst: boolean; absFieldIdx: number }> {
  const rs = resolved.structs.get(canonicalName)!;
  const env = resolved.envs.get(rs.filePath);
  // Resolve a type from this struct's file (local names → canonical names).
  function resolveFieldType(t: WacType): WacType {
    if (t.tag === "named")    return { tag: "named", name: env?.structs.get(t.name) ?? t.name };
    if (t.tag === "array")    return { tag: "array", elem: resolveFieldType(t.elem) };
    if (t.tag === "nullable") return { tag: "nullable", inner: resolveFieldType(t.inner) };
    if (t.tag === "funcref")  return { tag: "funcref", ret: resolveFieldType(t.ret), params: t.params.map(resolveFieldType) };
    return t;
  }
  const parent = canonicalParent(resolved, canonicalName);
  const inherited = parent ? allFieldsOf(resolved, parent) : [];
  return [
    ...inherited,
    ...rs.decl.fields.map((f, i) => ({
      name: f.name,
      type: resolveFieldType(f.type),   // canonical type for use in encoding and emission
      isConst: f.isConst || rs.decl.isConst,
      absFieldIdx: inherited.length + i,
    })),
  ];
}

function declToEmitFunc(decl: FuncDecl): EmitFunc {
  return {
    params: decl.params.map(p => ({ name: p.name, type: p.type })),
    returnType: decl.returnType,
    body: decl.body,
  };
}

function methodToEmitFunc(method: MethodDecl, structName: string): EmitFunc {
  const params: Array<{ name: string; type: WacType }> = [];
  if (method.thisParam !== undefined) {
    params.push({ name: "this", type: { tag: "named", name: structName } });
  }
  for (const p of method.params) params.push({ name: p.name, type: p.type });
  return { params, returnType: method.returnType, body: method.body };
}

function typeEq(a: WacType, b: WacType): boolean {
  if (a.tag !== b.tag) return false;
  if (a.tag === "named"    && b.tag === "named")    return a.name === b.name;
  if (a.tag === "array"    && b.tag === "array")    return typeEq(a.elem, b.elem);
  if (a.tag === "nullable" && b.tag === "nullable") return typeEq(a.inner, b.inner);
  if (a.tag === "funcref"  && b.tag === "funcref")
    return typeEq(a.ret, b.ret) && a.params.length === b.params.length && a.params.every((p, i) => typeEq(p, b.params[i]!));
  return true;
}

function typeStr(t: WacType): string {
  switch (t.tag) {
    case "i32": case "i64": case "f32": case "f64":
    case "bool": case "void": case "string":
    case "i8": case "i16": case "anyref": case "i31ref": return t.tag;
    case "named":    return t.name;
    case "array":    return `${typeStr(t.elem)}[]`;
    case "nullable": return `${typeStr(t.inner)}?`;
    case "funcref":  return `fn[${typeStr(t.ret)}(${t.params.map(typeStr).join(",")})]`;
  }
}

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

// ---- String helpers ----

// Build pre-compiled wasm function bodies for string operations.
// T = type index of the i8 array (= string representation).
// Each helper returns { name, params, ret, body } where body is the raw
// code-section entry bytes (local-decls vector + instructions + 0x0B end).
function buildStringHelpers(T: number): Array<{
  name: string; params: WacType[]; ret: WacType; body: number[];
}> {
  // Ref nonnull $i8arr valtype = [0x64, ...uleb(T)]
  const refT = [0x64, ...uleb(T)];
  const s: WacType = { tag: "string" };
  const i32t: WacType = { tag: "i32" };

  // Helpers to emit common instruction sequences.
  function localGet(i: number): number[] { return [0x20, ...uleb(i)]; }
  function localSet(i: number): number[] { return [0x21, ...uleb(i)]; }
  function localTee(i: number): number[] { return [0x22, ...uleb(i)]; }
  function i32Const(n: number): number[] {
    // sleb128 encoding
    const out: number[] = [];
    let more = true;
    while (more) {
      let b = n & 0x7F;
      n >>= 7;
      if ((n === 0 && (b & 0x40) === 0) || (n === -1 && (b & 0x40) !== 0)) more = false;
      else b |= 0x80;
      out.push(b);
    }
    return [0x41, ...out];
  }
  function arrayLen(): number[] { return [0xFB, 0x0F]; }
  function arrayNewDefault(): number[] { return [0xFB, 0x07, ...uleb(T)]; }
  function arrayGetU(): number[] { return [0xFB, 0x0D, ...uleb(T)]; }
  function arraySet(): number[] { return [0xFB, 0x0E, ...uleb(T)]; }
  function i32Add(): number[] { return [0x6A]; }
  function i32Sub(): number[] { return [0x6B]; }
  function i32GeU(): number[] { return [0x4F]; }  // i32.ge_u
  function i32GtU(): number[] { return [0x4B]; }  // i32.gt_u
  function i32Eq(): number[] { return [0x46]; }
  function i32Ne(): number[] { return [0x47]; }
  function i32LtU(): number[] { return [0x49]; }  // i32.lt_u
  function i32LeU(): number[] { return [0x4D]; }  // i32.le_u
  function i32Eqz(): number[] { return [0x45]; }

  // A loop block:
  //   block void; loop void; <if i >= n: br_if 1>; body; br 0; end; end
  function loop(iLocal: number, nLocal: number, body: number[]): number[] {
    return [
      0x02, 0x40,  // block void
      0x03, 0x40,  // loop void
      ...localGet(iLocal), ...localGet(nLocal), ...i32GeU(), 0x0D, 0x01,  // br_if 1
      ...body,
      0x0C, 0x00,  // br 0 (loop back)
      0x0B,        // end loop
      0x0B,        // end block
    ];
  }

  // wac_str_concat(a, b) -> string
  // Params: 0=a, 1=b
  // Locals: 2=la (i32), 3=lb (i32), 4=i (i32), 5=result (ref $i8arr)
  // localDecls: 3×i32, 1×ref $i8arr
  const concatLocals = [0x02, 0x03, 0x7F, 0x01, ...refT];
  const concatBody = [
    ...localGet(0), ...arrayLen(), ...localSet(2),       // la = a.len
    ...localGet(1), ...arrayLen(), ...localSet(3),       // lb = b.len
    ...localGet(2), ...localGet(3), ...i32Add(),         // la + lb
    ...arrayNewDefault(), ...localSet(5),                // result = new i8arr(la+lb)
    // Loop 1: copy a[0..la) into result[0..la)
    ...loop(4, 2, [
      ...localGet(5), ...localGet(4),                    // result, i
      ...localGet(0), ...localGet(4), ...arrayGetU(),    // a[i]
      ...arraySet(),                                     // result[i] = a[i]
      ...localGet(4), ...i32Const(1), ...i32Add(), ...localSet(4),  // i++
    ]),
    // i = 0 (reset for second loop)
    ...i32Const(0), ...localSet(4),
    // Loop 2: copy b[0..lb) into result[la..la+lb)
    ...loop(4, 3, [
      ...localGet(5),
      ...localGet(2), ...localGet(4), ...i32Add(),       // la+i
      ...localGet(1), ...localGet(4), ...arrayGetU(),    // b[i]
      ...arraySet(),                                     // result[la+i] = b[i]
      ...localGet(4), ...i32Const(1), ...i32Add(), ...localSet(4),  // i++
    ]),
    ...localGet(5),  // return result
    0x0B,            // end function
  ];

  // wac_str_eq(a, b) -> i32 (bool)
  // Params: 0=a, 1=b
  // Locals: 2=la (i32), 3=i (i32)
  // Returns 1 if equal, 0 if not
  const eqLocals = [0x01, 0x02, 0x7F];
  const eqBody = [
    // la = a.len
    ...localGet(0), ...arrayLen(), ...localSet(2),
    // if la != b.len: return 0
    ...localGet(2), ...localGet(1), ...arrayLen(), ...i32Ne(),
    0x04, 0x40,    // if void
    ...i32Const(0), 0x0F,  // return 0
    0x0B,          // end if
    // i = 0, loop checking a[i] == b[i]
    ...i32Const(0), ...localSet(3),
    ...loop(3, 2, [
      ...localGet(0), ...localGet(3), ...arrayGetU(),  // a[i]
      ...localGet(1), ...localGet(3), ...arrayGetU(),  // b[i]
      ...i32Ne(),
      0x04, 0x40,  // if void
      ...i32Const(0), 0x0F,  // return 0
      0x0B,        // end if
      ...localGet(3), ...i32Const(1), ...i32Add(), ...localSet(3),  // i++
    ]),
    ...i32Const(1),  // return 1
    0x0B,
  ];

  // wac_str_lt(a, b) -> i32 (bool)
  // Returns 1 if a < b lexicographically
  // Params: 0=a, 1=b
  // Locals: 2=la (i32), 3=lb (i32), 4=n (i32, = min(la,lb)), 5=i (i32)
  const ltLocals = [0x01, 0x04, 0x7F];
  const ltBody = [
    ...localGet(0), ...arrayLen(), ...localSet(2),  // la
    ...localGet(1), ...arrayLen(), ...localSet(3),  // lb
    // n = min(la, lb)
    ...localGet(2), ...localGet(3), ...i32LtU(),
    0x04, ...encodeBlockTypeI32(),   // if → i32
    ...localGet(2),
    0x05,
    ...localGet(3),
    0x0B,
    ...localSet(4),  // n = min(la,lb)
    // i = 0
    ...i32Const(0), ...localSet(5),
    // Loop: compare char by char
    ...loop(5, 4, [
      ...localGet(0), ...localGet(5), ...arrayGetU(),  // a[i]
      ...localGet(1), ...localGet(5), ...arrayGetU(),  // b[i]
      // if a[i] < b[i]: return 1
      0x22, ...uleb(5 + 1),  // local.tee scratch (reuse: we need b[i])
      // Actually: we need to save both. Let's compute differently.
      // local.tee can't be used here easily. Use a different approach:
      // Push a[i], b[i], then compare. We already have them on stack.
      // Let's use: a[i] != b[i] → if a[i] < b[i] return 1 else return 0
      // But we can't re-evaluate. Use the two values already on stack.
      // Stack: [a_i, b_i]  -- but we need to compare without losing them.
      // Actually in the instructions above, the last thing pushed was b[i].
      // So we have: ..., arrayGetU(a), arrayGetU(b)
      // We need: if a[i] < b[i] return 1; if a[i] > b[i] return 0; else continue
    ]),
    // Fallback: a < b iff la < lb
    ...localGet(2), ...localGet(3), ...i32LtU(),
    0x0B,
  ];

  // The lt implementation above has a bug (we can't split the loop body cleanly).
  // Let me rewrite it properly:
  // wac_str_lt(a, b) -> i32 (bool)
  // Params: 0=a, 1=b; Locals: 2=la, 3=lb, 4=n(min), 5=i, 6=ca, 7=cb
  const ltLocals2 = [0x01, 0x06, 0x7F];
  const ltBody2 = [
    ...localGet(0), ...arrayLen(), ...localSet(2),
    ...localGet(1), ...arrayLen(), ...localSet(3),
    // n = min(la, lb)
    ...localGet(2), ...localGet(3), ...i32LtU(),
    0x04, ...encodeBlockTypeI32(),
    ...localGet(2),
    0x05,
    ...localGet(3),
    0x0B,
    ...localSet(4),
    // i = 0
    ...i32Const(0), ...localSet(5),
    // loop: compare char by char
    ...loop(5, 4, [
      ...localGet(0), ...localGet(5), ...arrayGetU(), ...localSet(6),  // ca = a[i]
      ...localGet(1), ...localGet(5), ...arrayGetU(), ...localSet(7),  // cb = b[i]
      // if ca < cb: return 1
      ...localGet(6), ...localGet(7), ...i32LtU(),
      0x04, 0x40,
      ...i32Const(1), 0x0F,
      0x0B,
      // if ca > cb: return 0
      ...localGet(6), ...localGet(7), ...i32GtU(),
      0x04, 0x40,
      ...i32Const(0), 0x0F,
      0x0B,
      // i++
      ...localGet(5), ...i32Const(1), ...i32Add(), ...localSet(5),
    ]),
    // a < b iff la < lb (same prefix up to n)
    ...localGet(2), ...localGet(3), ...i32LtU(),
    0x0B,
  ];

  // wac_str_idx(s, i) -> string
  // Returns the full UTF-8 codepoint starting at byte index i.
  // If i points to a continuation byte (0x80–0xBF), returns empty string.
  // If i is out of bounds, traps (via array.get_u bounds check).
  // Params: 0=s, 1=i; Locals: 2=b(i32), 3=n(i32), 4=j(i32), 5=result(refT)
  const idxLocals = [0x02, 0x03, 0x7F, 0x01, ...refT];
  const idxBody = [
    // b = s[i]  (traps if i >= s.len())
    ...localGet(0), ...localGet(1), ...arrayGetU(), ...localSet(2),
    // Determine byte count n from leading byte b:
    //   b < 0x80  → 1-byte codepoint  (ASCII)
    //   b < 0xC0  → 0           (continuation byte)
    //   b < 0xE0  → 2-byte codepoint
    //   b < 0xF0  → 3-byte codepoint
    //   else      → 4-byte codepoint
    ...localGet(2), ...i32Const(0x80), ...i32LtU(),
    0x04, 0x40,                                      // if b < 0x80
      ...i32Const(1), ...localSet(3),                //   n = 1
    0x05,                                            // else
      ...localGet(2), ...i32Const(0xC0), ...i32LtU(),
      0x04, 0x40,                                    //   if b < 0xC0
        ...i32Const(0), ...localSet(3),              //     n = 0 (continuation)
      0x05,                                          //   else
        ...localGet(2), ...i32Const(0xE0), ...i32LtU(),
        0x04, 0x40,                                  //     if b < 0xE0
          ...i32Const(2), ...localSet(3),            //       n = 2
        0x05,                                        //     else
          ...localGet(2), ...i32Const(0xF0), ...i32LtU(),
          0x04, 0x40,                                //       if b < 0xF0
            ...i32Const(3), ...localSet(3),          //         n = 3
          0x05,                                      //       else
            ...i32Const(4), ...localSet(3),          //         n = 4
          0x0B,                                      //       end
        0x0B,                                        //     end
      0x0B,                                          //   end
    0x0B,                                            // end
    // result = new i8arr(n)
    ...localGet(3), ...arrayNewDefault(), ...localSet(5),
    // j = 0
    ...i32Const(0), ...localSet(4),
    // loop: while j < n: result[j] = s[i+j]; j++
    ...loop(4, 3, [
      ...localGet(5), ...localGet(4),                   // result, j
      ...localGet(0), ...localGet(1), ...localGet(4), ...i32Add(), ...arrayGetU(), // s[i+j]
      ...arraySet(),                                    // result[j] = s[i+j]
      ...localGet(4), ...i32Const(1), ...i32Add(), ...localSet(4),  // j++
    ]),
    ...localGet(5),  // return result
    0x0B,
  ];

  // wac_str_slice(s, start, end) -> string
  // Params: 0=s, 1=start, 2=end; Locals: 3=len(i32), 4=i(i32), 5=result(ref)
  const sliceLocals = [0x02, 0x02, 0x7F, 0x01, ...refT];
  const sliceBody = [
    // len = end - start
    ...localGet(2), ...localGet(1), ...i32Sub(), ...localSet(3),
    // result = new i8arr(len)
    ...localGet(3), ...arrayNewDefault(), ...localSet(5),
    // i = 0
    ...i32Const(0), ...localSet(4),
    ...loop(4, 3, [
      ...localGet(5), ...localGet(4),                              // result, i
      ...localGet(0), ...localGet(1), ...localGet(4), ...i32Add(), ...arrayGetU(),  // s[start+i]
      ...arraySet(),                                               // result[i] = s[start+i]
      ...localGet(4), ...i32Const(1), ...i32Add(), ...localSet(4), // i++
    ]),
    ...localGet(5),  // return result
    0x0B,
  ];

  // wac_str_indexof(s, needle) -> i32 (-1 if not found)
  // Params: 0=s, 1=needle; Locals: 2=ls, 3=ln, 4=i, 5=j, 6=matched
  const indexofLocals = [0x01, 0x05, 0x7F];
  const indexofBody = [
    ...localGet(0), ...arrayLen(), ...localSet(2),  // ls
    ...localGet(1), ...arrayLen(), ...localSet(3),  // ln
    // i = 0
    ...i32Const(0), ...localSet(4),
    // outer loop: i from 0 to ls-ln
    // block $outer_exit
    0x02, 0x40,
    // loop $outer
    0x03, 0x40,
    // if i > ls - ln: break
    ...localGet(4), ...localGet(2), ...localGet(3), ...i32Sub(), ...i32GtU(),
    // Special case: if ln == 0, every position matches, return 0
    // But let's handle edge: if ls < ln then break immediately
    0x0D, 0x01,  // br_if 1 (exit outer block)
    // j = 0, matched = 1
    ...i32Const(0), ...localSet(5),
    ...i32Const(1), ...localSet(6),
    // inner loop: check if s[i..i+ln) == needle
    // block $inner_exit
    0x02, 0x40,
    // loop $inner
    0x03, 0x40,
    // if j >= ln: break inner
    ...localGet(5), ...localGet(3), ...i32GeU(), 0x0D, 0x01,
    // if s[i+j] != needle[j]: matched = 0, break inner
    ...localGet(0), ...localGet(4), ...localGet(5), ...i32Add(), ...arrayGetU(),
    ...localGet(1), ...localGet(5), ...arrayGetU(),
    ...i32Ne(),
    0x04, 0x40,
    ...i32Const(0), ...localSet(6),
    0x0C, 0x02,  // br 2 (exit inner block — label 0=if, label 1=loop$inner, label 2=block$inner_exit)
    0x0B,
    // j++
    ...localGet(5), ...i32Const(1), ...i32Add(), ...localSet(5),
    0x0C, 0x00,  // br 0 (loop inner)
    0x0B,  // end inner loop
    0x0B,  // end inner block
    // if matched: return i
    ...localGet(6),
    0x04, 0x40,
    ...localGet(4), 0x0F,  // return i
    0x0B,
    // i++
    ...localGet(4), ...i32Const(1), ...i32Add(), ...localSet(4),
    0x0C, 0x00,  // br 0 (loop outer)
    0x0B,  // end outer loop
    0x0B,  // end outer block
    // return -1 (not found)
    ...i32Const(-1),
    0x0B,
  ];

  function makeBody(localDecls: number[], bodyBytes: number[]): number[] {
    return [...localDecls, ...bodyBytes];
  }

  return [
    {
      name: "concat",
      params: [s, s],
      ret: s,
      body: makeBody(concatLocals, concatBody),
    },
    {
      name: "eq",
      params: [s, s],
      ret: i32t,
      body: makeBody(eqLocals, eqBody),
    },
    {
      name: "lt",
      params: [s, s],
      ret: i32t,
      body: makeBody(ltLocals2, ltBody2),
    },
    {
      name: "idx",
      params: [s, i32t],
      ret: s,
      body: makeBody(idxLocals, idxBody),
    },
    {
      name: "slice",
      params: [s, i32t, i32t],
      ret: s,
      body: makeBody(sliceLocals, sliceBody),
    },
    {
      name: "indexof",
      params: [s, s],
      ret: i32t,
      body: makeBody(indexofLocals, indexofBody),
    },
  ];
}

// Encode block type for i32 (used in conditionals returning a value)
function encodeBlockTypeI32(): number[] {
  return [0x7F];
}
