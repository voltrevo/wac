// wacBindgen — generates a self-contained TypeScript file from a compiled wac module.
//
// The generated file embeds the wasm binary as base64 and provides typed wrapper
// functions for each exported function.
//
// Type mapping:
//   i32, f32, f64, bool → number
//   i64                 → bigint
//   string              → string   (copied in/out via wasm helper exports)
//   u8[]                → Uint8Array      i8[]  → Int8Array
//   u16[]               → Uint16Array     i16[] → Int16Array
//   i32[]               → Int32Array      u32[] → Uint32Array
//   u64[]               → BigUint64Array
//   i64[]               → BigInt64Array
//   f32[]               → Float32Array
//   f64[]               → Float64Array
//
// Unsupported types (struct, nullable, funcref, nested arrays) cause the function
// to be omitted with a comment.

import type { WacCompiled, WacExport, WacStruct, WacEnum, WacCallback, WacArray } from "./wacCompile.ts";

// ── Type mapping ──────────────────────────────────────────────────────────────

const PRIM_MAP: Record<string, string> = {
  i32: "number", i8: "number", i16: "number", u32: "number",
  f32: "number", f64: "number",
  bool: "boolean",
  i64: "bigint", u64: "bigint",
  void: "void",
  string: "string",
};

const ARRAY_MAP: Record<string, string> = {
  // i8/i16 sign-extend on read and u8/u16 zero-extend, so each maps to the
  // typed array with matching semantics. Byte data is u8[] -> Uint8Array.
  "u8[]":  "Uint8Array",
  "i8[]":  "Int8Array",
  "u16[]": "Uint16Array",
  "i16[]": "Int16Array",
  "i32[]": "Int32Array",
  "u32[]": "Uint32Array",
  "i64[]": "BigInt64Array",
  "u64[]": "BigUint64Array",
  "f32[]": "Float32Array",
  "f64[]": "Float64Array",
};

const ARRAY_ELEM_WIDTH: Record<string, number> = {
  "u8[]": 1, "i8[]": 1, "u16[]": 2, "i16[]": 2,
  "i32[]": 4, "u32[]": 4, "i64[]": 8, "u64[]": 8, "f32[]": 4, "f64[]": 8,
};

const ARRAY_ELEM_PREFIX: Record<string, string> = {
  "u8[]":  "__bind_arr_u8",
  "i8[]":  "__bind_arr_i8",
  "u16[]": "__bind_arr_u16",
  "i16[]": "__bind_arr_i16",
  "i32[]": "__bind_arr_i32",
  "u32[]": "__bind_arr_u32",
  "i64[]": "__bind_arr_i64",
  "u64[]": "__bind_arr_u64",
  "f32[]": "__bind_arr_f32",
  "f64[]": "__bind_arr_f64",
};

/**
 * The structs of the module being generated, by the name a type refers to them by.
 *
 * Module-level because `tsType` is called from a dozen places and threading a table through all of
 * them would be noise. Set once per `wacBindgen` call.
 */
let structsByWac: Map<string, WacStruct> = new Map();
/** The enums of the module being generated, by the name a type refers to them by. */
let enumsByWac: Map<string, WacEnum> = new Map();
/**
 * The funcref signatures the host may supply a function for, by the type as written.
 *
 * Only signatures an exported function actually takes are here, which is what
 * makes a callback a capability: a module that asks for no function cannot be
 * given one, and one it is given reaches only as far as the value goes.
 */
let callbacksByType: Map<string, WacCallback & { index: number }> = new Map();
/**
 * The array types the boundary can carry, by the type as written.
 *
 * Primitive arrays keep their bulk path — one copy through the staging buffer.
 * An array of references has no memory representation, so it crosses element by
 * element through the same accessors a struct field uses.
 */
let arraysByWac: Map<string, WacArray> = new Map();
/**
 * Members left out of a generated class, with the reason.
 *
 * A method whose signature the boundary cannot carry used to be dropped in
 * silence, which is the same failure the export skip list exists to prevent: the
 * class arrives missing the one accessor it was wanted for and nothing says why.
 */
let skippedMembers: string[] = [];
/**
 * Primitives with a boxed nullable form in this module.
 *
 * `i32?` is a one-field struct wasm-side, so it arrives as a reference the host can
 * do nothing with unless it reads the box. With the accessors it is `number | null`,
 * which is what a JavaScript caller means by a nullable number.
 */
let boxedPrims: Set<string> = new Set();
/**
 * Whether the module can leave a trap message, and so whether the wrappers should
 * look for one.
 *
 * Only wrappers around exported functions and methods are guarded. A `trap "…"` runs
 * wac code, and wac code is only entered through those two — a field accessor or an
 * array helper can trap, but never with a message.
 */
let hasTrapMessages = false;
/**
 * Funcref signatures handed back, by the type as written.
 *
 * JavaScript cannot call a wasm function reference. It can call an export that does
 * the `call_ref` for it, so a returned funcref arrives as a closure holding the
 * reference — the mirror of a host function going the other way.
 */
let outFuncrefsByType: Map<string, WacCallback & { index: number }> = new Map();

/**
 * The TypeScript class name for a struct or enum — `Vec<i32>` becomes `Vec_i32`.
 *
 * An array argument reads as `Arr` rather than as the punctuation it is made of, because
 * `Map<u8[], i32>` sanitised character by character gives `Map_u8____i32`, which is not a name
 * anyone would ship. A nullable argument reads as `Opt` for the same reason, and because
 * without it the name is not unique: collapsing `?` to nothing made `Pending<string?>` and
 * `Pending<string>` both `Pending_string`, and the generated module then declared the same
 * class twice and would not bundle.
 */
