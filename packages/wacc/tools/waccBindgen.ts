// wacc's bindgen: TypeScript that calls a wacc-compiled module.
//
// The reference's `wacBindgen.ts` is 1,011 lines and covers every type wac has. This covers the
// types a host most often crosses with — the numbers, `bool`, `string` and a numeric array — and
// says so: `unsupported()` lists what it declined rather than emitting glue that will not work.
//
// The split is deliberate. Which functions are exported and what they take is a question only the
// compiler can answer, so wacc answers it (`exportSigsFiles`); turning that into text is text, and
// lives here, where `waccx` already is.
//
// The module's own helpers do the crossing: `$bind$str_*` and `$bind$arr_*` for the references,
// `$bind$mem`/`$bind$mem_ensure` for the staging buffer. This file writes the calls; it invents
// nothing about the representation.

/** One exported function, as the compiler describes it. */
export type ExportSig = { name: string; ret: string; params: string[] };

/** Parse `name\tret\tparam,param` lines — the shape `exportSigsFiles` returns. */
export function parseSigs(wire: string): ExportSig[] {
  const out: ExportSig[] = [];
  for (const line of wire.split("\n")) {
    if (line === "") continue;
    const [name, ret, params] = line.split("\t");
    out.push({ name, ret, params: params === "" || params === undefined ? [] : splitTop(params, ",") });
  }
  return out;
}

/** A struct or enum a host can hold, as `bindTypesFiles` describes it. */
export type BindType = {
  kind: "struct" | "enum";
  name: string;
  bind: string;
  fields: { name: string; type: string }[];
  variants: { name: string; payload: { name: string; type: string }[] }[];
  methods: { name: string; hasThis: boolean; ret: string; params: string[] }[];
};

/** A callback signature the module imports a dispatcher for. */
export type Callback = { index: number; ret: string; params: string[]; wac: string };

/** Parse the `C` lines — the callbacks, in the order `wac.cb<j>` is numbered. */
export function parseCallbacks(wire: string): Callback[] {
  return parseSigLines(wire, "C");
}

/** Parse the `O` lines — the funcrefs handed out, one `$bind$callref_<j>` each. */
export function parseOutRefs(wire: string): Callback[] {
  return parseSigLines(wire, "O");
}

function parseSigLines(wire: string, tag: string): Callback[] {
  const out: Callback[] = [];
  for (const line of wire.split("\n")) {
    if (!line.startsWith(`${tag}\t`)) continue;
    const [, index, ret, params, wac] = line.split("\t");
    out.push({
      index: Number(index),
      ret,
      params: params === "" || params === undefined ? [] : splitTop(params, ","),
      wac,
    });
  }
  return out;
}

/**
 * Split on `sep`, ignoring any that is inside brackets.
 *
 * A type can hold the separator: `Map<u8[],i32>` is one field type with a comma in it, and a plain
 * `split(",")` turned `index:Map<u8[],i32>` into a field named `index` of type `Map<u8[]` and a
 * second field called `i32>`. The glue that came out declared a parameter named `i32>` and did not
 * parse — a wire that says the right thing, read wrongly.
 */
function splitTop(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "<" || ch === "[" || ch === "(") depth++;
    else if (ch === ">" || ch === "]" || ch === ")") depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** Parse the `S`/`E`/`M` lines `bindTypesFiles` returns. */
