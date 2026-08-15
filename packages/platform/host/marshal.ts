// Converting values across the wasm boundary from a *type string*, rather than from generated code.
//
// `issues/system/0144`: the native hosts start a child from a `.wasm` alone, because a module carries
// its own manifest and `native/v8/src/main.rs` reads it at run time. The JavaScript hosts cannot —
// they start *worker bundles*, because the conversions live in the glue `compiler/wacBindgen.ts`
// writes per program. So the same wac program spawns on one host and not on another, which is a
// portability split rather than a missing convenience.
//
// This is the part that makes the rest tractable. Everything else a generic driver needs is a loop
// over the manifest; the conversions are the bulk, and they are what the generated file spends its
// nineteen hundred lines on.
//
// ## Seven shapes, not two hundred type strings
//
// Across every manifest in this repository 211 distinct type strings cross the boundary. One
// manifest — `packages/box/example/boxsh.wac` — uses 31 of them, and they are all one of:
//
//   void · scalars (`i32`, `i64`, `bool`, …) · `string` · arrays · a named reference
//
// Everything named is **opaque**: a `Stat` or a `Pending<u8[]>` is a reference the host receives and
// hands straight back, never looks inside, and could not usefully look inside — the fields it would
// want have named constructors in the manifest instead. That is why a boundary with hundreds of type
// strings needs a handful of conversions, and it is the observation the whole issue rests on.
//
// ## The one detail that must match the compiler exactly
//
// An array's helpers are named from its *element*: `i32[]` gives `$bind$arr_i32_get`, `u8[][]` gives
// `$bind$arr_u8Arr_get`, `Stat[]` gives `$bind$arr_Stat_get`. Get that spelling wrong and the export
// does not resolve — and the failure is quiet, because a missing export reads as a missing feature.
// `arrSuffix` below mirrors `arrBindSuffix` in `compiler/wasmBuildBin.ts`, and `marshal.test.ts`
// checks the two agree against every module this repository builds rather than against a list.

/** What a type string turns out to be, once. */
export type Shape =
  | { kind: "void" }
  | { kind: "scalar"; name: string }
  | { kind: "string" }
  | { kind: "array"; elem: Shape; suffix: string }
  /** A struct, an enum, a `Pending<T>` — anything the host passes through untouched. */
  | { kind: "ref"; name: string };

/**
 * The primitives that cross as numbers, plus `bool`.
 *
 * `i64` and `u64` arrive as `bigint` and are left as one: converting to `number` is lossy above 2^53
 * and silently so, which is the kind of wrong answer this repository spends its time finding.
 */
const SCALARS = new Set([
  "i8", "u8", "i16", "u16", "i32", "u32", "i64", "u64", "f32", "f64", "bool",
]);

/**
 * A wasm-safe name for a type, matching `bindName` in `compiler/wasmBuildBin.ts`.
 *
 * Runs of anything that is not alphanumeric-or-underscore collapse to a single `$`, and the edges are
 * trimmed — so `Pending<i64>` is `Pending$i64` and `Map<u8[], i32>` is `Map$u8$i32` rather than
 * `Map$u8$$$$i32`. `$` and not `_` because wac's lexer rejects `$`, so a name containing one cannot
 * have come from source and cannot collide with a struct somebody wrote.
 */
export function bindName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]+/g, "$").replace(/^\$+|\$+$/g, "");
}

/** The name an array's bind helpers are built from, which is its *element's*. */
export function arrSuffix(elem: Shape): string {
  switch (elem.kind) {
    case "scalar":
      return elem.name;
    case "string":
      return "string";
    // Nested: the outer array of `i32[][]` is `i32Arr`, so its helper is `$bind$arr_i32Arr_get`.
    case "array":
      return `${elem.suffix}Arr`;
    case "ref":
      return bindName(elem.name);
    case "void":
      return "void"; // not constructible; kept total so a caller cannot fall off the end
  }
}

/**
 * A type string as it appears in a manifest, read once.
 *
 * **Nullability is dropped deliberately.** `Stat?` and `Stat` convert identically — the host receives
 * a reference or `null`, and `null` needs no conversion. What it *does* change is an array's helper
 * name, so the `?` is stripped after the suffix is computed from the inner type rather than before.
 */
