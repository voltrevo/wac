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
  buildWorld,
  buildWorldWith,
  type Callback,
  callbackBridge,
  fromWasm,
  type Shape,
  shapeOf,
  type Struct,
  structBridge,
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

Deno.test("the bridge imports exactly what the module imports, and nothing else", async () => {
  const stem = await boxsh();
  {
    const manifest = JSON.parse(await Deno.readTextFile(`${stem}.json`)) as { callbacks: Callback[] };
    const bytes = await Deno.readFile(`${stem}.wasm`);
    const mod = new WebAssembly.Module(bytes as unknown as BufferSource);
    const b = stubInstance(bytes);
    const { imports } = callbackBridge(b, manifest.callbacks);

    // **Both directions.** A bridge missing an import fails at instantiation with a clear message;
    // a bridge with *extra* ones is silently fine and means the manifest and the module disagree
    // about the boundary, which is the half nobody would notice.
    const wanted = WebAssembly.Module.imports(mod).map((i) => `${i.module}.${i.name}`).sort();
    const built = Object.keys(imports).map((k) => `wac.${k}`).sort();
    assertEquals(built, wanted, "the manifest's callbacks are not the module's imports");
    assertEquals(wanted.length > 0, true, "no imports were compared");
    console.log(`  ${wanted.length} callback signatures, matching the module's imports exactly`);

    // And the bridge really instantiates the module — the point of building it.
    const inst = new WebAssembly.Instance(mod, { wac: imports } as unknown as WebAssembly.Imports);
    assertEquals(typeof inst.exports["$bind$str_len"], "function");
  }
});

Deno.test("a callback converts its arguments, and its answer, by type", async () => {
  const stem = await boxsh();
  {
    const manifest = JSON.parse(await Deno.readTextFile(`${stem}.json`)) as { callbacks: Callback[] };
    const b = stubInstance(await Deno.readFile(`${stem}.wasm`));
    const { imports, register } = callbackBridge(b, manifest.callbacks);

    // A signature taking a `string` and returning something opaque, which is the interesting mix:
    // one argument that must be decoded and a result that must be handed back untouched.
    const n = manifest.callbacks.findIndex((c) => (c.params ?? []).includes("string"));
    assertEquals(n >= 0, true, "no callback takes a string — has the boundary changed?");

    let seen: unknown = null;
    const answer = { opaque: true };
    register(n, (...a: unknown[]) => {
      seen = a[(manifest.callbacks[n].params ?? []).indexOf("string")];
      return answer;
    });

    // Call it the way wasm would: a slot, then the arguments as wasm values.
    const args = (manifest.callbacks[n].params ?? []).map((p) =>
      p === "string"
        ? toWasm(b, shapeOf("string"), "a path with ümlauts")
        : toWasm(b, shapeOf(p), 0)
    );
    const back = imports[manifest.callbacks[n].field](0, ...args);

    assertEquals(seen, "a path with ümlauts", "the string argument reached the handler undecoded");
    const ret = manifest.callbacks[n].ret;
    if (shapeOf(ret).kind === "ref") {
      assertEquals(back === answer, true, "an opaque answer was not handed straight back");
    }
  }
});