export function parseBindTypes(wire: string): BindType[] {
  const out: BindType[] = [];
  const byBind = new Map<string, BindType>();
  for (const line of wire.split("\n")) {
    if (line === "") continue;
    const cells = line.split("\t");
    if (cells[0] === "S" || cells[0] === "E") {
      const t: BindType = {
        kind: cells[0] === "S" ? "struct" : "enum",
        name: cells[1],
        bind: cells[2],
        fields: [],
        variants: [],
        methods: [],
      };
      if (cells[0] === "S" && cells[3]) {
        for (const f of splitTop(cells[3], ",")) {
          const at = f.indexOf(":");
          t.fields.push({ name: f.slice(0, at), type: f.slice(at + 1) });
        }
      }
      if (cells[0] === "E" && cells[3]) {
        for (const v of splitTop(cells[3], ";")) {
          const [name, ...rest] = v.split(":");
          const payload: { name: string; type: string }[] = [];
          if (rest.length > 0 && rest.join(":") !== "") {
            for (const f of splitTop(rest.join(":"), "|")) {
              const at = f.indexOf(":");
              payload.push({ name: f.slice(0, at), type: f.slice(at + 1) });
            }
          }
          t.variants.push({ name, payload });
        }
      }
      out.push(t);
      byBind.set(t.bind, t);
    } else if (cells[0] === "M") {
      const owner = byBind.get(cells[1]);
      if (!owner) continue;
      owner.methods.push({
        name: cells[2],
        hasThis: cells[3] === "this",
        ret: cells[4],
        params: cells[5] === "" || cells[5] === undefined ? [] : splitTop(cells[5], ","),
      });
    }
  }
  return out;
}

/** Whether a callback's own parameters and result are things a host can hand over. */
export function usableSig(c: Callback): boolean {
  return ![c.ret, ...c.params].some(t => t.startsWith("fn["));
}

const SCALARS = new Set(["i32", "u32", "i64", "u64", "f32", "f64", "bool", "void"]);
/** The arrays that cross through the staging buffer, which is where `_to_mem`/`_from_mem` exist. */
const BULK = new Set(["u8[]", "i8[]", "i32[]", "u32[]", "i64[]", "u64[]", "f32[]", "f64[]"]);

/**
 * The helper suffix an array's family is exported under — `string[]` is `string`, `u8[][]` is
 * `u8Arr`, `u8[][][]` is `u8ArrArr`. The module builds the same name from the same rule, and the
 * two have to agree or the glue calls a function that is not there.
 */
function arrSuffix(t: string): string {
  const el = t.slice(0, -2);
  if (el.endsWith("[]")) return `${arrSuffix(el)}Arr`;
  // A monomorphisation's element is spelled the way the module spells it — `MapEntry<u8[],i32>`
  // is `MapEntry$u8$i32` — because the export name has to be one a host can write.
  return /[^A-Za-z0-9_]/.test(el)
    ? el.replace(/[^A-Za-z0-9_]+/g, "$").replace(/\$+$/, "")
    : el;
}

/** An array whose elements are references — a `string[]` or an array of arrays. */
function isRefArray(t: string, named: Set<string>): boolean {
  if (!t.endsWith("[]") || BULK.has(t)) return false;
  const el = t.slice(0, -2);
  return el === "string" || el.endsWith("[]") || named.has(el);
}

/** Whether this signature is one this generator can write glue for. */
export function supported(
  sig: ExportSig, types: BindType[] = [], cbs: Callback[] = [], outs: Callback[] = [],
): boolean {
  const named = new Set(types.map(t => t.name));
  // **A callback whose own signature mentions a funcref is not one a host can supply.** The
  // dispatcher would take a WasmGC reference as an argument, and JavaScript has no way to make or
  // read one; the module still imports it, so the glue below defines a dispatcher that throws
  // rather than leaving `wac.cbN` unbound and the instantiation failing.
  const callable = new Set(cbs.filter(usableSig).map(c => c.wac));
  const handedOut = new Set(outs.filter(usableSig).map(c => c.wac));
  // A funcref *parameter* is a host function coming in, which a dispatcher answers; one in return
  // position is a wac function going out, which `$bind$callref_*` answers. A funcref nested inside
  // another signature — a callback that itself takes one — is neither, and stays declined.
  // **`T?` is `T` plus null.** wac's wasm type is the same for both — every reference this emitter
  // writes is nullable — but a host has to be told, or `JsonValue? parse(u8[])` hands back a wrapper
  // around nothing where the caller checks for `null` [issue 0102].
  const ok = (t0: string): boolean => {
    const t = t0.endsWith("?") ? t0.slice(0, -1) : t0;
    if (t0.endsWith("?") && SCALARS.has(t)) return false;   // no boxed `i32?` at the boundary
    return SCALARS.has(t) || t === "string" || BULK.has(t) || named.has(t) ||
      (isRefArray(t, named) && ok(t.slice(0, -2)));
  };
  return (ok(sig.ret) || handedOut.has(sig.ret)) && sig.params.every(t => ok(t) || callable.has(t));
}