function className(s: { display: string }): string {
  return s.display
    .replace(/\[\]/g, "Arr")
    .replace(/\?/g, "Opt")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/_+$/, "");
}

function tsType(wacType: string): string | null {
  if (PRIM_MAP[wacType]) return PRIM_MAP[wacType];
  if (ARRAY_MAP[wacType]) return ARRAY_MAP[wacType];
  const arr = arraysByWac.get(wacType);
  if (arr) {
    const elem = tsType(arr.elem);
    return elem === null ? null : `${elem}[]`;
  }
  const boxed = boxedPrim(wacType);
  if (boxed) return `${PRIM_MAP[boxed]} | null`;
  // A nullable reference to anything else that crosses. Structs and enums have their
  // own branch above because their class name is the answer; a string or an array is
  // just its own type or null. Without this, every fallible thing at the boundary had
  // to invent a result struct.
  const nullRef = nullableRef(wacType);
  if (nullRef) {
    const inner = tsType(nullRef);
    return inner === null ? null : `${inner} | null`;
  }
  const out = outFuncrefsByType.get(wacType);
  if (out) return cbTsType(out);
  // A struct or an enum crosses as an opaque reference wrapped in a generated class, and a nullable
  // one as that class or null — which is what JavaScript already means by an absent object.
  const named = structsByWac.get(wacType) ?? enumsByWac.get(wacType);
  if (named) return className(named);
  if (wacType.endsWith("?")) {
    const inner = structsByWac.get(wacType.slice(0, -1)) ?? enumsByWac.get(wacType.slice(0, -1));
    if (inner) return `${className(inner)} | null`;
  }
  return null; // unsupported
}

/**
 * The inner type of a `T?` whose `T` is a *reference* the boundary already carries —
 * a string or an array. Not structs or enums, which `structOf` handles by name, and
 * not boxed primitives, which are a struct underneath.
 */
function nullableRef(wacType: string): string | null {
  if (!wacType.endsWith("?")) return null;
  const inner = wacType.slice(0, -1);
  if (inner === "string") return inner;
  if (ARRAY_MAP[inner] || arraysByWac.has(inner)) return inner;
  return null;
}

/** The primitive a `P?` boxes, if this type is one the module boxes. */
function boxedPrim(wacType: string): string | null {
  if (!wacType.endsWith("?")) return null;
  const inner = wacType.slice(0, -1);
  return boxedPrims.has(inner) && PRIM_MAP[inner] ? inner : null;
}

/**
 * The TypeScript type of a host function for one wac funcref signature, or null
 * if some parameter of it cannot cross.
 */
/**
 * Only in parameter position. A funcref *returned* stays unbindable: JavaScript
 * cannot call a wasm function reference, so there is nothing to hand back.
 */
function cbTsType(cb: WacCallback): string | null {
  const params: string[] = [];
  for (let i = 0; i < cb.params.length; i++) {
    const t = tsType(cb.params[i]);
    if (t === null) return null;
    params.push(`a${i}: ${t}`);
  }
  const ret = cb.ret === "void" ? "void" : tsType(cb.ret);
  if (ret === null) return null;
  return `(${params.join(", ")}) => ${ret}`;
}

/**
 * The registry and dispatcher for one callback signature.
 *
 * The module imports one dispatcher per signature and gets back a *slot number*
 * ahead of the wac arguments; the registry says which host function that slot
 * holds. Registering by identity means passing the same function twice costs one
 * slot, so a callback used in a loop does not exhaust the pool.
 *
 * A registered function is held for the life of the module. wac has no way to
 * say it has dropped one, and freeing a slot that the module still holds a
 * funcref for would turn a live call into a call on whatever took its place.
 */
function genCallbackRegistry(cb: WacCallback & { index: number }): string {
  const j = cb.index;
  const fnTs = cbTsType(cb)!;
  const args = cb.params.map((t, i) => fromWasm(t, `a${i}`)).join(", ");
  const call = `_cbs${j}[_slot](${args})`;
  const body = cb.ret === "void" ? `{ ${call}; }` : `${toWasm(cb.ret, `(${call})`)}`;
  const wasmParams = cb.params.map((_, i) => `a${i}: unknown`).join(", ");
  return [
    `const _cbs${j}: (${fnTs})[] = [];`,
    `const _cbd${j} = (_slot: number${wasmParams ? ", " + wasmParams : ""}) =>`,
    `  ${body};`,
    `/** Register \`f\` and hand back the \`${cb.type}\` to pass into the module. */`,
    `function _fnref${j}(f: ${fnTs}): unknown {`,
    `  let _slot = _cbs${j}.indexOf(f);`,
    `  if (_slot < 0) {`,
    `    _slot = _cbs${j}.length;`,
    `    if (_slot >= ${cb.slots}) {`,
    `      throw new RangeError(`,
    `        "at most ${cb.slots} distinct ${cb.type} functions can be passed to this module",`,
    `      );`,
    `    }`,
    `    _cbs${j}.push(f);`,
    `  }`,
    `  return (_exports.${cb.helper} as CallableFunction)(_slot);`,
    `}`,
  ].join("\n");
}

/**
 * Turns the engine's bare "unreachable" into whatever the program said.
 *
 * Rethrows the original when there is no message — an engine trap (a bounds check, a
 * null dereference) leaves none, and inventing one would be worse than the truth. The
 * original is kept as `cause` either way.
 */
const TRAP_GUARD = `function _wacTrap(e: unknown): never {
  const s = (_exports.__trap_message as CallableFunction)();
  if (s === null || s === undefined) throw e;
  throw new Error(\`wac trap: \${_stringFromWasm(s)}\`, { cause: e });
}`;