Deno.test("slots are deduplicated, and the module's limit is the limit", async () => {
  const stem = await boxsh();
  {
    const manifest = JSON.parse(await Deno.readTextFile(`${stem}.json`)) as { callbacks: Callback[] };
    const b = stubInstance(await Deno.readFile(`${stem}.wasm`));
    const { register } = callbackBridge(b, manifest.callbacks);

    const limit = manifest.callbacks[0].slots;

    // **The same function twice is one slot.** Without this a program that passes a handler inside a
    // loop exhausts a table sized at build time and fails with nothing wrong with it.
    //
    // Asserted by *counting*, not by comparing what `register` returned. Comparing the two funcrefs
    // is what I wrote first and it is inert: `assertEquals` stringifies, and two funcrefs for
    // different slots stringify the same — removing the deduplication left that version green. So
    // this registers one function `limit` times and then fills every remaining slot, which can only
    // succeed if the repeats collapsed.
    const f = () => null;
    for (let i = 0; i < limit; i++) register(0, f);
    for (let i = 0; i < limit - 1; i++) register(0, () => i);   // one slot is f's

    const limit2 = manifest.callbacks[1].slots;
    // And past the module's own limit the failure names it, rather than trapping in wasm.
    let threw = "";
    try {
      for (let i = 0; i < limit2 + 2; i++) register(1, () => i);
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    assertEquals(
      threw.includes(`at most ${limit2}`),
      true,
      `past the module's ${limit2} slots the failure must name the limit, not be a wasm trap: ${threw}`,
    );
  }
});

Deno.test("a struct is built and read through the manifest, not through generated classes", async () => {
  const stem = await boxsh();
  {
    const manifest = JSON.parse(await Deno.readTextFile(`${stem}.json`)) as {
      structs: Struct[];
      callbacks: Callback[];
    };
    const b = stubInstance(await Deno.readFile(`${stem}.wasm`));
    const { invoke, invokeOn } = structBridge(b, manifest.structs);

    // `Stat.of(bool, bool, bool, i64, i64, bool, bool, i32)` — a static constructor whose arguments
    // span three shapes, so a conversion mistake in any of them shows up in what comes back out.
    //
    // The **last** argument is what is read back: `answered()` returns whether `fault` is `NONE` (0)
    // or `NOT_A_DIR` (10), not anything about the leading booleans. I asserted the first field first
    // and it failed — the bridge was right and my guess about the method was not, which is why the
    // two calls below differ only in that argument.
    const mk = (fault: number) =>
      invoke("Stat", "of", true, false, true, 1234n, 5678n, false, true, fault);

    const ok = mk(0);
    assertEquals(ok !== null && ok !== undefined, true, "Stat.of built nothing");
    assertEquals(invokeOn("Stat", "answered", ok), true, "fault 0 should be answered");
    assertEquals(invokeOn("Stat", "answered", mk(10)), true, "fault 10 is NOT_A_DIR, also answered");
    // **And a fault that is not one of those**, so the argument is proved to arrive rather than the
    // method merely returning true. Both calls build the same struct apart from this number.
    assertEquals(invokeOn("Stat", "answered", mk(1)), false, "fault 1 is NOT_FOUND, not answered");
    const stat = ok;

    // A method taking and returning a string, which goes through the staging buffer on both legs.
    assertEquals(
      typeof invokeOn("Stat", "words", stat, "a phrase"),
      "string",
      "a string-returning method did not come back as a string",
    );

    // **The capability structs are the point of all this**: `Core.of` takes eight funcrefs, which is
    // what a driver hands a program's `main`. Built here from the manifest and the bridge together,
    // which is the whole of what the generated glue does for these two.
    const { register } = callbackBridge(b, manifest.callbacks);
    const core = manifest.structs.find((s) => s.name === "Core");
    assertEquals(core !== undefined, true, "no Core in the manifest");
    const of = core!.methods.find((m) => m.name === "of");
    assertEquals(of !== undefined && of!.isStatic === true, true, "Core.of is not a static method");
    // **Not every parameter is a funcref.** `Core.sched` is a value the module builds for itself —
    // wac state with wac logic on it, where a host's whole part is calling `create` once — so a
    // parameter no callback describes is constructed rather than registered. `buildWorldWith` in
    // `marshal.ts` follows the same rule, and this is the manifest-only version of it.
    let made = 0;
    const refs = (of!.params ?? []).map((p) => {
      const n = manifest.callbacks.findIndex((c) => c.type === p);
      if (n < 0) {
        const spec = manifest.structs.find((s) => s.name === p);
        assertEquals(spec !== undefined, true, `${p} is neither a callback nor a struct in the manifest`);
        assertEquals(
          spec!.methods.some((m) => m.name === "create" && m.isStatic),
          true,
          `${p} is not a callback and offers no static create, so Core cannot be built`,
        );
        made++;
        return invoke(p, "create");
      }
      return register(n, () => null);
    });
    const built = invoke("Core", "of", ...refs);
    assertEquals(built !== null && built !== undefined, true, "Core.of returned nothing");
    console.log(
      `  Core built from ${refs.length - made} funcrefs and ${made} value(s) it made itself, ` +
        "through the manifest alone",
    );

    // Arity is caught here, where the method still has a name.
    let threw = "";
    try {
      invoke("Stat", "of", true);
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    assertEquals(threw.includes("takes 8 argument(s), not 1"), true, `wrong arity was not named: ${threw}`);
  }
});

Deno.test("a capability world is built from names, not from argument order", async () => {
  const stem = await boxsh();
  {
    const manifest = JSON.parse(await Deno.readTextFile(`${stem}.json`)) as {
      structs: Struct[];
      callbacks: Callback[];
    };
    const b = stubInstance(await Deno.readFile(`${stem}.wasm`));
    const core = manifest.structs.find((s) => s.name === "Core")!;
    const fields = core.fields ?? [];
    assertEquals(fields.length > 0, true, "Core has no fields in the manifest");

    // A host supplies its capabilities by name. Which position each takes is the manifest's business,
    // and getting it wrong is how `sleepMillis` becomes `randomBytes` with nothing to say so.
    const called: string[] = [];
    const impls: Record<string, CallableFunction> = {};
    for (const f of fields) impls[f.name] = () => { called.push(f.name); return null; };

    const world = buildWorld(b, core, manifest.callbacks, impls, manifest.structs);
    assertEquals(world !== null && world !== undefined, true, "Core was not built");
    console.log(`  Core from ${fields.length} named capabilities: ${fields.slice(0, 3).map((f) => f.name).join(", ")}, …`);

    // **A missing one is named.** Positional funcrefs are exactly where a gap survives silently: pass
    // one fewer than wanted and that capability is simply absent, which a program meets much later
    // as a call into nothing.
    const short = { ...impls };
    delete short[fields[0].name];
    let threw = "";
    try {
      buildWorld(b, core, manifest.callbacks, short, manifest.structs);
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    assertEquals(
      threw.includes(fields[0].name) && threw.includes("were not given"),
      true,
      `a missing capability must be named: ${threw}`,
    );
  }
});

Deno.test("two worlds for one instance share a slot table", async () => {
  const stem = await boxsh();
  {
    const manifest = JSON.parse(await Deno.readTextFile(`${stem}.json`)) as {
      structs: Struct[];
      callbacks: Callback[];
    };
    const b = stubInstance(await Deno.readFile(`${stem}.wasm`));
    // **`Core` *and* `Cli`, which is what a driver actually needs.** A bridge per struct gives each
    // its own slot table, so the second world's funcrefs point into a table the module's imports
    // never consult — every capability on it would dispatch to whatever the first world put in that
    // slot. A wrong answer with no error, which is why the shared form exists.
    const { imports, register } = callbackBridge(b, manifest.callbacks);
    const built: string[] = [];
    for (const name of ["Core", "Cli"]) {
      const s = manifest.structs.find((x) => x.name === name)!;
      const impls: Record<string, CallableFunction> = {};
      for (const f of s.fields ?? []) impls[f.name] = () => null;
      const w = buildWorldWith(b, s, manifest.callbacks, impls, register, manifest.structs);
      assertEquals(w !== null && w !== undefined, true, `${name} was not built`);
      built.push(`${name}(${(s.fields ?? []).length})`);
    }
    assertEquals(Object.keys(imports).length > 0, true, "the shared bridge built no imports");
    console.log(`  ${built.join(" and ")} from one slot table`);
  }
});

Deno.test("a real program runs: built, worlds made, `main` called, answer converted", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-driver-" });
  try {
    // `packages/platform/test/wac/driver_probe.wac` calls nothing, which is what makes it runnable
    // without the asynchronous bridge — every capability answers `Pending<T>`, and waiting on one is
    // the host's ticket machinery rather than anything this module does. Everything else a driver
    // must get right is still required: 45 signatures, two worlds, and an export read from a string.
    const stem = `${dir}/probe`;
    await buildNative("packages/platform/test/wac/driver_probe.wac", stem, {});
    const manifest = JSON.parse(await Deno.readTextFile(`${stem}.json`)) as {
      structs: Struct[];
      callbacks: Callback[];
      exports: { name: string; params?: string[]; ret: string }[];
    };
    const bytes = await Deno.readFile(`${stem}.wasm`);

    // Instantiate on the bridge's imports — no generated glue anywhere in this test.
    const mod = new WebAssembly.Module(bytes as unknown as BufferSource);
    let bound: Bound;
    const lazy: Bound = { exports: {}, memory: () => bound.memory() };
    const { imports, register } = callbackBridge(lazy, manifest.callbacks);
    const inst = new WebAssembly.Instance(mod, { wac: imports } as unknown as WebAssembly.Imports);
    const exports = inst.exports as unknown as Record<string, unknown>;
    const mem = exports["$bind$mem"] as WebAssembly.Memory;
    bound = { exports, memory: () => mem.buffer };
    lazy.exports = exports;

    // Both worlds, from their manifest fields, sharing the one slot table.
    const worlds: unknown[] = [];
    for (const name of ["Core", "Cli"]) {
      const s = manifest.structs.find((x) => x.name === name)!;
      const impls: Record<string, CallableFunction> = {};
      for (const f of s.fields ?? []) {
        impls[f.name] = () => {
          throw new Error(`the probe called ${name}.${f.name}, which it is written not to`);
        };
      }
      worlds.push(buildWorldWith(bound, s, manifest.callbacks, impls, register, manifest.structs));
    }

    // And `main`, whose signature is read from the manifest like everything else.
    const entry = manifest.exports.find((e) => e.name === "main")!;
    assertEquals(entry.params, ["Core", "Cli"], "main's signature is not what a driver expects");
    const args = (entry.params ?? []).map((p, i) => toWasm(bound, shapeOf(p), worlds[i]));
    const code = fromWasm(bound, shapeOf(entry.ret), (exports["main"] as CallableFunction)(...args));

    // **21, not 0.** The arithmetic is in the probe so that calling the wrong export, or building a
    // world that traps, cannot produce the answer by accident — 0 is what a program that did nothing
    // returns, and what a driver that silently failed would report.
    assertEquals(code, 21, "the program did not run, or its answer did not come back");
    console.log(`  driver_probe returned ${code}, through the manifest alone`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