/** The classes in play, so `tsType` and the conversions can name them. */
let namedTypes: Map<string, BindType> = new Map();
/** The callbacks, by their wac spelling, so a parameter knows which dispatcher it belongs to. */
let callbacks: Map<string, Callback> = new Map();
/** The funcrefs handed out, so a return knows which `callref` helper calls it. */
let outRefs: Map<string, Callback> = new Map();

/** The TypeScript type a wac type crosses as. */
function tsType(t: string): string {
  if (t.endsWith("?")) return `${tsType(t.slice(0, -1))} | null`;
  const n = namedTypes.get(t);
  if (n) return classNameOf(n);
  const c = callbacks.get(t) ?? outRefs.get(t);
  if (c) return `(${c.params.map((p, i) => `a${i}: ${tsType(p)}`).join(", ")}) => ${tsType(c.ret)}`;
  if (t === "void") return "void";
  if (t === "bool") return "boolean";
  if (t === "i64" || t === "u64") return "bigint";
  if (t === "string") return "string";
  if (BULK.has(t)) return arrayClass(t);
  if (isRefArray(t, new Set(namedTypes.keys()))) return `${tsType(t.slice(0, -2))}[]`;
  return "number";
}

function arrayClass(t: string): string {
  const el = t.slice(0, -2);
  return {
    "u8": "Uint8Array", "i8": "Int8Array", "i32": "Int32Array", "u32": "Uint32Array",
    "i64": "BigInt64Array", "u64": "BigUint64Array", "f32": "Float32Array", "f64": "Float64Array",
  }[el] ?? "Uint8Array";
}

/** How many bytes one element takes in the staging buffer. */
function width(t: string): number {
  const el = t.slice(0, -2);
  return { "u8": 1, "i8": 1, "i32": 4, "u32": 4, "i64": 8, "u64": 8, "f32": 4, "f64": 8 }[el] ?? 1;
}

/** A value crossing *into* the module. */
function toWasm(t: string, expr: string): string {
  // `null` crosses as `null`: the wasm type already admits it, so only the wrapper has to be
  // unwrapped when there is one.
  if (t.endsWith("?")) {
    const inner = t.slice(0, -1);
    return namedTypes.has(inner) ? `(${expr} === null ? null : ${toWasm(inner, expr)})` : expr;
  }
  const c = callbacks.get(t);
  if (c) return `$fnref${c.index}(${expr})`;
  if (t === "string") return `$strTo(${expr})`;
  if (BULK.has(t)) return `$arrTo_${t.slice(0, -2)}(${expr})`;
  if (isRefArray(t, new Set(namedTypes.keys()))) return `$arrTo_${arrSuffix(t)}(${expr})`;
  if (namedTypes.has(t)) return `${expr}.$ref`;
  return expr;
}

/** A value crossing *out* of it. */
function fromWasm(t: string, expr: string): string {
  if (t.endsWith("?")) {
    const inner = t.slice(0, -1);
    return `((r) => r === null ? null : ${fromWasm(inner, "r")})(${expr})`;
  }
  const o = outRefs.get(t);
  if (o) {
    // A closure over the reference: JavaScript cannot call a funcref, but it can call the export
    // that does the `call_ref`, and the reference goes in front of the arguments.
    const args = o.params.map((p, i) => `a${i}: ${tsType(p)}`).join(", ");
    const fwd = o.params.map((p, i) => toWasm(p, `a${i}`)).join(", ");
    const call = `($exports.$bind$callref_${o.index} as CallableFunction)($f${fwd ? ", " + fwd : ""})`;
    return `(($f) => (${args}) => ${fromWasm(o.ret, call)})(${expr})`;
  }
  if (t === "string") return `$strFrom(${expr})`;
  if (BULK.has(t)) return `$arrFrom_${t.slice(0, -2)}(${expr})`;
  if (isRefArray(t, new Set(namedTypes.keys()))) return `$arrFrom_${arrSuffix(t)}(${expr})`;
  if (namedTypes.has(t)) return `new ${classNameOf(namedTypes.get(t)!)}(${expr})`;
  if (t === "bool") return `${expr} !== 0`;
  return `${expr} as ${tsType(t)}`;
}

