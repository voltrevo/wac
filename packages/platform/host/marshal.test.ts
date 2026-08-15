// The runtime marshaller against the compiler that produces what it reads.
//
// `marshal.ts` names wasm exports it never declared — `$bind$arr_u8Arr_get` and its family — and the
// spelling is computed from a type string. If that computation drifts from `arrBindSuffix` in
// `compiler/wasmBuildBin.ts` the export does not resolve, and the failure is quiet: a missing helper
// reads as a missing feature. So the oracle here is **a real module**, not a list of expected names.
// Every array type its manifest mentions must have helpers the module actually exports, and the test
// discovers both sides rather than asserting either.
//
// `WebAssembly.Module.exports` reads the export section without instantiating, so this needs no
// imports, no host and no capabilities — which is what makes checking a whole 800 KB module cheap.

import { buildNative } from "../native.ts";
import {
  arrSuffix,
  bindName,
  type Bound,
  fromWasm,
  type Shape,
  shapeOf,
  toWasm,
} from "./marshal.ts";

/**
 * The module both wasm-backed cases read, built once.
 *
 * Lazily rather than at the top level, so a filtered run that reaches neither of them pays nothing —
 * and shared, because building `boxsh` twice is eight seconds this suite does not need to spend.
 */
let building: Promise<string> | null = null;
const boxsh = (): Promise<string> => {
  building ??= (async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-marshal-" });
    globalThis.addEventListener("unload", () => {
      try {
        Deno.removeSync(dir, { recursive: true });
      } catch { /* already gone */ }
    });
    // The strongest single program available: box's shell reaches four capability families, and its
    // manifest carries 31 distinct type strings including the nested `u8[][]` that `spawn` takes.
    const stem = `${dir}/boxsh`;
    await buildNative("packages/box/example/boxsh.wac", stem, { read: true, write: true });
    return stem;
  })();
  return building;
};

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

Deno.test("a type string is read as one of the seven shapes", () => {
  const kind = (t: string) => shapeOf(t).kind;
  assertEquals(kind("void"), "void");
  assertEquals(kind("i32"), "scalar");
  assertEquals(kind("i64"), "scalar", "i64 is a scalar even though it arrives as a bigint");
  assertEquals(kind("bool"), "scalar");
  assertEquals(kind("string"), "string");
  assertEquals(kind("u8[]"), "array");
  assertEquals(kind("Stat"), "ref");
  assertEquals(kind("Pending<u8[]>"), "ref", "a Pending is opaque, not an array of anything");
  assertEquals(kind("fn[Pending<i32>(i32)]"), "ref", "a funcref is the driver's job, not a value");
  assertEquals(kind("Stat?"), "ref", "nullability changes nothing about how a reference converts");
});

Deno.test("an array's helpers are named from its element, at every depth", () => {
  const suffix = (t: string) => (shapeOf(t) as Shape & { kind: "array" }).suffix;
  assertEquals(suffix("i32[]"), "i32");
  assertEquals(suffix("string[]"), "string");
  assertEquals(suffix("u8[]"), "u8");
  // **The one that caught me out reading `native/v8`.** An array of `u8[]` is `u8Arr`, and a
  // lowercase-only search for the export finds `$bind$arr_u8` and reports a truncated match as the
  // whole name — which is how I briefly concluded the compiler emitted no helper for it at all.
  assertEquals(suffix("u8[][]"), "u8Arr");
  assertEquals(suffix("i32[][]"), "i32Arr");
  assertEquals(suffix("Stat[]"), "Stat");
  assertEquals(suffix("Pending<i64>[]"), "Pending$i64", "a generic's `<>` collapses to `$`");
});

Deno.test("`bindName` collapses runs and trims, as the compiler does", () => {
  assertEquals(bindName("Pending<i64>"), "Pending$i64");
  assertEquals(bindName("Map<u8[], i32>"), "Map$u8$i32", "runs collapse rather than repeat");
  assertEquals(bindName("Stat"), "Stat");
  assertEquals(arrSuffix({ kind: "scalar", name: "u8" }), "u8");
});

