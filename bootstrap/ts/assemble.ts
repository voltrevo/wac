// The `.wax` assembler, in TypeScript. See `spec/wax.md`.
//
// Structured so that the Rust implementation can be a line-for-line translation: the same three
// passes, the same names, the same emission order. Where a choice existed it is written down in the
// spec rather than made here, because two implementations agreeing by accident is not agreement.

export type ValType = "i32" | "i64";

const VALTYPE_BYTE: Record<ValType, number> = { i32: 0x7f, i64: 0x7e };

type FuncType = { name: string; params: ValType[]; results: ValType[] };
type Import = { module: string; field: string; name: string; params: ValType[]; results: ValType[] };
type Global = { name: string; type: ValType; mutable: boolean; value: bigint };
type DataSeg = { offset: number; bytes: number[] };
type Export = { name: string; kind: "func" | "memory"; target: string };

type Local = { name: string; type: ValType };
type Func = {
  name: string;
  params: Local[];
  locals: Local[];
  results: ValType[];
  body: Line[];
};

type Line = { n: number; tokens: string[] };

export class WaxError extends Error {
  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`);
  }
}

// ---------------------------------------------------------------- LEB128

export function uleb(n: number): number[] {
  if (n < 0) throw new Error(`uleb of a negative: ${n}`);
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
}

export function sleb(v: bigint): number[] {
  const out: number[] = [];
  let more = true;
  while (more) {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    // The sign bit of the byte must match the sign of what is left, or another byte is needed.
    const signBitSet = (b & 0x40) !== 0;
    if ((v === 0n && !signBitSet) || (v === -1n && signBitSet)) more = false;
    else b |= 0x80;
    out.push(b);
  }
  return out;
}

function name(s: string): number[] {
  const bytes = new TextEncoder().encode(s);
  return [...uleb(bytes.length), ...bytes];
}

function section(id: number, payload: number[]): number[] {
  if (payload.length === 0) return [];
  return [id, ...uleb(payload.length), ...payload];
}

function vec(items: number[][]): number[] {
  const out = uleb(items.length);
  for (const it of items) out.push(...it);
  return out;
}

// ---------------------------------------------------------------- pass 1: read

function unquote(tok: string, lineNo: number): number[] {
  if (tok.length < 2 || !tok.startsWith('"') || !tok.endsWith('"')) {
    throw new WaxError(lineNo, `expected a double-quoted string, got ${tok}`);
  }
  const out: number[] = [];
  const s = tok.slice(1, -1);
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "\\") {
      for (const b of new TextEncoder().encode(s[i])) out.push(b);
      continue;
    }
    i++;
    const c = s[i];
    if (c === "n") out.push(10);
    else if (c === "t") out.push(9);
    else if (c === "\\") out.push(92);
    else if (c === '"') out.push(34);
    else if (c === "x") {
      const hex = s.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new WaxError(lineNo, `bad \\x escape: \\x${hex}`);
      out.push(parseInt(hex, 16));
      i += 2;
    } else throw new WaxError(lineNo, `unknown escape \\${c}`);
  }
  return out;
}

/** Split a line into tokens, keeping a double-quoted string as one token. */
function tokenize(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === ";") break;
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') {
        if (src[j] === "\\") j++;
        j++;
      }
      out.push(src.slice(i, Math.min(j + 1, src.length)));
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < src.length && !" \t\r;".includes(src[j])) j++;
    out.push(src.slice(i, j));
    i = j;
  }
  return out;
}

function valtype(tok: string, lineNo: number): ValType {
  if (tok === "i32" || tok === "i64") return tok;
  throw new WaxError(lineNo, `not a value type: ${tok}`);
}

/** Everything after `->` on a directive line. */
function resultsAfterArrow(tokens: string[], from: number, lineNo: number): ValType[] {
  const at = tokens.indexOf("->", from);
  if (at < 0) throw new WaxError(lineNo, "expected `->`");
  return tokens.slice(at + 1).map((t) => valtype(t, lineNo));
}

type Module = {
  types: FuncType[];
  imports: Import[];
  memoryPages: number | null;
  globals: Global[];
  data: DataSeg[];
  exports: Export[];
  funcs: Func[];
};

function read(source: string): Module {
  const m: Module = {
    types: [], imports: [], memoryPages: null, globals: [], data: [], exports: [], funcs: [],
  };
  const lines = source.split("\n");
  let cur: Func | null = null;

  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const t = tokenize(lines[i]);
    if (t.length === 0) continue;

    if (cur !== null) {
      if (t[0] === "end" && t.length === 1 && depthOf(cur.body) === 0) {
        m.funcs.push(cur);
        cur = null;
        continue;
      }
      if (t[0] === "param") {
        if (cur.locals.length > 0 || cur.body.length > 0) {
          throw new WaxError(n, "`param` must come before locals and instructions");
        }
        cur.params.push({ name: t[2], type: valtype(t[1], n) });
        continue;
      }
      if (t[0] === "local") {
        if (cur.body.length > 0) throw new WaxError(n, "`local` must come before instructions");
        cur.locals.push({ name: t[2], type: valtype(t[1], n) });
        continue;
      }
      cur.body.push({ n, tokens: t });
      continue;
    }

    switch (t[0]) {
      case "type": {
        const arrow = t.indexOf("->");
        if (t[2] !== "func" || arrow < 0) throw new WaxError(n, "expected `type $n func … -> …`");
        m.types.push({
          name: t[1],
          params: t.slice(3, arrow).map((x) => valtype(x, n)),
          results: t.slice(arrow + 1).map((x) => valtype(x, n)),
        });
        break;
      }
      case "import": {
        const arrow = t.indexOf("->");
        if (t[4] !== "func" || arrow < 0) throw new WaxError(n, "expected `import … $n func … -> …`");
        m.imports.push({
          module: new TextDecoder().decode(new Uint8Array(unquote(t[1], n))),
          field: new TextDecoder().decode(new Uint8Array(unquote(t[2], n))),
          name: t[3],
          params: t.slice(5, arrow).map((x) => valtype(x, n)),
          results: t.slice(arrow + 1).map((x) => valtype(x, n)),
        });
        break;
      }
      case "memory":
        if (m.memoryPages !== null) throw new WaxError(n, "a second `memory`");
        m.memoryPages = Number(t[1]);
        break;
      case "global": {
        if (t[4] !== "=") throw new WaxError(n, "expected `global $n <type> <mut|const> = <lit>`");
        m.globals.push({
          name: t[1], type: valtype(t[2], n),
          mutable: t[3] === "mut", value: BigInt(t[5]),
        });
        break;
      }
      case "data":
        m.data.push({ offset: Number(t[1]), bytes: unquote(t[2], n) });
        break;
      case "export": {
        const label = new TextDecoder().decode(new Uint8Array(unquote(t[1], n)));
        if (t[2] === "memory") m.exports.push({ name: label, kind: "memory", target: "" });
        else if (t[2] === "func") m.exports.push({ name: label, kind: "func", target: t[3] });
        else throw new WaxError(n, `export of ${t[2]} is not a thing`);
        break;
      }
      case "func":
        cur = { name: t[1], params: [], locals: [], results: resultsAfterArrow(t, 2, n), body: [] };
        break;
      default:
        throw new WaxError(n, `unknown directive ${t[0]}`);
    }
  }
  if (cur !== null) throw new WaxError(lines.length, `function ${cur.name} has no \`end\``);
  return m;
}

