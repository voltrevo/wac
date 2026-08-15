// Drive a wasm module from its manifest, with no glue generated for it.
//
// The JavaScript hosts start a program by importing a *bundle*: the module's bytes, the TypeScript
// `wacBindgen` wrote for that program, and the bridge. That works and is what ships. It also means a
// program is a different artefact on this host than on `native/v8`, which starts a module and reads
// its `wac.manifest` section — so `spawn` takes wasm there and a bundle here, and the same wac
// program behaves differently depending on where it runs. `issues/system/0144`.
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
import {
  type Bound,
  fromWasm as marshalFrom,
  shapeOf,
  toWasm as marshalTo,
} from "./marshal.ts";

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

  /**
   * The value conversions, which live in `marshal.ts` rather than here.
   *
   * They were written twice, in parallel, by two agents who did not know about each other: this file
   * had a `switch` over four array type strings and `marshal.ts` derived the same answers from the
   * *shape* of a type. Keeping both would have been two models of one boundary, which is the thing
   * that drifts — so this keeps what is genuinely the driver's (the manifest, the slot registry, the
   * funcref that only a module can make) and asks `marshal.ts` for the rest.
   *
   * It is not only deduplication. The `switch` knew `string[]`, `u8[][]` and `i32[]` and answered
   * `default: return v` for everything else, so a capability handing back a `Mount[]` or a
   * `Pending<Read>[]` — both in `packages/box`'s own manifest — passed a JavaScript array straight
   * across and trapped. Deriving from the shape covers every array the compiler can emit, at any
   * depth, and takes the fill rule from whether `_new0` exists rather than from a list of type names.
   */
  const bound: Bound = { exports, memory };

  const driven: Driven = {
    exports,
    classes: {},
    fromWasm(type, v) {
      if (v === null || v === undefined) return null;
      return marshalFrom(bound, shapeOf(type), v);
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
      return marshalTo(bound, shapeOf(base), v);
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