/** The struct or enum a type names, if it is one — with or without a trailing `?`. */
function structOf(wacType: string): { s: { display: string }; nullable: boolean } | null {
  const direct = structsByWac.get(wacType) ?? enumsByWac.get(wacType);
  if (direct) return { s: direct, nullable: false };
  if (wacType.endsWith("?")) {
    const inner = structsByWac.get(wacType.slice(0, -1)) ?? enumsByWac.get(wacType.slice(0, -1));
    if (inner) return { s: inner, nullable: true };
  }
  return null;
}

/**
 * The members a generated class defines for itself, which a variant may not shadow.
 *
 * A variant called `tag` would collide with the discriminant getter and produce a file that does
 * not compile. Rather than mangle the name — which would then differ from what the author wrote —
 * such an enum is skipped and says so.
 */
const ENUM_RESERVED = new Set(["tag", "ref", "toObject", "constructor"]);

/**
 * A class per reachable enum: an opaque reference, a discriminant, and the payload behind it.
 *
 * The class rather than a bare tagged object, so an enum crosses on the same terms as a struct —
 * by reference, with its methods — and `toObject()` produces the discriminated union that a JS
 * caller can `switch` on. Going straight to the tagged object would have lost the methods and made
 * every crossing a copy.
 */
function genEnumClass(en: WacEnum): { code: string } | { skip: string } {
  const clash = en.variants.find((v) => ENUM_RESERVED.has(v.name));
  if (clash) {
    return { skip: `${en.display} — variant '${clash.name}' collides with a generated member` };
  }
  const cls = className(en);
  const lines: string[] = [];
  const tagUnion = en.variants.map((v) => JSON.stringify(v.name)).join(" | ");

  lines.push(`/** \`${en.display}\`, held by reference. \`tag\` says which variant; \`toObject()\` unpacks it. */`);
  lines.push(`export class ${cls} {`);
  lines.push(`  constructor(readonly ref: unknown) {}`);

  for (const v of en.variants) {
    const ps = v.fields.map((f) => `${f.name}: ${tsType(f.type) ?? "unknown"}`).join(", ");
    const args = v.fields.map((f) => toWasm(f.type, f.name)).join(", ");
    if (v.fields.some((f) => tsType(f.type) === null)) continue;
    lines.push(`  static ${v.name}(${ps}): ${cls} {`);
    lines.push(`    return new ${cls}((_exports.__bind_e_${en.bind}_${v.name}_new as CallableFunction)(${args}));`);
    lines.push(`  }`);
  }

  lines.push(`  get tag(): ${tagUnion} {`);
  const byTag = en.variants.slice().sort((a, b) => a.tag - b.tag)
    .map((v) => JSON.stringify(v.name)).join(", ");
  lines.push(`    const _t = (_exports.__bind_e_${en.bind}_tag as CallableFunction)(this.ref) as number;`);
  lines.push(`    return ([${byTag}] as const)[_t];`);
  lines.push(`  }`);

  for (const v of en.variants) {
    for (const f of v.fields) {
      const ts = tsType(f.type);
      if (!ts) continue;
      lines.push(`  /** Payload \`${f.name}\` of \`${v.name}\`. Throws unless this is a \`${v.name}\`. */`);
      lines.push(`  get ${v.name}_${f.name}(): ${ts} {`);
      lines.push(`    return ${fromWasm(f.type, `(_exports.__bind_e_${en.bind}_${v.name}_get_${f.name} as CallableFunction)(this.ref)`)};`);
      lines.push(`  }`);
    }
  }

  for (const m of en.methods) {
    if (m.params.some((p) => tsType(p.type) === null)) continue;
    if (m.ret !== "void" && tsType(m.ret) === null) continue;
    const ps = m.params.map((p) => `${p.name}: ${tsType(p.type)}`).join(", ");
    const args = ["this.ref", ...m.params.map((p) => toWasm(p.type, p.name))].join(", ");
    const call = `(_exports.__bind_m_${en.bind}_${m.name} as CallableFunction)(${args})`;
    lines.push(`  ${m.name}(${ps}): ${m.ret === "void" ? "void" : tsType(m.ret)} {`);
    lines.push(m.ret === "void" ? `    ${call};` : `    return ${fromWasm(m.ret, call)};`);
    lines.push(`  }`);
  }

  // The discriminated union, which is the shape a JS caller switches on.
  const objType = en.variants.map((v) => {
    const fs = v.fields.filter((f) => tsType(f.type) !== null)
      .map((f) => `; ${f.name}: ${tsType(f.type)}`).join("");
    return `{ tag: ${JSON.stringify(v.name)}${fs} }`;
  }).join("\n    | ");
  lines.push(`  /** The variant and its payload, as a plain object to \`switch\` on. */`);
  lines.push(`  toObject():\n    | ${objType} {`);
  lines.push(`    switch (this.tag) {`);
  for (const v of en.variants) {
    const fs = v.fields.filter((f) => tsType(f.type) !== null)
      .map((f) => `, ${f.name}: this.${v.name}_${f.name}`).join("");
    lines.push(`      case ${JSON.stringify(v.name)}: return { tag: ${JSON.stringify(v.name)}${fs} };`);
  }
  lines.push(`    }`);
  lines.push(`  }`);
  lines.push(`}`);
  return { code: lines.join("\n") };
}

function isSupported(wacType: string): boolean {
  return tsType(wacType) !== null;
}

// ── Struct wrappers ───────────────────────────────────────────────────────────

/**
 * A class per reachable struct: an opaque reference plus accessors.
 *
 * The reference is the value, not a copy of it — so identity survives the boundary, mutation flows
 * both ways, and a cyclic structure like `json`'s tree crosses at all. `toObject()` is generated on
 * top for when a caller wants plain data instead, which makes the copy a choice per call site
 * rather than the language's decision.
 */