/** How many block-likes are open inside a partially-read body — so `end` can close the function. */
function depthOf(body: Line[]): number {
  let d = 0;
  for (const l of body) {
    const k = l.tokens[0];
    if (k === "block" || k === "loop" || k === "if") d++;
    else if (k === "end") d--;
  }
  return d;
}

// ---------------------------------------------------------------- pass 2: index

type Index = {
  types: FuncType[];
  typeOf: Map<string, number>;
  funcOf: Map<string, number>;
  globalOf: Map<string, number>;
  /** The type index each local function uses. */
  funcTypeIndex: number[];
};

function shapeKey(params: ValType[], results: ValType[]): string {
  return `${params.join(",")}->${results.join(",")}`;
}

function index(m: Module): Index {
  const types = [...m.types];
  const typeOf = new Map<string, number>();
  types.forEach((t, i) => typeOf.set(t.name, i));

  // A shape may already be declared, in which case a function reuses it; an undeclared shape is
  // appended. Declared types are never merged with each other — see the spec.
  const byShape = new Map<string, number>();
  types.forEach((t, i) => {
    const k = shapeKey(t.params, t.results);
    if (!byShape.has(k)) byShape.set(k, i);
  });
  const need = (params: ValType[], results: ValType[]): number => {
    const k = shapeKey(params, results);
    const at = byShape.get(k);
    if (at !== undefined) return at;
    types.push({ name: `$auto${types.length}`, params, results });
    byShape.set(k, types.length - 1);
    return types.length - 1;
  };

  const funcOf = new Map<string, number>();
  m.imports.forEach((im, i) => {
    need(im.params, im.results);
    funcOf.set(im.name, i);
  });
  const funcTypeIndex: number[] = [];
  m.funcs.forEach((f, i) => {
    funcOf.set(f.name, m.imports.length + i);
    funcTypeIndex.push(need(f.params.map((p) => p.type), f.results));
  });

  const globalOf = new Map<string, number>();
  m.globals.forEach((g, i) => globalOf.set(g.name, i));

  return { types, typeOf, funcOf, globalOf, funcTypeIndex };
}