/**
 * A struct or an enum as a class holding the reference.
 *
 * Nothing is copied: `$ref` is the WasmGC reference itself, and every accessor calls back into the
 * module. That is the reference's design too, and it is what makes a wrapper cheap enough to hand
 * around — a `Point` returned from one call can go straight into the next.
 */
/**
 * The class name for a bind type.
 *
 * A monomorphisation's name is its *type*, `Vec<Setting>`, which is not a name a TypeScript file can
 * declare — so it is reduced the way the reference reduces one: `[]` reads as `Arr` and `?` as
 * `Opt`, because `Map<u8[],i32>` spelled character by character is not a name anyone would ship, and
 * everything else that is not an identifier becomes `$`, which wac's lexer rejects and so cannot
 * collide with a name somebody wrote.
 */
function classNameOf(t: { name: string }): string {
  return t.name
    .replace(/\[\]/g, "Arr")
    .replace(/\?/g, "Opt")
    .replace(/[^A-Za-z0-9_]+/g, "$")
    .replace(/\$+$/, "");
}

function classFor(t: BindType): string[] {
  const lines: string[] = [];
  const doc = t.kind === "enum"
    ? `/** \`${t.name}\`, held by reference. \`tag\` says which variant it is. */`
    : `/** \`${t.name}\`, held by reference. Fields and methods call into the module. */`;
  lines.push(doc);
  lines.push(`export class ${classNameOf(t)} {`);
  lines.push("  constructor(readonly $ref: unknown) {}");
  if (t.kind === "struct") {
    const args = t.fields.map(f => `${f.name}: ${tsType(f.type)}`).join(", ");
    const conv = t.fields.map(f => toWasm(f.type, f.name)).join(", ");
    // `classNameOf`, not `t.name`: an instance's *type* is `Pending<i32>` and its class is
    // `Pending$i32` — the raw name in code position is `new Pending<i32>(…)`, which TypeScript reads
    // as a generic call on a name nothing declares [issue 0106].
    lines.push(`  static $of(${args}): ${classNameOf(t)} {`);
    lines.push(`    return new ${classNameOf(t)}(($exports.$bind$s_${t.bind}_new as CallableFunction)(${conv}));`);
    lines.push("  }");
    for (const f of t.fields) {
      lines.push(`  get ${f.name}(): ${tsType(f.type)} {`);
      lines.push(`    return ${fromWasm(f.type, `($exports.$bind$s_${t.bind}_get_${f.name} as CallableFunction)(this.$ref)`)};`);
      lines.push("  }");
      lines.push(`  set ${f.name}(v: ${tsType(f.type)}) {`);
      lines.push(`    ($exports.$bind$s_${t.bind}_set_${f.name} as CallableFunction)(this.$ref, ${toWasm(f.type, "v")});`);
      lines.push("  }");
    }
  } else {
    for (const v of t.variants) {
      const args = v.payload.map(f => `${f.name}: ${tsType(f.type)}`).join(", ");
      const conv = v.payload.map(f => toWasm(f.type, f.name)).join(", ");
      lines.push(`  static ${v.name}(${args}): ${t.name} {`);
      lines.push(`    return new ${t.name}(($exports.$bind$e_${t.bind}_${v.name}_new as CallableFunction)(${conv}));`);
      lines.push("  }");
    }
    // The union is `"A" | "B"` and the lookup table is `["A", "B"]` — the same names, two
    // separators. Written with one, `["A" | "B"]` is a one-element array holding a *bitwise or* of
    // two strings, which is `0`, and every tag came back `undefined`.
    const union = t.variants.map(v => `"${v.name}"`).join(" | ");
    const list = t.variants.map(v => `"${v.name}"`).join(", ");
    lines.push(`  get tag(): ${union} {`);
    lines.push(`    const t = ($exports.$bind$e_${t.bind}_tag as CallableFunction)(this.$ref) as number;`);
    lines.push(`    return ([${list}] as const)[t];`);
    lines.push("  }");
    for (const v of t.variants) {
      for (const f of v.payload) {
        lines.push(`  /** The \`${f.name}\` of a \`${v.name}\` — check \`tag\` first. */`);
        // A getter, as the reference's generator writes it: a caller reads `v.Bool_value`, and a
        // method of that name hands back the function object instead — which compares unequal to
        // everything and reads as a wrong answer rather than a missing feature [issue 0102].
        lines.push(`  get ${v.name}_${f.name}(): ${tsType(f.type)} {`);
        lines.push(`    return ${fromWasm(f.type, `($exports.$bind$e_${t.bind}_${v.name}_get_${f.name} as CallableFunction)(this.$ref)`)};`);
        lines.push("  }");
      }
    }
  }
  for (const m of t.methods) {
    const args = m.params.map((p, i) => `a${i}: ${tsType(p)}`).join(", ");
    const conv = m.params.map((p, i) => toWasm(p, `a${i}`)).join(", ");
    const helper = m.hasThis ? `$bind$m_${t.bind}_${m.name}` : `$bind$sm_${t.bind}_${m.name}`;
    const call = `($exports.${helper} as CallableFunction)(${m.hasThis ? ["this.$ref", conv].filter(Boolean).join(", ") : conv})`;
    const sig = m.hasThis ? `${m.name}(${args})` : `static ${m.name}(${args})`;
    lines.push(`  ${sig}: ${tsType(m.ret)} {`);
    lines.push(m.ret === "void" ? `    ${call};` : `    return ${fromWasm(m.ret, call)};`);
    lines.push("  }");
  }
  lines.push("}");
  lines.push("");
  return lines;
}

