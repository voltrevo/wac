// A built artefact says which compiler made it.
//
// Two compilers build this repository — `WAC_APP_FROM` picks one — and their output differs by about
// a fifth in size (`issues/lang/0107`). Until now nothing in either artefact recorded which one ran,
// so "what built this page" was answered by whatever the environment happened to be when somebody
// typed the command, and a page built before the default flipped was indistinguishable from one
// built after. `issues/lang/0103`, criterion 2.
//
// The marker is the standard `producers` custom section rather than anything invented here, so
// `wasm-objdump` and every other tool that already reads it does.

import { buildNative } from "../native.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

/** Every `processed-by` value in a module's `producers` section, in order. */
function producedBy(wasm: Uint8Array): string[] {
  const secs = WebAssembly.Module.customSections(
    new WebAssembly.Module(wasm as BufferSource),
    "producers",
  );
  if (secs.length === 0) return [];
  const b = new Uint8Array(secs[0]);
  let p = 0;
  const u32 = () => {
    let r = 0, sh = 0, x = 0;
    do { x = b[p++]; r |= (x & 0x7f) << sh; sh += 7; } while (x & 0x80);
    return r >>> 0;
  };
  const str = () => { const n = u32(); const s = new TextDecoder().decode(b.subarray(p, p + n)); p += n; return s; };
  const out: string[] = [];
  const fields = u32();
  for (let f = 0; f < fields; f++) {
    const name = str();
    const values = u32();
    for (let v = 0; v < values; v++) {
      const value = str();
      str(); // the version, which neither compiler has a number for yet
      if (name === "processed-by") out.push(value);
    }
  }
  return out;
}

/** Build `hello.wac` with `WAC_APP_FROM` set as given, and read the marker back. */
async function builtBy(from: string | undefined): Promise<string[]> {
  const saved = Deno.env.get("WAC_APP_FROM");
  if (from === undefined) Deno.env.delete("WAC_APP_FROM");
  else Deno.env.set("WAC_APP_FROM", from);
  const dir = await Deno.makeTempDir({ prefix: "wac-producer-" });
  try {
    await buildNative("native/v8/example/hello.wac", `${dir}/hello`, {});
    return producedBy(await Deno.readFile(`${dir}/hello.wasm`));
  } finally {
    if (saved === undefined) Deno.env.delete("WAC_APP_FROM");
    else Deno.env.set("WAC_APP_FROM", saved);
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("a built module names the compiler that made it, and the two names differ", async () => {
  // **Both, and different** — which is the property. A marker on one compiler only would make
  // absence mean "the other one", and absence also means "built before this landed".
  assertEquals(await builtBy(undefined), ["wacc"], "the default is wacc");
  assertEquals(await builtBy("reference"), ["wac-reference"], "and the escape hatch says so");
});