// ---------------------------------------------------------------- pass 3: emit

const NULLARY: Record<string, number> = {
  "return": 0x0f, "drop": 0x1a, "select": 0x1b, "unreachable": 0x00, "nop": 0x01,
  "i32.eqz": 0x45, "i32.eq": 0x46, "i32.ne": 0x47,
  "i32.lt_s": 0x48, "i32.lt_u": 0x49, "i32.gt_s": 0x4a, "i32.gt_u": 0x4b,
  "i32.le_s": 0x4c, "i32.le_u": 0x4d, "i32.ge_s": 0x4e, "i32.ge_u": 0x4f,
  "i32.add": 0x6a, "i32.sub": 0x6b, "i32.mul": 0x6c,
  "i32.div_s": 0x6d, "i32.div_u": 0x6e, "i32.rem_s": 0x6f, "i32.rem_u": 0x70,
  "i32.and": 0x71, "i32.or": 0x72, "i32.xor": 0x73,
  "i32.shl": 0x74, "i32.shr_s": 0x75, "i32.shr_u": 0x76,
};

const MEMOP: Record<string, number> = {
  "i32.load": 0x28, "i32.load8_s": 0x2c, "i32.load8_u": 0x2d,
  "i32.store": 0x36, "i32.store8": 0x3a,
};

/** The block type of a block-like: empty, or a single value type. */
function blockType(results: ValType[], lineNo: number): number[] {
  if (results.length === 0) return [0x40];
  if (results.length === 1) return [VALTYPE_BYTE[results[0]]];
  throw new WaxError(lineNo, "a block with more than one result needs a type index, unsupported");
}

