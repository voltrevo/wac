// Drive a wasm module from its manifest, with no glue generated for it.
//
// The JavaScript hosts start a program by importing a *bundle*: the module's bytes, the TypeScript
// `wacBindgen` wrote for that program, and the bridge. That works and is what ships. It also means a
// program is a different artefact on this host than on `native/v8`, which starts a module and reads
// its `wac.manifest` section — so `spawn` takes wasm there and a bundle here, and the same wac
// program behaves differently depending on where it runs. `issues/system/0143`.
//
// This is the other half: the same job the generated glue does, done from the manifest at run time.
//
// ## Why this is smaller than it sounds
//
// 211 distinct type strings cross the boundary across this repository, and they are seven shapes.
// Everything named — `Stat`, `Change`, `Pending<i64>`, `Cli` — is an **opaque reference the host
// passes straight back**; it never looks inside one it did not build, and the ones it does build
// have named constructors in the manifest. So what needs conversion is: the scalars, `string`,
// `u8[]`, `string[]`, `i32[]`, and `u8[][]`.

import type { Manifest, StructSpec } from "../native.ts";

/** What a host holds: the module's exports, plus the constructors it builds capabilities with. */
export type Driven = {
  exports: Record<string, unknown>;
  /** `Core.of(...)`, `Pending$i64.of(...)` — the shape `entry.ts` expects of a bundle. */
  classes: Record<string, { of(...a: unknown[]): unknown }>;
  /** Convert a value the module returned into something JavaScript can read. */
  fromWasm(type: string, v: unknown): unknown;
  /** And the other way, for what a capability answers with. */
  toWasm(type: string, v: unknown): unknown;
};

/** `Pending<i64>` is `Pending$i64` to a host, which is the name the bundles have always used. */
export function hostName(wac: string): string {
  return wac
    .replace(/\?/g, "Opt")
    .replace(/\[\]/g, "Arr")
    .replace(/[<>]/g, "$")
    .replace(/\$+$/g, "")
    .replace(/[^A-Za-z0-9_$]/g, "$");
}

/** Everything the module exports, by name — the one place a `$bind$` name is looked up. */
function fn(exports: Record<string, unknown>, name: string): CallableFunction {
  const f = exports[name];
  if (typeof f !== "function") {
    throw new Error(`the module has no ${name}, which its manifest names`);
  }
  return f as CallableFunction;
}

/**
 * Instantiate `wasm` and present it the way a bundle does.
 *
 * **The slot registry lives here**, as it does in generated glue. A capability struct is built by
 * handing it JavaScript functions, and a module cannot hold one: each is registered in a slot of
 * its signature and becomes a funcref through `$bind$fnref_<j>`. When the module calls back through
 * `wac.cb<j>(slot, …)` the function in that slot is what answers, with its arguments converted by
 * the types the manifest gives them.
 */