Deno.test("every array helper this marshaller would name is one the compiler emitted", async () => {
  const stem = await boxsh();
  {
    const manifest = JSON.parse(await Deno.readTextFile(`${stem}.json`)) as {
      callbacks: { params?: string[]; ret: string }[];
    };
    const bytes = await Deno.readFile(`${stem}.wasm`);
    const exported = new Set(
      WebAssembly.Module.exports(new WebAssembly.Module(bytes)).map((e) => e.name),
    );

    // Every type the boundary mentions, read once each.
    const types = new Set<string>();
    for (const c of manifest.callbacks) {
      for (const p of c.params ?? []) types.add(p);
      types.add(c.ret);
    }
    assertEquals(types.size > 20, true, `only ${types.size} type strings — did the manifest change?`);

    const missing: string[] = [];
    let checked = 0;
    const walk = (s: Shape): void => {
      if (s.kind !== "array") return;
      for (const helper of [`$bind$arr_${s.suffix}_len`, `$bind$arr_${s.suffix}_get`]) {
        checked++;
        if (!exported.has(helper)) missing.push(helper);
      }
      walk(s.elem);
    };
    for (const t of types) walk(shapeOf(t));

    // **Asserted to have looked**, because "no missing helpers" is what a walk over zero arrays says
    // too — and this file exists because a quiet nothing is the failure mode of the code it tests.
    assertEquals(checked > 0, true, "no array types were examined, so nothing was checked");
    assertEquals(
      missing.join(", "),
      "",
      `this marshaller would call helpers the module does not export, so the suffix spelling has ` +
        `drifted from \`arrBindSuffix\` in compiler/wasmBuildBin.ts`,
    );
    console.log(`  ${types.size} type strings, ${checked} array helpers, all exported`);

    // The staging buffer the string and byte routes both go through must be there too.
    for (const helper of ["$bind$str_len", "$bind$str_to_mem", "$bind$mem_ensure", "$bind$arr_u8_to_mem"]) {
      assertEquals(exported.has(helper), true, `the module exports no ${helper}`);
    }
  }
});

/**
 * Instantiate a built module with **stub imports**, which is enough for the `$bind$` surface.
 *
 * Every import is a function under `wac` — `cb0`…`cbN`, the callback bridge — and none of them is
 * called by the conversion helpers: those only read and write the module's own memory and heap. So a
 * marshaller can be tested against a real 800 KB program with no host, no capabilities and no
 * grants, which is what makes this a unit test rather than a second copy of the two-host differential.
 */
function stubInstance(bytes: Uint8Array): Bound {
  const mod = new WebAssembly.Module(bytes as unknown as BufferSource);
  const imports: Record<string, Record<string, unknown>> = {};
  for (const i of WebAssembly.Module.imports(mod)) {
    (imports[i.module] ??= {})[i.name] = () => {
      throw new Error(`marshal.test: the module called ${i.module}.${i.name}, which is a stub`);
    };
  }
  const inst = new WebAssembly.Instance(mod, imports as unknown as WebAssembly.Imports);
  const exports = inst.exports as unknown as Record<string, unknown>;
  const mem = exports["$bind$mem"] as WebAssembly.Memory;
  return { exports, memory: () => mem.buffer };
}

