// A module driven from its manifest answers what the generated glue answers.
//
// The JavaScript hosts start a program by importing a bundle that carries glue written for that one
// program. `native/v8` starts a module and reads its `wac.manifest` section instead, which is why
// `spawn` takes wasm there and a bundle here — the split `issues/system/0144` is about. `driver.ts`
// is the other half, and this is the check that it agrees with what it replaces.
//
// **The subject is `packages/json`**, because it needs no capabilities: strings and byte arrays
// cross in both directions and nothing has to be granted, so a disagreement here is a marshalling
// bug and cannot be anything else.

import { buildNative } from "../native.ts";
import { drive, hostName, manifestIn } from "../host/driver.ts";
import { wacBind } from "../../../harness/wacBind.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

const ENTRY = "packages/json/src/json.wac";

Deno.test("a module driven from its manifest gives the generated glue's answers", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-driver-" });
  try {
    await buildNative(ENTRY, `${dir}/json`, {});
    const wasm = await Deno.readFile(`${dir}/json.wasm`);

    // **From the module itself**, which is the point: one artefact describes the program.
    const manifest = manifestIn(wasm);
    if (manifest === null) throw new Error("the module carries no wac.manifest section");

    // Nothing here reaches out: `json` takes no capabilities, so no slot is ever registered and no
    // dispatcher can fire.
    const driven = drive(wasm, manifest);

    // The oracle: the same program through `wacBind`, which is the generated glue.
    const bound = await wacBind(ENTRY) as unknown as {
      canonicalize(src: Uint8Array): { ok: boolean; code: number; pos: number; text: Uint8Array };
      parseNumberValue(src: Uint8Array): number;
    };

    const cases = [
      `{"a":1,"b":[true,null,"x"]}`,
      `[]`,
      `{"nested":{"deep":{"n":-3.5}}}`,
      `"just a string"`,
      `{"unicode":"héllo → 世界"}`,
    ];

    // **`canonicalize` is the useful one**: `u8[]` in, and a struct out whose `text` field is
    // `u8[]` again — so bytes cross in both directions and a *named* type comes back as a reference
    // the host reads through the module's own getters.
    const canon = driven.exports["canonicalize"];
    const number = driven.exports["parseNumberValue"];
    if (typeof canon !== "function" || typeof number !== "function") {
      throw new Error(
        `the module is missing an export this test needs; it has ${
          Object.keys(driven.exports).filter((k) => !k.startsWith("$bind$")).join(", ")
        }`,
      );
    }
    const enc = new TextEncoder();
    const getText = driven.exports["$bind$s_Canonical_get_text"] as CallableFunction;
    const getOk = driven.exports["$bind$s_Canonical_get_ok"] as CallableFunction;

    for (const text of cases) {
      const src = enc.encode(text);
      const viaGlue = bound.canonicalize(src);
      const out = (canon as CallableFunction)(driven.toWasm("u8[]", src));
      assertEquals(getOk(out) === 1 || getOk(out) === true, viaGlue.ok, `canonicalize(${text}).ok`);
      assertEquals(
        driven.fromWasm("u8[]", getText(out)),
        viaGlue.text,
        `canonicalize(${text}).text`,
      );
    }

    // A number comes back as one, with no conversion at all — the case that would look right even
    // if every conversion above were broken, which is why it is here and not instead of them.
    assertEquals(
      (number as CallableFunction)(driven.toWasm("u8[]", enc.encode("-3.5"))),
      bound.parseNumberValue(enc.encode("-3.5")),
      "parseNumberValue",
    );

    // And the names a host reaches for are the names it has always used.
    assertEquals(hostName("Pending<i64>"), "Pending$i64");
    assertEquals(hostName("Pending<u8[]?>"), "Pending$u8ArrOpt");
    assertEquals(hostName("string[]"), "stringArr");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a driven module takes capabilities, which is the conversion a host cannot fake", async () => {
  // **`Core.of(...)` is handed JavaScript functions**, and a module cannot hold one: each has to be
  // registered in a slot of its signature and turned into a funcref by the module's own
  // `$bind$fnref_<j>`. That is the conversion generated glue exists to do, and the reason a driver
  // that only converted values would get as far as building `Core` and no further.
  const dir = await Deno.makeTempDir({ prefix: "wac-driver-caps-" });
  try {
    await buildNative("native/v8/example/hello.wac", `${dir}/hello`, {});
    const wasm = await Deno.readFile(`${dir}/hello.wasm`);
    const manifest = manifestIn(wasm);
    if (manifest === null) throw new Error("no wac.manifest section");

    const driven = drive(wasm, manifest);
    const said: string[] = [];
    const warned: string[] = [];

    // The field order is the manifest's, never a copy this test keeps — the same rule the hosts
    // follow, and the reason inserting a capability does not silently shift every argument.
    const core = manifest.structs.find((s) => s.name === "Core");
    if (core === undefined) throw new Error("the manifest describes no Core");
    const args = core.fields.map((f) => {
      // **The one field that is not a function.** `Core.sched` is a value the module makes for
      // itself, so a host builds it rather than implementing it — handing a JavaScript function here
      // is what "type incompatibility when transforming from/to JS" means, and it is the boundary
      // doing its job.
      if (!f.type.startsWith("fn[")) {
        return (driven.classes[f.type] as unknown as { create(): unknown }).create();
      }
      if (f.name === "log") return (s: string) => void said.push(s);
      if (f.name === "warn") return (s: string) => void warned.push(s);
      // Everything else is answered by refusing: `hello` reaches none of them, and a call that
      // arrives is a fact worth failing on rather than a silent zero.
      return () => {
        throw new Error(`hello called ${f.name}, which this test does not serve`);
      };
    });

    const built = driven.classes["Core"].of(...args);
    const main = driven.exports["main"] as CallableFunction;
    const code = main(built);

    assertEquals(code, 0, "hello returns 0");
    assertEquals(said, ["hello from a Rust host on V8"]);
    assertEquals(warned, ["and this goes to stderr"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a capability answering an array of references is built, not passed through", async () => {
  // **The gap a `hello` cannot find.** `Core.log` takes a string, so a driver that converted only
  // strings and byte arrays looked complete — until a capability answers `string[]?`, which
  // `readDir` does, or bytes-of-bytes, which `popChild` does. `fromWasm` could read those and
  // `toWasm` could not build them, so a host got as far as the boundary and no further.
  const dir = await Deno.makeTempDir({ prefix: "wac-driver-arrays-" });
  try {
    await buildNative("packages/platform/example/wc.wac", `${dir}/wc`, { read: true });
    const wasm = await Deno.readFile(`${dir}/wc.wasm`);
    const manifest = manifestIn(wasm);
    if (manifest === null) throw new Error("no wac.manifest section");
    const driven = drive(wasm, manifest);

    // Round-tripped through the module: what comes back out is what went in, which is the only
    // check that says the array was *built* rather than handed over.
    const names = ["alpha", "beta", "", "héllo"];
    assertEquals(driven.fromWasm("string[]", driven.toWasm("string[]", names)), names);
    assertEquals(driven.fromWasm("string[]", driven.toWasm("string[]", [])), []);

    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([]), new Uint8Array([255])];
    assertEquals(
      (driven.fromWasm("u8[][]", driven.toWasm("u8[][]", chunks)) as Uint8Array[]).map((b) => [...b]),
      chunks.map((b) => [...b]),
    );

    const ids = [1, 2, 3, -4];
    assertEquals(driven.fromWasm("i32[]", driven.toWasm("i32[]", ids)), ids);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ── Every array the compiler can emit, not the four somebody listed ──────────────────────────────
//
// `drive`'s conversions used to be a `switch` over `string[]`, `u8[][]` and `i32[]`, with
// `default: return v` underneath. That is right for a named type — an opaque reference goes back
// exactly as it came — and wrong for every *other* array, which arrives as a JavaScript array,
// passes straight through and traps inside the module. `packages/box`'s own manifest has
// `$bind$arr_i32Arr`, `$bind$arr_u8ArrArr`, `$bind$arr_Mount` and `$bind$arr_Pending$Read`; none of
// them was in the list.
//
// So the conversions now come from `marshal.ts`, which derives them from the *shape* of the type
// string at any depth. This is the assertion that says so, and it is a round trip rather than a
// spot check: `toWasm` builds it, `fromWasm` reads it back, and the module is the only thing in
// between. A conversion that agreed with itself while building the wrong array would still have to
// survive being read by the module's own accessors.
Deno.test("an array the old list did not name still crosses, in both directions", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-driver-nested-" });
  try {
    await buildNative(ENTRY, `${dir}/json`, {});
    const wasm = await Deno.readFile(`${dir}/json.wasm`);
    const manifest = manifestIn(wasm);
    if (manifest === null) throw new Error("the module carries no wac.manifest section");
    const driven = drive(wasm, manifest);

    // `u8[][]` is in `json`'s reach; the nested case is the one the list handled by accident.
    const want = [new Uint8Array([1, 2, 3]), new Uint8Array([]), new Uint8Array([255])];
    const there = driven.toWasm("u8[][]", want);
    if (there === null || there === undefined) throw new Error("toWasm built nothing");
    const back = driven.fromWasm("u8[][]", there) as Uint8Array[];
    assertEquals(back.map((b) => [...b]), want.map((b) => [...b]), "u8[][] did not survive the trip");

    // **The empty case separately**, because a fill-and-set loop that starts at the wrong index is
    // exactly what an empty array cannot catch — and the reverse: `_new0` exists only for filled
    // element types, so asking for it where there is none is its own way to fail.
    const none = driven.fromWasm("u8[][]", driven.toWasm("u8[][]", [])) as Uint8Array[];
    assertEquals(none.length, 0, "an empty array of arrays did not come back empty");

    // **And a helper the module does not have is named, not swallowed.** `json` never reaches
    // `string[]`, so the compiler emitted no `$bind$arr_string_*` for it — asking anyway must say
    // which export is missing. A driver that returned the JavaScript array instead would hand the
    // module a value it cannot hold, and the trap would name a wasm offset instead of a type.
    // `issues/system/0148` is what that failure mode cost when `native/v8` answered an empty vector.
    let said = "";
    try {
      driven.toWasm("string[]", ["one"]);
    } catch (e) {
      said = e instanceof Error ? e.message : String(e);
    }
    if (!said.includes("$bind$arr_string_new")) {
      throw new Error(`a missing helper was not named: ${JSON.stringify(said)}`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