function genStructClass(s: WacStruct): string {
  const cls = className(s);
  const lines: string[] = [];
  lines.push(`/** \`${s.display}\`, held by reference. Fields and methods call into the module. */`);
  lines.push(`export class ${cls} {`);
  lines.push(`  /** The wasm reference. Hand it to another wrapper freely — nothing is copied. */`);
  lines.push(`  constructor(readonly ref: unknown) {}`);

  // The factory. `of` rather than a constructor overload, so `new ${cls}(ref)` stays unambiguous.
  const ctorParams = s.fields.map((f) => `${f.name}: ${tsType(f.type) ?? "unknown"}`).join(", ");
  const ctorArgs = s.fields.map((f) => toWasm(f.type, f.name)).join(", ");
  if (s.fields.every((f) => tsType(f.type) !== null)) {
    lines.push(`  static of(${ctorParams}): ${cls} {`);
    lines.push(`    return new ${cls}((_exports.__bind_s_${s.bind}_new as CallableFunction)(${ctorArgs}));`);
    lines.push(`  }`);
  }

  for (const f of s.fields) {
    const ts = tsType(f.type);
    if (!ts) continue;                       // a field of an unsupported type is simply absent
    lines.push(`  get ${f.name}(): ${ts} {`);
    lines.push(`    return ${fromWasm(f.type, `(_exports.__bind_s_${s.bind}_get_${f.name} as CallableFunction)(this.ref)`)};`);
    lines.push(`  }`);
    if (!f.isConst) {
      lines.push(`  set ${f.name}(v: ${ts}) {`);
      lines.push(`    (_exports.__bind_s_${s.bind}_set_${f.name} as CallableFunction)(this.ref, ${toWasm(f.type, "v")});`);
      lines.push(`  }`);
    }
  }

  for (const m of s.methods) {
    // A funcref parameter is carried only when there is a dispatcher for it *and*
    // its own signature can be expressed — a callback that itself takes a function
    // has a dispatcher and no TypeScript type, and asserting past that produced a
    // member with `undefined` where its type should be.
    const badParam = m.params.find((p) => {
      const cb = callbacksByType.get(p.type);
      if (cb) return cbTsType(cb) === null;
      return p.type.startsWith("fn[") || tsType(p.type) === null;
    });
    if (badParam) {
      skippedMembers.push(
        `${cls}.${m.name}() — parameter '${badParam.name}: ${badParam.type}' not yet supported in bindgen`,
      );
      continue;
    }
    if (m.ret !== "void" && tsType(m.ret) === null) {
      skippedMembers.push(
        `${cls}.${m.name}() — return type '${m.ret}' not yet supported in bindgen`,
      );
      continue;
    }
    const ps = m.params.map((p) => {
      const cb = callbacksByType.get(p.type);
      return `${p.name}: ${cb ? cbTsType(cb)! : tsType(p.type)}`;
    }).join(", ");
    const wasmArg = (p: { name: string; type: string }) => {
      const cb = callbacksByType.get(p.type);
      return cb ? `_fnref${cb.index}(${p.name})` : toWasm(p.type, p.name);
    };
    // A static method has no receiver, so it takes no `this.ref` and becomes a static
    // class member — which is how a struct gets constructed from JavaScript at all.
    const args = (m.isStatic ? [] : ["this.ref"]).concat(m.params.map(wasmArg)).join(", ");
    const exportName = `${m.isStatic ? "__bind_sm_" : "__bind_m_"}${s.bind}_${m.name}`;
    const call = `(_exports.${exportName} as CallableFunction)(${args})`;
    lines.push(`  ${m.isStatic ? "static " : ""}${m.name}(${ps}): ${m.ret === "void" ? "void" : tsType(m.ret)} {`);
    const stmt = m.ret === "void" ? `${call};` : `return ${fromWasm(m.ret, call)};`;
    if (hasTrapMessages) {
      lines.push(`    try { ${stmt} } catch (e) { _wacTrap(e); }`);
    } else {
      lines.push(`    ${stmt}`);
    }
    lines.push(`  }`);
  }

  // A plain-data copy, one level deep: a struct-typed field becomes its own `toObject()`, and a
  // nullable one becomes null. Deliberately not recursive through a cycle — `Node? next` on a ring
  // would not terminate — so a self-referential field is copied as the wrapper, not as data.
  const plainFields = s.fields.filter((f) => tsType(f.type) !== null);
  const objType = plainFields
    .map((f) => `${f.name}: ${structOf(f.type) ? tsType(f.type) : tsType(f.type)}`).join("; ");
  lines.push(`  /** A plain-object snapshot. Struct-typed fields stay wrappers, so cycles are safe. */`);
  lines.push(`  toObject(): { ${objType} } {`);
  lines.push(`    return { ${plainFields.map((f) => `${f.name}: this.${f.name}`).join(", ")} };`);
  lines.push(`  }`);
  lines.push(`}`);
  return lines.join("\n");
}

/**
 * Bind `expr` once, then use it.
 *
 * Every nullable conversion has to test the value and then convert it, and writing that
 * as `(expr === null ? null : f(expr))` evaluates `expr` **twice**. For a field read that
 * is merely wasteful; for a *call* it is wrong, and the calls are the interesting case —
 * a callback dispatcher's argument is `_cbs28[_slot](a0)`, so a nullable-returning
 * callback was invoked twice per call. Anything with a side effect ran double, and
 * anything single-use failed on the second go and then converted the failure's `null` as
 * if it were a value: `Cannot read properties of null (reading 'length')`.
 *
 * Found when `packages/platform`'s `readDir` started answering through a ticket, whose
 * resolver collects the call and cannot be asked twice. `fromWasm` already did this.
 */