export function shapeOf(type: string): Shape {
  const t = type.trim();
  if (t.endsWith("?")) {
    const inner = shapeOf(t.slice(0, -1));
    // A nullable element gives `_null` on the suffix — `compiler/wasmBuildBin.ts` again.
    return inner.kind === "array" ? { ...inner } : inner;
  }
  if (t === "void" || t === "") return { kind: "void" };
  if (t === "string") return { kind: "string" };
  if (SCALARS.has(t)) return { kind: "scalar", name: t };
  if (t.endsWith("[]")) {
    const elem = shapeOf(t.slice(0, -2));
    return { kind: "array", elem, suffix: arrSuffix(elem) };
  }
  // `Pending<u8[]>`, `Stat`, `fn[...]` — all opaque here. A funcref is not converted by this module
  // at all: it is the callback machinery, which is the driver's job and not a value conversion.
  return { kind: "ref", name: t };
}

/** What this module needs from an instantiated module: its exports and its memory. */
export type Bound = {
  exports: Record<string, unknown>;
  /**
   * `ArrayBufferLike` rather than `ArrayBuffer`: a `WebAssembly.Memory` may be shared, and the
   * browser host's is — `packages/platform/host/browser.ts` runs children in workers over a
   * `SharedArrayBuffer`. Narrowing this to `ArrayBuffer` would type-check here and refuse the one
   * host that most needs a generic driver.
   */
  memory: () => ArrayBufferLike;
};

const call = (b: Bound, name: string, ...args: unknown[]): unknown => {
  const f = b.exports[name];
  if (typeof f !== "function") {
    // **Named, not swallowed.** A missing helper is the failure mode this module is most likely to
    // have — a suffix spelled differently from the compiler's — and it must not read as an empty
    // value. `native/v8` returned an empty `Vec` on exactly this and children were started with no
    // arguments for three days (`issues/system/0148`).
    throw new Error(`marshal: the module exports no ${name}`);
  }
  return (f as CallableFunction)(...args);
};

/** A wac `string` out of the module: its length, then its bytes through the staging buffer. */
function stringFrom(b: Bound, w: unknown): string {
  const n = call(b, "$bind$str_len", w) as number;
  call(b, "$bind$mem_ensure", n);
  call(b, "$bind$str_to_mem", w);
  return new TextDecoder().decode(new Uint8Array(b.memory()).slice(0, n));
}

/** A wac `u8[]`, which is a string's three steps without the decode. */
function bytesFrom(b: Bound, w: unknown): Uint8Array {
  const n = call(b, "$bind$arr_u8_len", w) as number;
  call(b, "$bind$mem_ensure", n);
  call(b, "$bind$arr_u8_to_mem", w);
  return new Uint8Array(b.memory()).slice(0, n);
}

/**
 * A value arriving from wasm, as the JavaScript a host wants to work with.
 *
 * `u8[]` takes the memory route because it is the common case and copying it a byte at a time
 * through `_get` is measurably worse; every other array walks its elements, which is what the
 * generated glue does too.
 */
export function fromWasm(b: Bound, shape: Shape, w: unknown): unknown {
  switch (shape.kind) {
    case "void":
      return undefined;
    case "scalar":
      return shape.name === "bool" ? w !== 0 : w;
    case "string":
      return stringFrom(b, w);
    case "ref":
      return w;
    case "array": {
      if (w === null || w === undefined) return null;
      if (shape.elem.kind === "scalar" && shape.elem.name === "u8") return bytesFrom(b, w);
      const n = call(b, `$bind$arr_${shape.suffix}_len`, w) as number;
      const out: unknown[] = [];
      for (let i = 0; i < n; i++) {
        out.push(fromWasm(b, shape.elem, call(b, `$bind$arr_${shape.suffix}_get`, w, i)));
      }
      return out;
    }
  }
}

/** Write bytes into the staging buffer and let the module build a value from them. */
function give(b: Bound, make: string, data: Uint8Array): unknown {
  call(b, "$bind$mem_ensure", data.length);
  new Uint8Array(b.memory()).set(data, 0);
  // **After the write, not before.** `mem_ensure` may grow the memory, and growing detaches the
  // `ArrayBuffer` a caller was holding — so the view is taken fresh above, between the two calls.
  return call(b, make, data.length);
}

/**
 * A value going the other way: the JavaScript a host produced, as something wasm can take.
 *
 * **A reference may arrive wrapped.** The generated glue returns a class instance holding the raw
 * reference in `$ref`, and unwraps it on the way out — `(v) => v === null ? null : v.$ref`. A driver
 * gets handed whichever the host chose to build, so this accepts both: a `$ref` if there is one, and
 * the value itself otherwise. Getting that wrong hands wasm a JavaScript object, which traps at a
 * distance from the cause.
 */
