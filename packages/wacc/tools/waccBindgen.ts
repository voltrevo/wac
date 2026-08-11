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
    out.push({ name, ret, params: params === "" || params === undefined ? [] : params.split(",") });
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
  const out: Callback[] = [];
  for (const line of wire.split("\n")) {
    if (!line.startsWith("C\t")) continue;
    const [, index, ret, params, wac] = line.split("\t");
    out.push({
      index: Number(index),
      ret,
      params: params === "" || params === undefined ? [] : params.split(","),
      wac,
    });
  }
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
        for (const f of cells[3].split(",")) {
          const [name, type] = f.split(":");
          t.fields.push({ name, type });
        }
      }
      if (cells[0] === "E" && cells[3]) {
        for (const v of cells[3].split(";")) {
          const [name, ...rest] = v.split(":");
          const payload: { name: string; type: string }[] = [];
          if (rest.length > 0 && rest.join(":") !== "") {
            for (const f of rest.join(":").split("|")) {
              const [fn, ft] = f.split(":");
              payload.push({ name: fn, type: ft });
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
        params: cells[5] === "" || cells[5] === undefined ? [] : cells[5].split(","),
      });
    }
  }
  return out;
}

const SCALARS = new Set(["i32", "u32", "i64", "u64", "f32", "f64", "bool", "void"]);
/** The arrays that cross through the staging buffer, which is where `_to_mem`/`_from_mem` exist. */
const BULK = new Set(["u8[]", "i8[]", "i32[]", "u32[]", "i64[]", "u64[]", "f32[]", "f64[]"]);

/** Whether this signature is one this generator can write glue for. */
export function supported(sig: ExportSig, types: BindType[] = [], cbs: Callback[] = []): boolean {
  const named = new Set(types.map(t => t.name));
  const callable = new Set(cbs.map(c => c.wac));
  // A funcref *parameter* is a host function coming in, which is what a dispatcher is for. One in
  // return position would be a wac function going out — `$bind$callref_*` in the reference, which
  // this emitter does not write yet — so it stays declined.
  const ok = (t: string) => SCALARS.has(t) || t === "string" || BULK.has(t) || named.has(t);
  return ok(sig.ret) && sig.params.every(t => ok(t) || callable.has(t));
}

/** The classes in play, so `tsType` and the conversions can name them. */
let namedTypes: Map<string, BindType> = new Map();
/** The callbacks, by their wac spelling, so a parameter knows which dispatcher it belongs to. */
let callbacks: Map<string, Callback> = new Map();

/** The TypeScript type a wac type crosses as. */
function tsType(t: string): string {
  const n = namedTypes.get(t);
  if (n) return n.name;
  const c = callbacks.get(t);
  if (c) return `(${c.params.map((p, i) => `a${i}: ${tsType(p)}`).join(", ")}) => ${tsType(c.ret)}`;
  if (t === "void") return "void";
  if (t === "bool") return "boolean";
  if (t === "i64" || t === "u64") return "bigint";
  if (t === "string") return "string";
  if (BULK.has(t)) return arrayClass(t);
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
  const c = callbacks.get(t);
  if (c) return `$fnref${c.index}(${expr})`;
  if (t === "string") return `$strTo(${expr})`;
  if (BULK.has(t)) return `$arrTo_${t.slice(0, -2)}(${expr})`;
  if (namedTypes.has(t)) return `${expr}.$ref`;
  return expr;
}

/** A value crossing *out* of it. */
function fromWasm(t: string, expr: string): string {
  if (t === "string") return `$strFrom(${expr})`;
  if (BULK.has(t)) return `$arrFrom_${t.slice(0, -2)}(${expr})`;
  if (namedTypes.has(t)) return `new ${namedTypes.get(t)!.name}(${expr})`;
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
function classFor(t: BindType): string[] {
  const lines: string[] = [];
  const doc = t.kind === "enum"
    ? `/** \`${t.name}\`, held by reference. \`tag\` says which variant it is. */`
    : `/** \`${t.name}\`, held by reference. Fields and methods call into the module. */`;
  lines.push(doc);
  lines.push(`export class ${t.name} {`);
  lines.push("  constructor(readonly $ref: unknown) {}");
  if (t.kind === "struct") {
    const args = t.fields.map(f => `${f.name}: ${tsType(f.type)}`).join(", ");
    const conv = t.fields.map(f => toWasm(f.type, f.name)).join(", ");
    lines.push(`  static $of(${args}): ${t.name} {`);
    lines.push(`    return new ${t.name}(($exports.$bind$s_${t.bind}_new as CallableFunction)(${conv}));`);
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
        lines.push(`  ${v.name}_${f.name}(): ${tsType(f.type)} {`);
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
): string {
  namedTypes = new Map(types.map(t => [t.name, t]));
  callbacks = new Map(cbs.map(c => [c.wac, c]));
  const usable = sigs.filter(s => supported(s, types, cbs));
  const crossing = [
    ...usable.flatMap(s => [s.ret, ...s.params]),
    ...types.flatMap(t => [
      ...t.fields.map(f => f.type),
      ...t.variants.flatMap(v => v.payload.map(f => f.type)),
      ...t.methods.flatMap(m => [m.ret, ...m.params]),
    ]),
  ];
  const needsMem = crossing.some(t => t === "string" || BULK.has(t));
  const lines: string[] = [];

  lines.push("// Generated by packages/wacc/tools/waccBindgen.ts — do not edit.");
  lines.push("");
  lines.push(`const WASM = "${btoa(String.fromCharCode(...wasm))}";`);
  lines.push("const bytes = Uint8Array.from(atob(WASM), c => c.charCodeAt(0));");
  lines.push("const $mod = new WebAssembly.Module(bytes as BufferSource);");
  lines.push("");

  if (cbs.length > 0) {
    lines.push("// A host function reaches wac as a *slot number*: JavaScript cannot make a WasmGC");
    lines.push("// funcref, so the module defines one trampoline per slot and imports a dispatcher");
    lines.push("// that this file supplies. `$fnrefN` registers a function and answers the funcref.");
    for (const c of cbs) {
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
    lines.push("  const n = ($exports.$bind$str_to_mem as CallableFunction)(w) as number;");
    lines.push("  return new TextDecoder().decode(new Uint8Array($memory.buffer).slice(0, n));");
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
    lines.push(`  const n = ($exports.$bind$arr_${el}_to_mem as CallableFunction)(w) as number;`);
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
export function unsupported(sigs: ExportSig[], types: BindType[] = [], cbs: Callback[] = []): string[] {
  return sigs.filter(s => !supported(s, types, cbs))
    .map(s => `${s.name}(${s.params.join(", ")}) -> ${s.ret}`);
}