function once(expr: string, body: (v: string) => string): string {
  return `((_v) => ${body("_v")})(${expr})`;
}

/** Convert a JS value to what the wasm accessor expects. */
function toWasm(wacType: string, expr: string): string {
  if (wacType === "string") return `_stringToWasm(${expr})`;
  if (ARRAY_MAP[wacType]) return `_arrayToWasm_${wacType.replace("[]", "")}(${expr})`;
  const arr = arraysByWac.get(wacType);
  if (arr) return `_arrayToWasm_${arr.suffix}(${expr})`;
  const box = boxedPrim(wacType);
  if (box) {
    return once(expr, (v) =>
      `${v} === null ? null : (_exports.__bind_opt_${box}_new as CallableFunction)(${v})`);
  }
  const nr = nullableRef(wacType);
  if (nr) return once(expr, (v) => `${v} === null ? null : ${toWasm(nr, v)}`);
  const st = structOf(wacType);
  if (st) return st.nullable ? once(expr, (v) => `${v} === null ? null : ${v}.ref`) : `${expr}.ref`;
  return expr;
}

/** Convert what a wasm accessor returned into the JS value for its type. */
function fromWasm(wacType: string, expr: string): string {
  if (wacType === "string") return `_stringFromWasm(${expr})`;
  if (ARRAY_MAP[wacType]) return `_arrayFromWasm_${wacType.replace("[]", "")}(${expr})`;
  const arr = arraysByWac.get(wacType);
  if (arr) return `_arrayFromWasm_${arr.suffix}(${expr})`;
  const box = boxedPrim(wacType);
  if (box) {
    return `((_b) => _b === null || _b === undefined ? null : ` +
      `${fromWasm(box, `(_exports.__bind_opt_${box}_get as CallableFunction)(_b)`)})(${expr})`;
  }
  const nr = nullableRef(wacType);
  if (nr) return `((_v) => _v === null || _v === undefined ? null : ${fromWasm(nr, "_v")})(${expr})`;
  const out = outFuncrefsByType.get(wacType);
  if (out) {
    const args = out.params.map((_, i) => `a${i}`).join(", ");
    const call = `(_exports.${out.helper} as CallableFunction)(_f${args ? ", " + args : ""})`;
    const body = out.ret === "void" ? `{ ${call}; }` : fromWasm(out.ret, call);
    return `((_f) => (${args}) => ${body})(${expr})`;
  }
  const st = structOf(wacType);
  if (st) {
    const cls = className(st.s);
    return st.nullable
      ? `((_r) => _r === null ? null : new ${cls}(_r))(${expr})`
      : `new ${cls}(${expr})`;
  }
  if (wacType === "u64") return `BigInt.asUintN(64, ${expr} as bigint)`;
  if (wacType === "i64") return `${expr} as bigint`;
  if (wacType === "bool") return `Boolean(${expr})`;
  if (wacType === "u32") return `(${expr} as number) >>> 0`;
  return `${expr} as number`;
}

// ── Array helpers ─────────────────────────────────────────────────────────────

function arrayToWasmHelper(elemType: string, jsType: string): string {
  const prefix = ARRAY_ELEM_PREFIX[elemType];
  const isBigInt = elemType === "i64[]" || elemType === "u64[]";
  const convert = isBigInt ? "" : "";
  void convert;
  const width = ARRAY_ELEM_WIDTH[elemType];
  return `function _arrayToWasm_${elemType.replace("[]", "")}(js: ${jsType}): unknown {
  const n = js.length;
  // One bulk write into the staging buffer, then one call to copy it into a GC
  // array wasm-side. The old per-element loop cost n calls across the boundary.
  _memEnsure(n * ${width});
  new ${jsType}(_memBuffer(), 0, n).set(js);
  return (_exports.${prefix}_from_mem as CallableFunction)(n);
}`;
}

/**
 * Copy a JS array into a wasm one, element by element.
 *
 * `_new` fills with null where the element type allows it, and every slot is
 * written before wac sees the array. Where it does not — `string[]`, whose
 * element is a non-null reference — the first element is the fill and an empty
 * array comes from `_new0`, because `array.new` has no value to repeat and
 * `array.new_default` is not available for a type with no default.
 */
function refArrayToWasmHelper(arr: WacArray, elemTs: string): string {
  const p = `__bind_arr_${arr.suffix}`;
  const mk = arr.fill
    ? `  if (js.length === 0) return (_exports.${p}_new0 as CallableFunction)();\n` +
      `  const wa = (_exports.${p}_new as CallableFunction)(js.length, ${toWasm(arr.elem, "js[0]")});`
    : `  const wa = (_exports.${p}_new as CallableFunction)(js.length);`;
  return `function _arrayToWasm_${arr.suffix}(js: ${elemTs}[]): unknown {
${mk}
  for (let i = 0; i < js.length; i++) {
    (_exports.${p}_set as CallableFunction)(wa, i, ${toWasm(arr.elem, "js[i]")});
  }
  return wa;
}`;
}

/** Read a wasm array of references back, element by element. */
function refArrayFromWasmHelper(arr: WacArray, elemTs: string): string {
  const p = `__bind_arr_${arr.suffix}`;
  return `function _arrayFromWasm_${arr.suffix}(wa: unknown): ${elemTs}[] {
  const n = (_exports.${p}_len as CallableFunction)(wa) as number;
  const out: ${elemTs}[] = [];
  for (let i = 0; i < n; i++) {
    const _e = (_exports.${p}_get as CallableFunction)(wa, i);
    out.push(${fromWasm(arr.elem, "_e")});
  }
  return out;
}`;
}