export function toWasm(b: Bound, shape: Shape, v: unknown): unknown {
  switch (shape.kind) {
    case "void":
      return undefined;
    case "scalar":
      return shape.name === "bool" ? (v ? 1 : 0) : v;
    case "string":
      return give(b, "$bind$str_from_mem", new TextEncoder().encode(String(v)));
    case "ref":
      if (v === null || v === undefined) return null;
      return typeof v === "object" && "$ref" in (v as object) ? (v as { $ref: unknown }).$ref : v;
    case "array": {
      if (v === null || v === undefined) return null;
      const items = v as ArrayLike<unknown>;
      if (shape.elem.kind === "scalar" && shape.elem.name === "u8") {
        return give(b, "$bind$arr_u8_from_mem", Uint8Array.from(items as ArrayLike<number>));
      }
      // **`_new`'s arity depends on the element type, and `_new0` is how to tell.**
      //
      // A defaultable element — `i32`, `bool` — gets `_new(len)`: wasm's `array.new_default` fills
      // it and there is nothing to pass. A reference has no default, so those get `_new(len, fill)`
      // *and* a `_new0()` for the empty case, which has no first element to fill from. The compiler
      // emits the pair together (`needsFill` in `compiler/wasmBuildBin.ts`), so the presence of
      // `_new0` is the observable form of that decision.
      //
      // Passing a fill to the arity-1 form is silently accepted and ignored, which cost element
      // zero: `[1,2,3]` round-tripped as `[0,2,3]`, because the fill was dropped and the loop
      // started at 1. Filled arrays therefore set from 1 and unfilled ones from 0.
      const suffix = shape.suffix;
      const filled = typeof b.exports[`$bind$arr_${suffix}_new0`] === "function";
      if (filled && items.length === 0) return call(b, `$bind$arr_${suffix}_new0`);
      const arr = filled
        ? call(b, `$bind$arr_${suffix}_new`, items.length, toWasm(b, shape.elem, items[0]))
        : call(b, `$bind$arr_${suffix}_new`, items.length);
      for (let i = filled ? 1 : 0; i < items.length; i++) {
        call(b, `$bind$arr_${suffix}_set`, arr, i, toWasm(b, shape.elem, items[i]));
      }
      return arr;
    }
  }
}

/** One callback signature, as the manifest describes it. */
export type Callback = {
  /** The import wasm calls: `cb0`, under module `wac`. */
  field: string;
  /** The export that turns a slot number into a funcref: `$bind$fnref_0`. */
  helper: string;
  params?: string[];
  ret: string;
  /** How many distinct functions of this signature the module made room for. */
  slots: number;
  /** The signature as written, for a message that can name it. */
  type?: string;
};

/**
 * The callback bridge, built from the manifest instead of generated per program.
 *
 * A wac program that takes `fn[Pending<u8[]>(i32)]` imports **one** function per *signature*, not per
 * callback — `wac.cb0` — and the first argument is a **slot**: which of the functions of that shape
 * is meant. The host keeps a table per signature, hands wasm a funcref by calling the module's own
 * `$bind$fnref_N(slot)`, and wasm calls back with that slot in front of the real arguments.
 *
 * So the whole of what the generated glue does here is: convert each argument by its type, look up
 * the slot, call, convert the result back. All four are things this module already knows how to do
 * from a type string — which is why the callback layer is a loop rather than a second code
 * generator.
 *
 * **Slots are deduplicated by identity**, as the generated version does: registering the same
 * function twice must yield the same funcref, or a program that passes a handler in a loop exhausts
 * a table sized at build time and fails at the sixteenth call with nothing wrong.
 */