function emitBody(f: Func, ix: Index): number[] {
  const slot = new Map<string, number>();
  f.params.forEach((p, i) => slot.set(p.name, i));
  f.locals.forEach((l, i) => slot.set(l.name, f.params.length + i));

  const localOf = (n: string, lineNo: number): number => {
    const at = slot.get(n);
    if (at === undefined) throw new WaxError(lineNo, `no local or parameter ${n}`);
    return at;
  };

  // Open labels, innermost last. `br $l` is the distance from the top of this stack.
  const labels: string[] = [];
  const depth = (l: string, lineNo: number): number => {
    for (let i = labels.length - 1; i >= 0; i--) if (labels[i] === l) return labels.length - 1 - i;
    throw new WaxError(lineNo, `no label ${l} is open here`);
  };

  const out: number[] = [];
  for (const { n, tokens: t } of f.body) {
    const op = t[0];
    if (op in NULLARY) { out.push(NULLARY[op]); continue; }
    if (op in MEMOP) {
      if (t.length !== 3) throw new WaxError(n, `${op} needs <align> <offset>`);
      const align = Number(t[1]);
      if (align !== 1 && align !== 2 && align !== 4 && align !== 8) {
        throw new WaxError(n, `align must be a power of two in bytes, got ${t[1]}`);
      }
      out.push(MEMOP[op], ...uleb(Math.log2(align)), ...uleb(Number(t[2])));
      continue;
    }
    switch (op) {
      case "i32.const": out.push(0x41, ...sleb(BigInt(t[1]))); break;
      case "i64.const": out.push(0x42, ...sleb(BigInt(t[1]))); break;
      case "local.get": out.push(0x20, ...uleb(localOf(t[1], n))); break;
      case "local.set": out.push(0x21, ...uleb(localOf(t[1], n))); break;
      case "local.tee": out.push(0x22, ...uleb(localOf(t[1], n))); break;
      case "global.get": case "global.set": {
        const at = ix.globalOf.get(t[1]);
        if (at === undefined) throw new WaxError(n, `no global ${t[1]}`);
        out.push(op === "global.get" ? 0x23 : 0x24, ...uleb(at));
        break;
      }
      case "memory.size": out.push(0x3f, 0x00); break;
      case "memory.grow": out.push(0x40, 0x00); break;
      case "call": {
        const at = ix.funcOf.get(t[1]);
        if (at === undefined) throw new WaxError(n, `no function ${t[1]}`);
        out.push(0x10, ...uleb(at));
        break;
      }
      case "block": case "loop": case "if": {
        out.push(op === "block" ? 0x02 : op === "loop" ? 0x03 : 0x04);
        out.push(...blockType(resultsAfterArrow(t, 2, n), n));
        labels.push(t[1]);
        break;
      }
      case "else": out.push(0x05); break;
      case "end":
        if (labels.length === 0) throw new WaxError(n, "an `end` with nothing open");
        labels.pop();
        out.push(0x0b);
        break;
      case "br": out.push(0x0c, ...uleb(depth(t[1], n))); break;
      case "br_if": out.push(0x0d, ...uleb(depth(t[1], n))); break;
      default: throw new WaxError(n, `unknown instruction ${op}`);
    }
  }
  if (labels.length !== 0) throw new WaxError(0, `${f.name}: ${labels.length} block(s) left open`);
  out.push(0x0b); // the function's own end
  return out;
}

/** Consecutive locals of one type are one entry, which is what wasm's format asks for. */
function localDecls(f: Func): number[] {
  const runs: [ValType, number][] = [];
  for (const l of f.locals) {
    if (runs.length > 0 && runs[runs.length - 1][0] === l.type) runs[runs.length - 1][1]++;
    else runs.push([l.type, 1]);
  }
  return vec(runs.map(([ty, count]) => [...uleb(count), VALTYPE_BYTE[ty]]));
}

export function assemble(source: string): Uint8Array {
  const m = read(source);
  const ix = index(m);
  const out: number[] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

  out.push(...section(1, vec(ix.types.map((t) => [
    0x60,
    ...vec(t.params.map((p) => [VALTYPE_BYTE[p]])),
    ...vec(t.results.map((r) => [VALTYPE_BYTE[r]])),
  ]))));

  out.push(...section(2, vec(m.imports.map((im) => {
    const at = ix.types.findIndex((t) =>
      shapeKey(t.params, t.results) === shapeKey(im.params, im.results)
    );
    return [...name(im.module), ...name(im.field), 0x00, ...uleb(at)];
  }))));

  out.push(...section(3, vec(ix.funcTypeIndex.map((t) => uleb(t)))));

  if (m.memoryPages !== null) out.push(...section(5, vec([[0x00, ...uleb(m.memoryPages)]])));

  out.push(...section(6, vec(m.globals.map((g) => [
    VALTYPE_BYTE[g.type], g.mutable ? 0x01 : 0x00,
    g.type === "i32" ? 0x41 : 0x42, ...sleb(g.value), 0x0b,
  ]))));

  out.push(...section(7, vec(m.exports.map((e) => {
    if (e.kind === "memory") return [...name(e.name), 0x02, 0x00];
    const at = ix.funcOf.get(e.target);
    if (at === undefined) throw new WaxError(0, `export names no function ${e.target}`);
    return [...name(e.name), 0x00, ...uleb(at)];
  }))));

  // Sections are written in ascending id, which wasm requires: code (10) before data (11).
  out.push(...section(10, vec(m.funcs.map((f) => {
    const body = [...localDecls(f), ...emitBody(f, ix)];
    return [...uleb(body.length), ...body];
  }))));

  out.push(...section(11, vec(m.data.map((d) => [
    0x00, 0x41, ...sleb(BigInt(d.offset)), 0x0b, ...uleb(d.bytes.length), ...d.bytes,
  ]))));

  return new Uint8Array(out);
}