function arrayFromWasmHelper(elemType: string, jsType: string): string {
  const prefix = ARRAY_ELEM_PREFIX[elemType];
  const isBigInt = elemType === "i64[]" || elemType === "u64[]";
  const elemCast = isBigInt ? " as bigint" : " as number";
  const elemBase = elemType.replace("[]", "");
  void elemCast;
  const width = ARRAY_ELEM_WIDTH[elemType];
  return `function _arrayFromWasm_${elemBase}(wa: unknown): ${jsType} {
  const n = (_exports.${prefix}_len as CallableFunction)(wa) as number;
  _memEnsure(n * ${width});
  (_exports.${prefix}_to_mem as CallableFunction)(wa);
  // slice() rather than a view: the caller keeps this, and the next transfer
  // overwrites the buffer.
  return new ${jsType}(_memBuffer(), 0, n).slice();
}`;
}

// ── String helpers ────────────────────────────────────────────────────────────

// Staging-buffer access. Growing the memory detaches the old ArrayBuffer, so
// `_memBuffer()` is re-read after every `_memEnsure` rather than cached.
const MEM_ACCESS = `const _mem = _exports.__bind_mem as WebAssembly.Memory;

function _memEnsure(bytes: number): void {
  const have = (_exports.__bind_mem_ensure as CallableFunction)(bytes) as number;
  if (have < bytes) {
    throw new Error(\`wac: could not grow the transfer buffer to \${bytes} bytes\`);
  }
}

function _memBuffer(): ArrayBuffer {
  return _mem.buffer as ArrayBuffer;
}`;

const STRING_TO_WASM = `function _stringToWasm(s: string): unknown {
  const bytes = new TextEncoder().encode(s);
  _memEnsure(bytes.length);
  new Uint8Array(_memBuffer(), 0, bytes.length).set(bytes);
  return (_exports.__bind_str_from_mem as CallableFunction)(bytes.length);
}`;

const STRING_FROM_WASM = `function _stringFromWasm(wa: unknown): string {
  const n = (_exports.__bind_str_len as CallableFunction)(wa) as number;
  _memEnsure(n);
  (_exports.__bind_str_to_mem as CallableFunction)(wa);
  return new TextDecoder().decode(new Uint8Array(_memBuffer(), 0, n));
}`;

// ── Function wrapper generation ───────────────────────────────────────────────

type WrapperResult =
  | { skip: false; code: string }
  | { skip: true; reason: string };