export function drive(wasm: Uint8Array, manifest: Manifest): Driven {
  /** `slots[signature][slot]` — the JavaScript function a funcref stands for. */
  const slots: CallableFunction[][] = manifest.callbacks.map(() => []);

  const wac: Record<string, CallableFunction> = {};
  manifest.callbacks.forEach((cb, j) => {
    wac[cb.field] = (slot: number, ...rest: unknown[]) => {
      const f = slots[j][slot];
      if (f === undefined) {
        throw new Error(`no function in slot ${slot} of signature ${j} (${cb.type})`);
      }
      const args = cb.params.map((t, i) => driven.fromWasm(t, rest[i]));
      const out = f(...args);
      return cb.ret === "void" ? undefined : driven.toWasm(cb.ret, out);
    };
  });

  const instance = new WebAssembly.Instance(new WebAssembly.Module(wasm as BufferSource), { wac });
  const exports = instance.exports as unknown as Record<string, unknown>;
  const memory = () => (exports["$bind$mem"] as WebAssembly.Memory).buffer;

  /** Ask the length, make room, *then* copy — `_to_mem` writes into the buffer and does not grow it. */
  const buffer = (n: number): Uint8Array => {
    fn(exports, "$bind$mem_ensure")(n);
    return new Uint8Array(memory());
  };

  const strFrom = (w: unknown): string => {
    const n = fn(exports, "$bind$str_len")(w) as number;
    buffer(n);
    fn(exports, "$bind$str_to_mem")(w);
    return new TextDecoder().decode(new Uint8Array(memory()).slice(0, n));
  };
  const strTo = (s: string): unknown => {
    const b = new TextEncoder().encode(s);
    buffer(b.length).set(b, 0);
    return fn(exports, "$bind$str_from_mem")(b.length);
  };
  const bytesFrom = (w: unknown): Uint8Array => {
    const n = fn(exports, "$bind$arr_u8_len")(w) as number;
    buffer(n);
    fn(exports, "$bind$arr_u8_to_mem")(w);
    return new Uint8Array(memory()).slice(0, n);
  };
  const bytesTo = (b: Uint8Array): unknown => {
    buffer(b.length).set(b, 0);
    return fn(exports, "$bind$arr_u8_from_mem")(b.length);
  };

  const driven: Driven = {
    exports,
    classes: {},
    fromWasm(type, v) {
      if (v === null || v === undefined) return null;
      const base = type.endsWith("?") ? type.slice(0, -1) : type;
      switch (base) {
        case "void":
          return undefined;
        case "i32":
        case "bool":
        case "i64":
          return v;
        case "string":
          return strFrom(v);
        case "u8[]":
          return bytesFrom(v);
        case "string[]": {
          const n = fn(exports, "$bind$arr_string_len")(v) as number;
          const out: string[] = [];
          for (let i = 0; i < n; i++) out.push(strFrom(fn(exports, "$bind$arr_string_get")(v, i)));
          return out;
        }
        case "u8[][]": {
          const n = fn(exports, "$bind$arr_u8Arr_len")(v) as number;
          const out: Uint8Array[] = [];
          for (let i = 0; i < n; i++) out.push(bytesFrom(fn(exports, "$bind$arr_u8Arr_get")(v, i)));
          return out;
        }
        case "i32[]": {
          const n = fn(exports, "$bind$arr_i32_len")(v) as number;
          const out: number[] = [];
          for (let i = 0; i < n; i++) out.push(fn(exports, "$bind$arr_i32_get")(v, i) as number);
          return out;
        }
        // **A named type is a reference the host does not look inside.** It came from the module and
        // goes back to the module; the ones a host *builds* have constructors below.
        default:
          return v;
      }
    },
    toWasm(type, v) {
      const base = type.endsWith("?") ? type.slice(0, -1) : type;
      if (v === null || v === undefined) return base === "void" ? undefined : null;
      // **A function becomes a funcref**, which is the one conversion a host cannot do for itself:
      // the module makes it, from a slot number, through the helper its manifest names.
      if (base.startsWith("fn[") && typeof v === "function") {
        const j = manifest.callbacks.findIndex((c) => c.type === base);
        if (j < 0) throw new Error(`${base} has no dispatcher in this manifest`);
        const slot = slots[j].length;
        if (slot >= manifest.callbacks[j].slots) {
          throw new Error(
            `at most ${manifest.callbacks[j].slots} distinct ${base} functions can be passed to this module`,
          );
        }
        slots[j].push(v as CallableFunction);
        return fn(exports, manifest.callbacks[j].helper)(slot);
      }
      switch (base) {
        case "string":
          return strTo(v as string);
        case "u8[]":
          return bytesTo(v as Uint8Array);
        default:
          return v;
      }
    },
  };

  // The constructors, named as a host names them: `Pending<i64>` is `Pending$i64`.
  for (const s of manifest.structs) {
    const ctor = s.methods.find((m) => m.name === "of" && m.isStatic);
    if (ctor === undefined) continue;
    driven.classes[hostName(s.name)] = {
      of: (...a: unknown[]) =>
        fn(exports, ctor.export)(...ctor.params.map((t, i) => driven.toWasm(t, a[i]))),
    };
  }
  return driven;
}

/**
 * The driven module in the shape a bundle presents — which is all `runAsWorkerEntry` wants.
 *
 * A bundle exports `main` and one class per capability struct; this is the same thing built from
 * the manifest, so the worker half of the runtime does not know or care which it was handed.
 */
export function asAppModule(driven: Driven): Record<string, unknown> {
  const app: Record<string, unknown> = { ...driven.classes };
  for (const [name, value] of Object.entries(driven.exports)) {
    // The `$bind$` family is the boundary's own machinery, not the program's interface.
    if (!name.startsWith("$bind$")) app[name] = value;
  }
  return app;
}

/** The manifest a module carries in its own `wac.manifest` section, or `null`. */
export function manifestIn(wasm: Uint8Array): Manifest | null {
  const sections = WebAssembly.Module.customSections(
    new WebAssembly.Module(wasm as BufferSource),
    "wac.manifest",
  );
  if (sections.length === 0) return null;
  return JSON.parse(new TextDecoder().decode(sections[0])) as Manifest;
}

/** Named here so `StructSpec` is not imported for its own sake. */
export type { StructSpec };
