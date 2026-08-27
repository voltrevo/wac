// The `.l0` assembler, in TypeScript. See `spec/l0.md`.
//
// Structured so that the Rust implementation can be a line-for-line translation: the same three
// passes, the same names, the same emission order. Where a choice existed it is written down in the
// spec rather than made here, because two implementations agreeing by accident is not agreement.

// A value type is a number type, an abstract reference, or a reference to a declared type. The last
// is two bytes — a nullability byte and the type's index — which is why this is a shape rather than
// a byte, and why every place that emits one asks for a list.
export type ValType =
  | { k: "num"; byte: number; name: string }
  | { k: "abs"; byte: number; name: string }
  | { k: "ref"; nullable: boolean; to: string };

type PlainType = { k: "num" | "abs"; byte: number; name: string };

const NUM: Record<string, PlainType> = {
  i32: { k: "num", byte: 0x7f, name: "i32" },
  i64: { k: "num", byte: 0x7e, name: "i64" },
  f64: { k: "num", byte: 0x7c, name: "f64" },
  // **Packed, and only valid where a field or an element goes.** wasm has no i8 value, so a local
  // or a parameter of this type is refused by the engine — which is the same place every other type
  // mistake in this format is caught, so the assembler does not duplicate the rule.
  i8: { k: "num", byte: 0x78, name: "i8" },
  i16: { k: "num", byte: 0x77, name: "i16" },
};

// The abstract heap types, spelled as value types. Their bytes are the same in both positions,
// which is a property of the encoding rather than a coincidence worth relying on elsewhere.
const ABS: Record<string, PlainType> = {
  anyref: { k: "abs", byte: 0x6e, name: "anyref" },
  eqref: { k: "abs", byte: 0x6d, name: "eqref" },
  i31ref: { k: "abs", byte: 0x6c, name: "i31ref" },
  structref: { k: "abs", byte: 0x6b, name: "structref" },
  arrayref: { k: "abs", byte: 0x6a, name: "arrayref" },
  nullref: { k: "abs", byte: 0x71, name: "nullref" },
};

function vtName(v: ValType): string {
  return v.k === "ref" ? `${v.nullable ? "refnull" : "ref"} ${v.to}` : v.name;
}

type FuncType = { name: string; params: ValType[]; results: ValType[] };
type StructType = { name: string; fields: ValType[] };
type ArrayType = { name: string; elem: ValType };
type DeclType =
  | { k: "func"; t: FuncType }
  | { k: "struct"; t: StructType }
  | { k: "array"; t: ArrayType };
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

/**
 * Append without spreading.
 *
 * `out.push(...bytes)` passes every byte as an argument, and a module the size of `coretext.wac`
 * has more of them than a call frame holds — which arrives as *Maximum call stack size exceeded*
 * from a function that is not recursive. Every place a whole array is appended goes through here.
 */
function append(out: number[], src: number[]): void {
  for (let i = 0; i < src.length; i++) out.push(src[i]);
}

function section(id: number, payload: number[]): number[] {
  if (payload.length === 0) return [];
  const out = [id];
  append(out, uleb(payload.length));
  append(out, payload);
  return out;
}

function vec(items: number[][]): number[] {
  const out = uleb(items.length);
  for (const it of items) append(out, it);
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

/**
 * A run of value types. `ref` and `refnull` take the following token, which is why this consumes a
 * list rather than mapping over one — a reference is two tokens and a number is one.
 */
function valtypes(toks: string[], lineNo: number): ValType[] {
  const out: ValType[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === "ref" || t === "refnull") {
      const to = toks[++i];
      if (to === undefined) throw new WaxError(lineNo, `${t} with no type after it`);
      out.push({ k: "ref", nullable: t === "refnull", to });
    } else if (t in NUM) out.push(NUM[t]);
    else if (t in ABS) out.push(ABS[t]);
    else throw new WaxError(lineNo, `not a value type: ${t}`);
  }
  return out;
}

function valtype(tok: string, lineNo: number): ValType {
  const v = valtypes([tok], lineNo);
  if (v.length !== 1) throw new WaxError(lineNo, `not a single value type: ${tok}`);
  return v[0];
}

/** Everything after `->` on a directive line. */
function resultsAfterArrow(tokens: string[], from: number, lineNo: number): ValType[] {
  const at = tokens.indexOf("->", from);
  if (at < 0) throw new WaxError(lineNo, "expected `->`");
  return valtypes(tokens.slice(at + 1), lineNo);
}