Deno.test("values really cross: a string, bytes, and an array of them", async () => {
  const stem = await boxsh();
  {
    const b = stubInstance(await Deno.readFile(`${stem}.wasm`));
    const call = (n: string, ...a: unknown[]) => (b.exports[n] as CallableFunction)(...a);

    /**
     * Put bytes in the staging buffer and let the module build the value from them.
     *
     * `_from_mem`, not `_new`: `$bind$str_new(n)` *allocates* n bytes and `$bind$str_from_mem(n)`
     * reads them. Both answer `n` to `$bind$str_len`, so a probe that checks the length is happy
     * with either — which is how I first "verified" this working while it round-tripped 21 zeros.
     */
    const give = (make: string, data: Uint8Array) => {
      call("$bind$mem_ensure", data.length);
      new Uint8Array(b.memory()).set(data, 0);
      return call(make, data.length);
    };

    // **Not ASCII**, because the whole reason an argument is bytes rather than text is that the
    // conversion is where a wrong answer hides — wac-mono 0065. A round trip that only ever carries
    // `abc` cannot tell a decoder from a byte copy.
    const text = "héllo wörld — ∑";
    const encoded = new TextEncoder().encode(text);
    assertEquals(
      fromWasm(b, shapeOf("string"), give("$bind$str_from_mem", encoded)),
      text,
      "a string did not survive the round trip",
    );

    const raw = Uint8Array.from([0, 1, 2, 250, 251, 255]);
    const got = fromWasm(b, shapeOf("u8[]"), give("$bind$arr_u8_from_mem", raw)) as Uint8Array;
    assertEquals([...got], [...raw], "bytes did not survive the round trip");

    // An array of strings, built element by element, read back whole — which exercises the
    // `_len`/`_get` walk rather than the memory route the two above take.
    const words = ["one", "twö", ""];
    const arr = call("$bind$arr_string_new", words.length, give("$bind$str_from_mem", new TextEncoder().encode(words[0])));
    for (let i = 1; i < words.length; i++) {
      call("$bind$arr_string_set", arr, i, give("$bind$str_from_mem", new TextEncoder().encode(words[i])));
    }
    assertEquals(fromWasm(b, shapeOf("string[]"), arr), words, "a string[] did not survive");

    // A scalar and a reference: one is converted, the other must be handed back untouched.
    assertEquals(fromWasm(b, shapeOf("bool"), 1), true);
    assertEquals(fromWasm(b, shapeOf("bool"), 0), false);
    const opaque = { not: "ours" };
    assertEquals(fromWasm(b, shapeOf("Pending<u8[]>"), opaque) === opaque, true, "a ref was touched");
  }
});

Deno.test("and back again: what goes in comes out, for every shape that converts", async () => {
  const stem = await boxsh();
  {
    const b = stubInstance(await Deno.readFile(`${stem}.wasm`));
    /** The property worth having: converting out and back in is the identity. */
    const round = (type: string, v: unknown) => fromWasm(b, shapeOf(type), toWasm(b, shapeOf(type), v));

    assertEquals(round("string", "héllo wörld — ∑"), "héllo wörld — ∑");
    assertEquals(round("string", ""), "", "an empty string is not a missing one");
    assertEquals([...(round("u8[]", [0, 1, 250, 255]) as Uint8Array)], [0, 1, 250, 255]);
    assertEquals([...(round("u8[]", []) as Uint8Array)], [], "an empty byte array");
    assertEquals(round("string[]", ["one", "twö", ""]), ["one", "twö", ""]);
    assertEquals(round("i32", 42), 42);
    assertEquals(round("bool", true), true);
    assertEquals(round("bool", false), false, "false must survive, not become null");

    // **The empty `string[]` is the case with its own constructor**, because `_new` needs a value to
    // fill with and there is none. It is also the one a naive implementation gets wrong by passing
    // null, which the module refuses rather than accepts.
    assertEquals(round("string[]", []), [], "an empty string[] needs `_new0`");
    // And an empty array of a type that has **no** `_new0`, which takes the other branch: `i32` is
    // defaultable so the compiler emits only `_new`, and the fill it is handed is never read.
    assertEquals(round("i32[]", []), [], "an empty i32[] takes the `_new` branch");
    assertEquals(round("i32[]", [1, 2, 3]), [1, 2, 3]);

    // A reference passes through in both directions, wrapped or not.
    const raw = { opaque: true };
    assertEquals(toWasm(b, shapeOf("Stat"), raw) === raw, true, "a bare reference was altered");
    assertEquals(toWasm(b, shapeOf("Stat"), { $ref: raw }) === raw, true, "a wrapped one was not unwrapped");
    assertEquals(toWasm(b, shapeOf("Stat?"), null), null, "null is null");
  }
});