/**
 * The generated module: one exported function per wac export, plus the conversions they need.
 *
 * `bytes` is the wasm as a base64 string so the result is a single self-contained file — the same
 * choice the reference makes, and for the same reason: a `.gen.ts` that needs a `.wasm` beside it is
 * two things to keep in step.
 */
export function generate(
  wasm: Uint8Array, sigs: ExportSig[], types: BindType[] = [], cbs: Callback[] = [],
  outs: Callback[] = [],
): string {
  namedTypes = new Map(types.map(t => [t.name, t]));
  callbacks = new Map(cbs.map(c => [c.wac, c]));
  outRefs = new Map(outs.map(c => [c.wac, c]));
  const usable = sigs.filter(s => supported(s, types, cbs, outs));
  const crossing = [
    ...usable.flatMap(s => [s.ret, ...s.params]),
    ...types.flatMap(t => [
      ...t.fields.map(f => f.type),
      ...t.variants.flatMap(v => v.payload.map(f => f.type)),
      ...t.methods.flatMap(m => [m.ret, ...m.params]),
    ]),
  ];
  // **An array of arrays needs its element's helpers too.** `u8[][]` is built by calling
  // `$arrTo_u8` per element, and that only exists if `u8[]` is itself in the crossing set — which it
  // is not, when nothing in a signature says `u8[]` on its own. The glue referred to a function
  // nobody had written [issue 0102].
  for (const t of [...crossing]) {
    let el = t;
    while (el.endsWith("[]") && !BULK.has(el)) { el = el.slice(0, -2); crossing.push(el); }
  }
  const needsMem = crossing.some(t => t === "string" || BULK.has(t));
  const lines: string[] = [];

  lines.push("// Generated by packages/wacc/tools/waccBindgen.ts — do not edit.");
  lines.push("");
  // In chunks: `String.fromCharCode(...wasm)` spreads every byte as an argument, and a module of
  // any size overflows the call stack — `packages/sh` is 900 KB and answered
  // `RangeError: Maximum call stack size exceeded` from the generator rather than from wac.
  let b64 = "";
  for (let i = 0; i < wasm.length; i += 0x8000) {
    b64 += String.fromCharCode(...wasm.subarray(i, i + 0x8000));
  }
  lines.push(`const WASM = "${btoa(b64)}";`);
  lines.push("const bytes = Uint8Array.from(atob(WASM), c => c.charCodeAt(0));");
  lines.push("const $mod = new WebAssembly.Module(bytes as BufferSource);");
  lines.push("");

  if (cbs.length > 0) {
    lines.push("// A host function reaches wac as a *slot number*: JavaScript cannot make a WasmGC");
    lines.push("// funcref, so the module defines one trampoline per slot and imports a dispatcher");
    lines.push("// that this file supplies. `$fnrefN` registers a function and answers the funcref.");
    for (const c of cbs) {
      if (!usableSig(c)) {
        // The import must be satisfied or the module will not instantiate, and this can only ever
        // be reached by wac calling a callback no host could have registered.
        lines.push(`const $cbd${c.index} = () => {`);
        lines.push(`  throw new Error("${c.wac} cannot be supplied from JavaScript");`);
        lines.push("};");
        lines.push("");
        continue;
      }
      const params = c.params.map((p, i) => `a${i}: ${tsType(p)}`).join(", ");
      const fwd = c.params.map((p, i) => fromWasm(p, `a${i}`)).join(", ");
      const raw = c.params.map((p, i) => `a${i}: unknown`).join(", ");
      lines.push(`const $cbs${c.index}: ((${params}) => ${tsType(c.ret)})[] = [];`);
      lines.push(`const $cbd${c.index} = ($slot: number${raw ? ", " + raw : ""}) =>`);
      lines.push(`  ${toWasm(c.ret, `$cbs${c.index}[$slot](${fwd})`)};`);
      lines.push(`function $fnref${c.index}(f: (${params}) => ${tsType(c.ret)}): unknown {`);
      lines.push(`  let slot = $cbs${c.index}.indexOf(f);`);
      lines.push("  if (slot < 0) {");
      lines.push(`    slot = $cbs${c.index}.length;`);
      lines.push("    if (slot >= 16) {");
      lines.push(`      throw new RangeError("at most 16 distinct ${c.wac} functions can be passed to this module");`);
      lines.push("    }");
      lines.push(`    $cbs${c.index}.push(f);`);
      lines.push("  }");
      lines.push(`  return ($exports.$bind$fnref_${c.index} as CallableFunction)(slot);`);
      lines.push("}");
      lines.push("");
    }
    const dispatchers = cbs.map(c => `cb${c.index}: $cbd${c.index}`).join(", ");
    lines.push(`const $inst = new WebAssembly.Instance($mod, { wac: { ${dispatchers} } });`);
  } else {
    lines.push("const $inst = new WebAssembly.Instance($mod, {});");
  }
  lines.push("const $exports = $inst.exports as Record<string, CallableFunction>;");
  lines.push("");

  if (needsMem) {
    lines.push("const $memory = $inst.exports.$bind$mem as WebAssembly.Memory;");
    lines.push("/** Grow the staging buffer to hold `n` bytes and answer a fresh view of it. */");
    lines.push("function $buffer(n: number): Uint8Array {");
    lines.push("  ($exports.$bind$mem_ensure as CallableFunction)(n);");
    lines.push("  return new Uint8Array($memory.buffer);");
    lines.push("}");
    lines.push("");
    lines.push("function $strTo(s: string): unknown {");
    lines.push("  const b = new TextEncoder().encode(s);");
    lines.push("  $buffer(b.length).set(b, 0);");
    lines.push("  return ($exports.$bind$str_from_mem as CallableFunction)(b.length);");
    lines.push("}");
    lines.push("");
    lines.push("function $strFrom(w: unknown): string {");
    // **Ask the length, make room, *then* copy.** `_to_mem` writes into the staging buffer and does
    // not grow it — its own comment says so, because a short copy is a wrong answer and a trap is
    // not. Calling it straight meant anything longer than the one page the module starts with
    // trapped with `memory access out of bounds`: `export u8[] grow(i32 n)` was fine to 65536 and
    // trapped at 65537.
    lines.push("  const n = ($exports.$bind$str_len as CallableFunction)(w) as number;");
    lines.push("  $buffer(n);");
    lines.push("  ($exports.$bind$str_to_mem as CallableFunction)(w);");
    lines.push("  return new TextDecoder().decode(new Uint8Array($memory.buffer).slice(0, n));");
    lines.push("}");
    lines.push("");
  }

  // **The arrays whose elements are references.** There is no staging buffer for these — an element
  // is a WasmGC value, not bytes — so they are built and read one element at a time through the
  // `_new`/`_set`/`_get`/`_len` family the module exports for every array type. `string[]`'s `_new`
  // takes a fill because a string reference has no default; an array element is nullable and does
  // not, which is why the two are spelled apart [issue 0102].
  const namedSet = new Set(namedTypes.keys());
  for (const t of new Set(crossing.filter(t => isRefArray(t, namedSet)))) {
    const sfx = arrSuffix(t);
    const el = t.slice(0, -2);
    const ets = tsType(el);
    lines.push(`function $arrTo_${sfx}(a: ${ets}[]): unknown {`);
    if (el === "string") {
      lines.push(`  if (a.length === 0) return ($exports.$bind$arr_${sfx}_new0 as CallableFunction)();`);
      lines.push(`  const w = ($exports.$bind$arr_${sfx}_new as CallableFunction)(a.length, ${toWasm(el, "a[0]")});`);
    } else {
      lines.push(`  const w = ($exports.$bind$arr_${sfx}_new as CallableFunction)(a.length);`);
    }
    lines.push(`  for (let i = 0; i < a.length; i++) {`);
    lines.push(`    ($exports.$bind$arr_${sfx}_set as CallableFunction)(w, i, ${toWasm(el, "a[i]")});`);
    lines.push("  }");
    lines.push("  return w;");
    lines.push("}");
    lines.push("");
    lines.push(`function $arrFrom_${sfx}(w: unknown): ${ets}[] {`);
    lines.push(`  const n = ($exports.$bind$arr_${sfx}_len as CallableFunction)(w) as number;`);
    lines.push(`  const out: ${ets}[] = [];`);
    lines.push(`  for (let i = 0; i < n; i++) {`);
    lines.push(`    out.push(${fromWasm(el, `($exports.$bind$arr_${sfx}_get as CallableFunction)(w, i)`)});`);
    lines.push("  }");
    lines.push("  return out;");
    lines.push("}");
    lines.push("");
  }

  for (const t of new Set(crossing.filter(t => BULK.has(t)))) {
    const el = t.slice(0, -2);
    const cls = arrayClass(t);
    const w = width(t);
    lines.push(`function $arrTo_${el}(a: ${cls}): unknown {`);
    lines.push(`  const view = $buffer(a.length * ${w});`);
    lines.push(`  new ${cls}(view.buffer, 0, a.length).set(a);`);
    lines.push(`  return ($exports.$bind$arr_${el}_from_mem as CallableFunction)(a.length);`);
    lines.push("}");
    lines.push("");
    lines.push(`function $arrFrom_${el}(w: unknown): ${cls} {`);
    lines.push(`  const n = ($exports.$bind$arr_${el}_len as CallableFunction)(w) as number;`);
    lines.push(`  $buffer(n * ${w});`);   // see $strFrom: `_to_mem` does not grow the buffer
    lines.push(`  ($exports.$bind$arr_${el}_to_mem as CallableFunction)(w);`);
    lines.push(`  return new ${cls}($memory.buffer.slice(0, n * ${w}));`);
    lines.push("}");
    lines.push("");
  }

  for (const t of types) lines.push(...classFor(t));

  for (const sig of usable) {
    const args = sig.params.map((t, i) => `a${i}: ${tsType(t)}`).join(", ");
    const conv = sig.params.map((t, i) => toWasm(t, `a${i}`)).join(", ");
    lines.push(`export function ${sig.name}(${args}): ${tsType(sig.ret)} {`);
    const call = `($exports.${sig.name} as CallableFunction)(${conv})`;
    if (sig.ret === "void") lines.push(`  ${call};`);
    else lines.push(`  return ${fromWasm(sig.ret, call)};`);
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

/** What this generator declined, so a caller learns it rather than discovering it at run time. */
export function unsupported(
  sigs: ExportSig[], types: BindType[] = [], cbs: Callback[] = [], outs: Callback[] = [],
): string[] {
  return sigs.filter(s => !supported(s, types, cbs, outs))
    .map(s => `${s.name}(${s.params.join(", ")}) -> ${s.ret}`);
}