export function callbackBridge(b: Bound, callbacks: Callback[]): {
  /** The `wac` import object a module is instantiated with. */
  imports: Record<string, (slot: number, ...args: unknown[]) => unknown>;
  /** Register a host function for signature `n`, and get the funcref wasm will call. */
  register: (n: number, f: CallableFunction) => unknown;
} {
  const tables: CallableFunction[][] = callbacks.map(() => []);
  const shapes = callbacks.map((c) => ({
    params: (c.params ?? []).map(shapeOf),
    ret: shapeOf(c.ret),
  }));

  const imports: Record<string, (slot: number, ...args: unknown[]) => unknown> = {};
  callbacks.forEach((c, n) => {
    imports[c.field] = (slot: number, ...args: unknown[]): unknown => {
      const f = tables[n][slot];
      if (f === undefined) {
        // **Named rather than a `TypeError` from calling undefined.** A slot nobody registered means
        // the module was handed a funcref for a function the host forgot to provide, and the useful
        // sentence names the signature — not "f is not a function" from inside a bridge.
        throw new Error(`marshal: ${c.field} called slot ${slot}, which holds no function (${c.type ?? c.ret})`);
      }
      const { params, ret } = shapes[n];
      const given = params.map((p, i) => fromWasm(b, p, args[i]));
      return toWasm(b, ret, f(...given));
    };
  });

  const register = (n: number, f: CallableFunction): unknown => {
    const c = callbacks[n];
    if (c === undefined) throw new Error(`marshal: no callback signature ${n}`);
    let slot = tables[n].indexOf(f);
    if (slot < 0) {
      slot = tables[n].length;
      if (slot >= c.slots) {
        throw new RangeError(
          `marshal: at most ${c.slots} distinct ${c.type ?? c.ret} functions can be passed to this ` +
            `module, which is a limit baked in when it was built`,
        );
      }
      tables[n].push(f);
    }
    return call(b, c.helper, slot);
  };

  return { imports, register };
}

/** One method on a struct, as the manifest describes it. */
export type Method = {
  name: string;
  isStatic?: boolean;
  /** The export, when the manifest names it. Derived from the struct's bind name when it does not. */
  export_name?: string | null;
  params?: string[];
  ret: string;
};

/** One struct the boundary can reach. */
export type Struct = { name: string; bind: string; methods: Method[] };

/**
 * The structs a host has to build, from the manifest instead of from a generated class per type.
 *
 * This is what presents `Core.of(…)` and `Cli.of(…)` — the capability objects a program's `main`
 * takes, whose arguments are the funcrefs `callbackBridge` hands out. Everything else a driver needs
 * is here already: the arguments convert with `toWasm`, the answer with `fromWasm`, and a returned
 * struct is a reference the host holds and passes back.
 *
 * **The export name is derived when the manifest does not give one**, which is the usual case:
 * `$bind$sm_<bind>_<name>` for a static method and `$bind$m_<bind>_<name>` for an instance one, from
 * `compiler/wacBindgen.ts`. The *bind* name, not the declared one — two modules may each declare an
 * `S` and the core keeps them apart, which is the whole reason the manifest carries both.
 */
export function structBridge(b: Bound, structs: Struct[]): {
  /** Call a static method: `invoke("Core", "of", …)`. */
  invoke: (struct: string, method: string, ...args: unknown[]) => unknown;
  /** Call an instance method on a reference the host is holding. */
  invokeOn: (struct: string, method: string, self: unknown, ...args: unknown[]) => unknown;
} {
  const byName = new Map(structs.map((s) => [s.name, s]));

  const find = (struct: string, method: string): { s: Struct; m: Method; exp: string } => {
    const s = byName.get(struct);
    if (s === undefined) throw new Error(`marshal: the manifest has no struct ${struct}`);
    const m = s.methods.find((x) => x.name === method);
    if (m === undefined) throw new Error(`marshal: ${struct} has no method ${method}`);
    const exp = m.export_name ?? `$bind$${m.isStatic ? "sm" : "m"}_${s.bind}_${m.name}`;
    return { s, m, exp };
  };

  const run = (struct: string, method: string, self: unknown[], args: unknown[]): unknown => {
    const { m, exp } = find(struct, method);
    const params = (m.params ?? []).map(shapeOf);
    if (args.length !== params.length) {
      // **Arity checked here rather than trapping in wasm.** A wrong count reaches the engine as a
      // link error about a function nobody can name, and this is the layer that still knows both
      // the method and what it wanted.
      throw new Error(
        `marshal: ${struct}.${method} takes ${params.length} argument(s), not ${args.length}`,
      );
    }
    const given = params.map((p, i) => toWasm(b, p, args[i]));
    return fromWasm(b, shapeOf(m.ret), call(b, exp, ...self, ...given));
  };

  return {
    invoke: (struct, method, ...args) => run(struct, method, [], args),
    invokeOn: (struct, method, self, ...args) => run(struct, method, [self], args),
  };
}