type Module = {
  types: DeclType[];
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
      // **The name is last, and the type is everything before it.** A reference type is two tokens,
      // so a fixed position for the name would work for `i32` and not for `refnull $Node`.
      if (t[0] === "param" || t[0] === "local") {
        if (t[0] === "param" && (cur.locals.length > 0 || cur.body.length > 0)) {
          throw new WaxError(n, "`param` must come before locals and instructions");
        }
        if (t[0] === "local" && cur.body.length > 0) {
          throw new WaxError(n, "`local` must come before instructions");
        }
        const ty = valtypes(t.slice(1, t.length - 1), n);
        if (ty.length !== 1) throw new WaxError(n, `${t[0]} needs one type and a name`);
        const slot = { name: t[t.length - 1], type: ty[0] };
        if (t[0] === "param") cur.params.push(slot);
        else cur.locals.push(slot);
        continue;
      }
      cur.body.push({ n, tokens: t });
      continue;
    }

    switch (t[0]) {
      case "type": {
        if (t[2] === "struct") {
          m.types.push({ k: "struct", t: { name: t[1], fields: valtypes(t.slice(3), n) } });
          break;
        }
        if (t[2] === "array") {
          const el = valtypes(t.slice(3), n);
          if (el.length !== 1) throw new WaxError(n, "an array has exactly one element type");
          m.types.push({ k: "array", t: { name: t[1], elem: el[0] } });
          break;
        }
        const arrow = t.indexOf("->");
        if (t[2] !== "func" || arrow < 0) {
          throw new WaxError(n, "expected `type $n func … -> …`, `… struct …` or `… array …`");
        }
        m.types.push({
          k: "func",
          t: {
            name: t[1],
            params: valtypes(t.slice(3, arrow), n),
            results: valtypes(t.slice(arrow + 1), n),
          },
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
          params: valtypes(t.slice(5, arrow), n),
          results: valtypes(t.slice(arrow + 1), n),
        });
        break;
      }
      case "memory":
        if (m.memoryPages !== null) throw new WaxError(n, "a second `memory`");
        m.memoryPages = Number(t[1]);
        break;
      case "global": {
        const eq = t.indexOf("=");
        if (eq < 4) throw new WaxError(n, "expected `global $n <type> <mut|const> = <lit>`");
        const gt = valtypes(t.slice(2, eq - 1), n);
        if (gt.length !== 1) throw new WaxError(n, "a global has one type");
        m.globals.push({
          name: t[1], type: gt[0],
          mutable: t[eq - 1] === "mut",
          // A reference global starts null and has no literal to read.
          value: gt[0].k === "ref" ? 0n : BigInt(t[eq + 1]),
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
  types: DeclType[];
  typeOf: Map<string, number>;
  funcOf: Map<string, number>;
  globalOf: Map<string, number>;
  /** The type index each local function uses. */
  funcTypeIndex: number[];
};

function shapeKey(params: ValType[], results: ValType[]): string {
  return `${params.map(vtName).join(",")}->${results.map(vtName).join(",")}`;
}

function index(m: Module): Index {
  const types = [...m.types];
  const typeOf = new Map<string, number>();
  types.forEach((d, i) => typeOf.set(d.t.name, i));

  // A shape may already be declared, in which case a function reuses it; an undeclared shape is
  // appended. Declared types are never merged with each other — see the spec.
  const byShape = new Map<string, number>();
  types.forEach((d, i) => {
    if (d.k !== "func") return;
    const k = shapeKey(d.t.params, d.t.results);
    if (!byShape.has(k)) byShape.set(k, i);
  });
  const need = (params: ValType[], results: ValType[]): number => {
    const k = shapeKey(params, results);
    const at = byShape.get(k);
    if (at !== undefined) return at;
    types.push({ k: "func", t: { name: `$auto${types.length}`, params, results } });
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

  // Rebuilt after `need` has appended: an auto type is still a name something could refer to.
  types.forEach((d, i) => { if (!typeOf.has(d.t.name)) typeOf.set(d.t.name, i); });

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

  // i64, which is the other integer wasm has. wac has eight integer type *names* and they map onto
  // these two, differing in width and in signedness — so the instruction set is doubled and the
  // signed/unsigned pairs are what a compiler above chooses between.
  "i64.eqz": 0x50, "i64.eq": 0x51, "i64.ne": 0x52,
  "i64.lt_s": 0x53, "i64.lt_u": 0x54, "i64.gt_s": 0x55, "i64.gt_u": 0x56,
  "i64.le_s": 0x57, "i64.le_u": 0x58, "i64.ge_s": 0x59, "i64.ge_u": 0x5a,
  "i64.add": 0x7c, "i64.sub": 0x7d, "i64.mul": 0x7e,
  "i64.div_s": 0x7f, "i64.div_u": 0x80, "i64.rem_s": 0x81, "i64.rem_u": 0x82,
  "i64.and": 0x83, "i64.or": 0x84, "i64.xor": 0x85,
  "i64.shl": 0x86, "i64.shr_s": 0x87, "i64.shr_u": 0x88,

  // Between the two, in both directions. Widening is signed or unsigned and narrowing is neither,
  // which is the asymmetry: bits are dropped without asking what they meant.
  "i32.wrap_i64": 0xa7, "i64.extend_i32_s": 0xac, "i64.extend_i32_u": 0xad,

  // f64. Its comparisons have no signed and unsigned form, which is the one place the integer
  // pattern does not carry over — there is only one ordering on a float.
  "f64.eq": 0x61, "f64.ne": 0x62,
  "f64.lt": 0x63, "f64.gt": 0x64, "f64.le": 0x65, "f64.ge": 0x66,
  "f64.abs": 0x99, "f64.neg": 0x9a, "f64.ceil": 0x9b, "f64.floor": 0x9c,
  "f64.trunc": 0x9d, "f64.nearest": 0x9e, "f64.sqrt": 0x9f,
  "f64.add": 0xa0, "f64.sub": 0xa1, "f64.mul": 0xa2, "f64.div": 0xa3,
  "f64.min": 0xa4, "f64.max": 0xa5, "f64.copysign": 0xa6,
  "i32.trunc_f64_s": 0xaa, "i32.trunc_f64_u": 0xab,
  "i64.trunc_f64_s": 0xb0, "i64.trunc_f64_u": 0xb1,
  "f64.convert_i32_s": 0xb7, "f64.convert_i32_u": 0xb8,
  "f64.convert_i64_s": 0xb9, "f64.convert_i64_u": 0xba,
  // Reinterpretation, which is the one conversion that changes nothing: the bits stay and only
  // what reads them differs. A rounding routine that assembles a float from its exponent and
  // mantissa has no other way to hand the result back.
  "i32.reinterpret_f32": 0xbc, "i64.reinterpret_f64": 0xbd,
  "f32.reinterpret_i32": 0xbe, "f64.reinterpret_i64": 0xbf,
};

const MEMOP: Record<string, number> = {
  "i32.load": 0x28, "i32.load8_s": 0x2c, "i32.load8_u": 0x2d,
  "i32.store": 0x36, "i32.store8": 0x3a,
};

/**
 * A value type's bytes. A reference is a nullability byte and the type's index as a **signed** LEB —
 * the same slot holds the negative abbreviations for the abstract types, which is why it cannot be
 * the unsigned encoding used everywhere else for an index.
 */
function vtBytes(v: ValType, ix: Index, lineNo: number): number[] {
  if (v.k !== "ref") return [v.byte];
  const at = ix.typeOf.get(v.to);
  if (at === undefined) throw new WaxError(lineNo, `no type ${v.to}`);
  return [v.nullable ? 0x63 : 0x64, ...sleb(BigInt(at))];
}

/** A heap type, for `ref.null`, `ref.test` and `ref.cast`. */
function heapType(tok: string, ix: Index, lineNo: number): number[] {
  if (tok in ABS) return [ABS[tok].byte];
  if (tok === "none") return [0x71];
  if (tok === "any") return [0x6e];
  if (tok === "eq") return [0x6d];
  // **`none` and `nofunc` are two different bottoms.** wasm's reference types are two hierarchies
  // that never meet, so a null for a funcref is not the null everything else uses.
  if (tok === "nofunc") return [0x73];
  if (tok === "func") return [0x70];
  if (tok === "noextern") return [0x72];
  if (tok === "extern") return [0x6f];
  const at = ix.typeOf.get(tok);
  if (at === undefined) throw new WaxError(lineNo, `no type ${tok}`);
  return sleb(BigInt(at));
}

/** The block type of a block-like: empty, or a single value type. */
function blockType(results: ValType[], ix: Index, lineNo: number): number[] {
  if (results.length === 0) return [0x40];
  if (results.length === 1) return vtBytes(results[0], ix, lineNo);
  throw new WaxError(lineNo, "a block with more than one result needs a type index, unsupported");
}

/** The GC instructions that take one type index, by their second opcode byte. */
const GC1: Record<string, number> = {
  "struct.new": 0x00, "struct.new_default": 0x01,
  "array.new": 0x06, "array.new_default": 0x07,
  "array.get": 0x0b, "array.get_s": 0x0c, "array.get_u": 0x0d, "array.set": 0x0e,
};

/** ...and those that take a type index and a second number: a field index, or a count. */
const GC2: Record<string, number> = {
  "struct.get": 0x02, "struct.get_s": 0x03, "struct.get_u": 0x04, "struct.set": 0x05,
  // `array.new_fixed $A <n>` builds an array from the top n values on the stack, which is the only
  // way to make one whose element type has no default — an array of references, say.
  "array.new_fixed": 0x08,
};

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
  const push = (bytes: number[]) => append(out, bytes);
  for (const { n, tokens: t } of f.body) {
    const op = t[0];
    if (op in NULLARY) { out.push(NULLARY[op]); continue; }
    if (op in GC1) {
      const at = ix.typeOf.get(t[1]);
      if (at === undefined) throw new WaxError(n, `no type ${t[1]}`);
      out.push(0xfb, ...uleb(GC1[op]), ...uleb(at));
      continue;
    }
    if (op in GC2) {
      const at = ix.typeOf.get(t[1]);
      if (at === undefined) throw new WaxError(n, `no type ${t[1]}`);
      out.push(0xfb, ...uleb(GC2[op]), ...uleb(at), ...uleb(Number(t[2])));
      continue;
    }
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
      // **Eight raw bytes, not a LEB.** A float is stored as itself, so this is the one immediate
      // in the format that is not a variable-length integer.
      case "f64.const": {
        const buf = new DataView(new ArrayBuffer(8));
        buf.setFloat64(0, Number(t[1]), true);
        out.push(0x44);
        for (let i = 0; i < 8; i++) out.push(buf.getUint8(i));
        break;
      }
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
      case "array.len": out.push(0xfb, 0x0f); break;
      case "ref.is_null": out.push(0xd1); break;
      case "ref.eq": out.push(0xd3); break;
      case "ref.as_non_null": out.push(0xd4); break;
      case "ref.null": out.push(0xd0, ...heapType(t[1], ix, n)); break;
      // A function as a value, and a call through one. `call_ref` names the *signature*, not the
      // function — which is the whole difference between it and `call`.
      case "ref.func": {
        const at = ix.funcOf.get(t[1]);
        if (at === undefined) throw new WaxError(n, `no function ${t[1]}`);
        out.push(0xd2, ...uleb(at));
        break;
      }
      case "call_ref": {
        const at = ix.typeOf.get(t[1]);
        if (at === undefined) throw new WaxError(n, `no type ${t[1]}`);
        out.push(0x14, ...uleb(at));
        break;
      }
      // `ref.test` and `ref.cast` are written with the nullability they test for, the same two
      // spellings a value type uses, because the opcode differs by exactly that.
      case "ref.test": case "ref.cast": {
        const nullable = t[1] === "refnull";
        if (t[1] !== "ref" && t[1] !== "refnull") {
          throw new WaxError(n, `${op} needs \`ref\` or \`refnull\` and a type`);
        }
        const base = op === "ref.test" ? 0x14 : 0x16;
        out.push(0xfb, ...uleb(base + (nullable ? 1 : 0)), ...heapType(t[2], ix, n));
        break;
      }
      case "block": case "loop": case "if": {
        out.push(op === "block" ? 0x02 : op === "loop" ? 0x03 : 0x04);
        out.push(...blockType(resultsAfterArrow(t, 2, n), ix, n));
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
function localDecls(f: Func, ix: Index): number[] {
  const runs: [ValType, number][] = [];
  for (const l of f.locals) {
    const last = runs[runs.length - 1];
    if (last !== undefined && vtName(last[0]) === vtName(l.type)) last[1]++;
    else runs.push([l.type, 1]);
  }
  return vec(runs.map(([ty, count]) => [...uleb(count), ...vtBytes(ty, ix, 0)]));
}

export function assemble(source: string): Uint8Array {
  const m = read(source);
  const ix = index(m);
  const out: number[] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  const emit = (bytes: number[]) => append(out, bytes);

  // **One recursive group, or none at all.** A struct whose field refers to another struct — an AST
  // node holding an array of nodes — needs the two in the same group, because outside one a type may
  // only name types already defined. Putting every type in a single group is the rule with no cases
  // in it, and it costs two bytes. A module with no GC types keeps the plain encoding, so nothing
  // that assembled before assembles differently now.
  const hasGC = ix.types.some((d) => d.k !== "func");
  const typeEntries = ix.types.map((d) => {
    if (d.k === "func") {
      return [
        0x60,
        ...vec(d.t.params.map((p) => vtBytes(p, ix, 0))),
        ...vec(d.t.results.map((r) => vtBytes(r, ix, 0))),
      ];
    }
    // Every field is mutable. wac has no immutable field and neither does anything above this.
    if (d.k === "struct") {
      return [0x5f, ...vec(d.t.fields.map((fl) => [...vtBytes(fl, ix, 0), 0x01]))];
    }
    return [0x5e, ...vtBytes(d.t.elem, ix, 0), 0x01];
  });
  emit(section(
    1,
    hasGC
      ? [...uleb(1), 0x4e, ...vec(typeEntries)]
      : vec(typeEntries),
  ));

  emit(section(2, vec(m.imports.map((im) => {
    const at = ix.types.findIndex((d) =>
      d.k === "func" && shapeKey(d.t.params, d.t.results) === shapeKey(im.params, im.results)
    );
    return [...name(im.module), ...name(im.field), 0x00, ...uleb(at)];
  }))));

  emit(section(3, vec(ix.funcTypeIndex.map((t) => uleb(t)))));

  if (m.memoryPages !== null) emit(section(5, vec([[0x00, ...uleb(m.memoryPages)]])));

  emit(section(6, vec(m.globals.map((g) => [
    ...vtBytes(g.type, ix, 0), g.mutable ? 0x01 : 0x00,
    ...(g.type.k === "ref"
      ? [0xd0, ...heapType(g.type.to, ix, 0)]              // a reference global starts null
      : g.type.byte === 0x7c
      ? [0x44, ...(() => { const b = new DataView(new ArrayBuffer(8));
                           b.setFloat64(0, Number(g.value), true);
                           return [...new Uint8Array(b.buffer)]; })()]
      : [g.type.byte === 0x7f ? 0x41 : 0x42, ...sleb(g.value)]),
    0x0b,
  ]))));

  emit(section(7, vec(m.exports.map((e) => {
    if (e.kind === "memory") return [...name(e.name), 0x02, 0x00];
    const at = ix.funcOf.get(e.target);
    if (at === undefined) throw new WaxError(0, `export names no function ${e.target}`);
    return [...name(e.name), 0x00, ...uleb(at)];
  }))));

  // **A `ref.func` needs its target declared first.** wasm refuses a reference to a function that
  // no element segment mentions — the rule exists so an engine knows which functions can escape —
  // and the way to say "these, and they are not a table" is a *declarative* segment. So the bodies
  // are scanned for `ref.func` before any of them is emitted, and every name found goes in one.
  const referenced: number[] = [];
  for (const f of m.funcs) {
    for (const l of f.body) {
      if (l.tokens[0] !== "ref.func") continue;
      const at = ix.funcOf.get(l.tokens[1]);
      if (at === undefined) throw new WaxError(l.n, `no function ${l.tokens[1]}`);
      if (!referenced.includes(at)) referenced.push(at);
    }
  }
  if (referenced.length > 0) {
    emit(section(9, vec([[0x03, 0x00, ...vec(referenced.map((a) => uleb(a)))]])));
  }

  // Sections are written in ascending id, which wasm requires: code (10) before data (11).
  emit(section(10, vec(m.funcs.map((f) => {
    const body: number[] = [];
    append(body, localDecls(f, ix));
    append(body, emitBody(f, ix));
    const entry = uleb(body.length);
    append(entry, body);
    return entry;
  }))));

  emit(section(11, vec(m.data.map((d) => [
    0x00, 0x41, ...sleb(BigInt(d.offset)), 0x0b, ...uleb(d.bytes.length), ...d.bytes,
  ]))));

  return new Uint8Array(out);
}
