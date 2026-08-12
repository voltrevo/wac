// A module driven from its manifest answers what the generated glue answers.
//
// The JavaScript hosts start a program by importing a bundle that carries glue written for that one
// program. `native/v8` starts a module and reads its `wac.manifest` section instead, which is why
// `spawn` takes wasm there and a bundle here — the split `issues/system/0143` is about. `driver.ts`
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

    // Nothing here reaches out, so a dispatcher that is called at all is a bug worth hearing about.
    const driven = drive(wasm, manifest, (sig, slot) => {
      throw new Error(`json asked for capability ${sig}/${slot}, and it has none`);
    });

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