function genWrapper(exp: WacExport): WrapperResult {
  // Check all types are supported
  for (const p of exp.params) {
    const cb = callbacksByType.get(p.type);
    if (p.type.startsWith("fn[") && !cb) {
      // Callable coming out, not going in: there is no dispatcher for this one, so
      // passing a host function would reach the engine as a raw JS value.
      return { skip: true, reason: `${exp.name}() — parameter '${p.name}: ${p.type}' not yet supported in bindgen` };
    }
    if (cb) {
      if (cbTsType(cb) === null) {
        return { skip: true, reason: `${exp.name}() — parameter '${p.name}: ${p.type}' not yet supported in bindgen` };
      }
      continue;
    }
    if (!isSupported(p.type)) {
      return { skip: true, reason: `${exp.name}() — parameter '${p.name}: ${p.type}' not yet supported in bindgen` };
    }
  }
  if (exp.ret !== "void" && !isSupported(exp.ret)) {
    return { skip: true, reason: `${exp.name}() — return type '${exp.ret}' not yet supported in bindgen` };
  }

  // JS wrapper name matches the wac export name verbatim (no renaming)
  const jsName = exp.name;

  // Build TypeScript parameter list
  const tsParams = exp.params.map((p) => {
    const cb = callbacksByType.get(p.type);
    return `${p.name}: ${cb ? cbTsType(cb)! : tsType(p.type)!}`;
  }).join(", ");
  const tsRet = tsType(exp.ret) ?? "void";

  // Build the body
  const lines: string[] = [];

  // Convert array/string/struct params to wasm form. The conversions are the same ones the struct
  // wrappers use, so a struct parameter needed no new code here — only the type to stop being
  // rejected above.
  const wasmArgs: string[] = [];
  for (const p of exp.params) {
    const cb = callbacksByType.get(p.type);
    if (cb) {
      wasmArgs.push(`_fnref${cb.index}(${p.name})`);
      continue;
    }
    if (p.type === "string" || ARRAY_MAP[p.type]) {
      lines.push(`  const _w_${p.name} = ${toWasm(p.type, p.name)};`);
      wasmArgs.push(`_w_${p.name}`);
    } else {
      wasmArgs.push(toWasm(p.type, p.name));
    }
  }

  const callExpr = `(_exports.${exp.name} as CallableFunction)(${wasmArgs.join(", ")})`;

  if (exp.ret === "void") {
    lines.push(`  ${callExpr};`);
  } else if (exp.ret === "string") {
    lines.push(`  const _result = ${callExpr};`);
    lines.push(`  return _stringFromWasm(_result);`);
  } else if (ARRAY_MAP[exp.ret]) {
    const elemBase = exp.ret.replace("[]", "");
    lines.push(`  const _result = ${callExpr};`);
    lines.push(`  return _arrayFromWasm_${elemBase}(_result);`);
  } else if (
    structOf(exp.ret) || arraysByWac.has(exp.ret) || boxedPrim(exp.ret) ||
    outFuncrefsByType.has(exp.ret) || nullableRef(exp.ret)
  ) {
    lines.push(`  return ${fromWasm(exp.ret, callExpr)};`);
  } else if (exp.ret === "u64") {
    // wac's u64 is wasm's i64, which is right — signedness lives in the instruction, not the
    // type. But WebAssembly's JS API hands an i64 back as a *signed* BigInt, so a value with
    // the high bit set arrived as `want - 2**64`. Reinterpreting is the caller's only chance
    // to see the value the wac function returned [issue 0039].
    lines.push(`  return BigInt.asUintN(64, ${callExpr} as bigint);`);
  } else if (exp.ret === "i64") {
    lines.push(`  return ${callExpr} as bigint;`);
  } else if (exp.ret === "bool") {
    lines.push(`  return Boolean(${callExpr});`);
  } else if (exp.ret === "u32") {
    // u8 and u16 cannot be return types at all (packed types are array elements only), so
    // u32 is the whole of the 32-bit case.
    // Same for the 32-bit and packed unsigned types: the JS API converts i32 to a signed
    // number. `>>> 0` is the standard reinterpretation and is exact for all 32 bits.
    lines.push(`  return (${callExpr} as number) >>> 0;`);
  } else {
    lines.push(`  return ${callExpr} as number;`);
  }

  // Arrays are strictly copy-in [§wac-bind-arr-copy-j4wk7pm]: a void function
  // stays void — mutations to the wasm-side copy are discarded, never
  // mirrored back to the caller's typed array.
  const body = hasTrapMessages
    ? `  try {\n${lines.map((l) => "  " + l).join("\n")}\n  } catch (e) { _wacTrap(e); }`
    : lines.join("\n");
  return {
    skip: false,
    code: `export function ${jsName}(${tsParams}): ${tsRet} {\n${body}\n}`,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Bytes as a latin-1 string, for `btoa`.
 *
 * In chunks, because `String.fromCharCode(...bytes)` spreads every byte as an argument and
 * a large module then exceeds the engine's argument limit — as `RangeError: Maximum call
 * stack size exceeded`, which reads like infinite recursion and is not. It was a hard
 * ceiling on module size at roughly 120KB: `packages/box` hit it the moment it imported
 * `packages/zstd`, having been fine the hour before.
 */
function latin1(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

/**
 * Generate a self-contained TypeScript file that wraps a compiled wac module.
 */
export function wacBindgen(compiled: WacCompiled): string {
  const base64 = btoa(latin1(compiled.wasm));
  // The struct table is consulted by `tsType` and the conversions, which are called from
  // everywhere below.
  structsByWac = new Map(compiled.structs.map((s) => [s.wac, s]));
  enumsByWac = new Map(compiled.enums.map((e) => [e.wac, e]));
  callbacksByType = new Map(
    (compiled.callbacks ?? []).map((c, i) => [c.type, { ...c, index: i }]),
  );
  // Only the reference-element ones: a primitive array keeps its bulk path below,
  // which is one copy rather than a call per element.
  boxedPrims = new Set(compiled.boxed ?? []);
  hasTrapMessages = compiled.trapMessages === true;
  outFuncrefsByType = new Map(
    (compiled.funcrefs ?? []).map((c, i) => [c.type, { ...c, index: i }]),
  );
  arraysByWac = new Map(
    (compiled.arrays ?? []).filter((a) => !ARRAY_MAP[a.type]).map((a) => [a.type, a]),
  );

  // Determine which helpers are needed
  let allTypes = compiled.exports.flatMap(e => [
    ...e.params.map(p => p.type),
    e.ret,
  ]);
  // A struct's own fields and methods can mention a string or an array even when no exported
  // *function* does, and its accessors convert them the same way.
  const structTypes = [
    ...compiled.structs.flatMap((s) => [
      ...s.fields.map((f) => f.type),
      ...s.methods.flatMap((m) => [...m.params.map((p) => p.type), m.ret]),
    ]),
    ...compiled.enums.flatMap((e) => [
      ...e.variants.flatMap((v) => v.fields.map((f) => f.type)),
      ...e.methods.flatMap((m) => [...m.params.map((p) => p.type), m.ret]),
    ]),
  ];
  allTypes.push(...structTypes);
  // An array's *element* needs its helpers too: `string[]` decodes each element with
  // `_stringFromWasm`, and `i32[][]` builds each row with the bulk `i32[]` path.
  // Without this the generated file called helpers it had not emitted.
  // A `u8[]?` needs the same helpers a `u8[]` does. Every list that decides which
  // helpers to emit is normalised through here, rather than each one remembering to
  // strip the `?` — the fifth bug of the shape "bindgen wrote a call to a helper
  // nothing emitted" came from exactly one such list forgetting.
  const bare = (t: string): string => (t.endsWith("?") ? t.slice(0, -1) : t);
  allTypes = allTypes.map(bare);
  const arrayElems = (compiled.arrays ?? []).map((a) => a.elem).map(bare);
  allTypes.push(...arrayElems);
  // A callback's types cross too, and in the *opposite* direction to an export's: the
  // host produces the callback's return value and consumes its parameters. So a
  // `fn[u8[]()]` needs the to-wasm helper for its return and a `fn[i32(i32[])]` needs
  // the from-wasm helper for its parameter — the reverse of what an export with those
  // types would need. Missing them, the dispatcher called a function that was never
  // emitted and threw on first use, with nothing in the skip list [issue 0055].
  const cbTypes = [...(compiled.callbacks ?? []), ...(compiled.funcrefs ?? [])];
  const cbProduced = cbTypes.map((c) => bare(c.ret));              // host → wasm
  const cbConsumed = cbTypes.flatMap((c) => c.params.map(bare));   // wasm → host
  allTypes.push(...cbProduced, ...cbConsumed);
  // A trap message is a string, so its decoder has to be present even for a module
  // whose own signatures never mention one.
  const needsString = allTypes.some(t => t === "string") || hasTrapMessages;
  // Copy-in helpers for array params, copy-out helpers only for array returns
  const paramArrayTypes = new Set(
    [...compiled.exports.flatMap(e => e.params.map(p => p.type)), ...structTypes, ...arrayElems,
     ...cbProduced]
      .map(bare).filter(t => ARRAY_MAP[t]));
  const retArrayTypes = new Set(
    [...compiled.exports.map(e => e.ret), ...structTypes, ...arrayElems, ...cbConsumed]
      .map(bare).filter(t => ARRAY_MAP[t]));

  const parts: string[] = [];

  // Header: wasm binary
  parts.push(
    `const _wasm = Uint8Array.from(\n  atob("${base64}"),\n  (c) => c.charCodeAt(0),\n);`,
  );
  // The host functions the module can be given. A module that takes none has no
  // imports at all, and instantiates exactly as it did before.
  const allCbs = [...callbacksByType.values()];
  if (allCbs.length > 0) {
    const fields: string[] = [];
    for (const cb of allCbs) {
      // Every declared import must be supplied or the module will not
      // instantiate — including one whose types this file cannot marshal. That
      // one gets a stub that says so if it is ever reached, which it cannot be:
      // the export taking it was skipped for the same reason.
      if (cbTsType(cb) === null) {
        fields.push(`    ${cb.field}: () => {`);
        fields.push(`      throw new TypeError("${cb.type} cannot cross the boundary");`);
        fields.push(`    },`);
        continue;
      }
      parts.push(genCallbackRegistry(cb));
      fields.push(`    ${cb.field}: _cbd${cb.index},`);
    }
    parts.push(`const _imports = {\n  wac: {\n${fields.join("\n")}\n  },\n};`);
  }
  const importArg = allCbs.length > 0 ? "_wasm, _imports" : "_wasm";
  parts.push(
    `const _instance = await WebAssembly.instantiate(${importArg});\nconst _exports = _instance.instance.exports;`,
  );

  // Staging-buffer access, needed by every bulk path below.
  const needsBulk = needsString || paramArrayTypes.size > 0 || retArrayTypes.size > 0;
  if (needsBulk) parts.push(MEM_ACCESS);

  // String helpers
  if (needsString) {
    parts.push(STRING_TO_WASM);
    parts.push(STRING_FROM_WASM);
  }

  if (hasTrapMessages) parts.push(TRAP_GUARD);

  // Arrays of references, both directions. They are few, and generating a pair
  // unconditionally avoids a second reachability walk that could disagree with
  // the emitter's.
  for (const arr of arraysByWac.values()) {
    const elemTs = tsType(arr.elem);
    if (elemTs === null) continue;   // an element the boundary cannot carry
    parts.push(refArrayToWasmHelper(arr, elemTs));
    parts.push(refArrayFromWasmHelper(arr, elemTs));
  }

  // Array helpers
  for (const arrType of paramArrayTypes) {
    parts.push(arrayToWasmHelper(arrType, ARRAY_MAP[arrType]));
  }
  for (const arrType of retArrayTypes) {
    parts.push(arrayFromWasmHelper(arrType, ARRAY_MAP[arrType]));
  }

  // Struct and enum wrappers, before the functions that mention them.
  const skipped: string[] = [];
  skippedMembers = [];
  for (const st of compiled.structs) parts.push(genStructClass(st));
  for (const en of compiled.enums) {
    const r = genEnumClass(en);
    if ("skip" in r) {
      parts.push(`// skipped: ${r.skip}`);
      skipped.push(r.skip);
    } else parts.push(r.code);
  }

  // Function wrappers
  for (const exp of compiled.exports) {
    const result = genWrapper(exp);
    if (result.skip) {
      parts.push(`// skipped: ${result.reason}`);
      skipped.push(result.reason);
    } else {
      parts.push(result.code);
    }
  }

  // A skipped export is invisible to the caller: `mod.mk` is simply undefined, which
  // reads like a typo rather than a boundary the value cannot cross. The reason was
  // already recorded — as a comment in this file, which nobody reads while wondering
  // where their export went. Naming it as a real export puts it where the person
  // looking will find it, and a module whose every export was skipped stops looking
  // like a module that failed to build.
  skipped.push(...skippedMembers);
  if (skipped.length > 0) {
    const list = skipped.map((r) => `  ${JSON.stringify(r)},`).join("\n");
    parts.push(
      `/**
 * Exports that could not be given a JavaScript wrapper, and why.
 *
 * A struct or an enum is not a value JavaScript can hold, so a function taking or
 * returning one has no wrapper here. That is deliberate — inventing a representation
 * would be worse than omitting it — but it is easy to mistake for a build failure, so
 * the list is exported rather than left in a comment.
 */
export const __bindgenSkipped: readonly string[] = [
${list}
];`,
    );
  }

  // Coverage helpers, when the module was built with instrumentation. They are
  // part of an instrumented module's contract, so a wrapper that hid them would
  // make the instrumentation unusable from the generated module.
  if (compiled.coverage !== undefined) {
    parts.push(
      `/** Allocate (or reset) the branch-coverage counters. Call before running instrumented code. */
` +
      `export function __cov_init(): void {
` +
      `  (_exports.__cov_init as CallableFunction)();
}`,
    );
    parts.push(
      `/** Number of instrumented branch points. */
` +
      `export function __cov_len(): number {
` +
      `  return (_exports.__cov_len as CallableFunction)() as number;
}`,
    );
    parts.push(
      `/** Read one branch counter. Traps if __cov_init has not been called. */
` +
      `export function __cov_get(i: number): number {
` +
      `  return (_exports.__cov_get as CallableFunction)(i) as number;
}`,
    );
  }

  return parts.join("\n\n") + "\n";
}
