// The manifest a non-JavaScript host reads has to agree with itself.
//
// `native/src/manifest.rs` resolves a funcref field by looking its *type string* up among the
// callbacks — `callback_index(ty)` — so a field spelled one way and a callback spelled another is a
// capability the host cannot wire, and it fails at run time in a program rather than here. Nothing
// checks the spelling from outside, which is what makes the property worth asserting: both sides
// come from the same compiler, and the compiler changed.
//
// It also has to contain the names the host asks for by hand. `main.rs` maps its own `Kind`s onto
// `Pending<i32>`, `Pending<u8[]?>` and the rest, and `Pending<u8[]?>` is the interesting one: the
// emitter collapses it into `Pending<u8[]>`, because a nullable reference and a reference are the
// same wasm type, and records the second spelling as an alias. The manifest carries both names,
// pointing at one type [issue 0106].

import { buildNative } from "../native.ts";

/** What `native/src/main.rs` looks up by name, and would return `None` for if it were absent. */
const HOST_NEEDS = [
  "Core",
  "Cli",
  "Pending<i32>",
  "Pending<i64>",
  "Pending<bool>",
  "Pending<string>",
  "Pending<u8[]>",
  "Pending<u8[]?>",
];

Deno.test("the manifest resolves its own funcref fields, and names what the host asks for", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-manifest-" });
  try {
    const m = await buildNative("packages/platform/example/wc.wac", `${dir}/wc`, { read: true });

    const callbackTypes = new Set(m.callbacks.map((c) => c.type));
    const unresolved: string[] = [];
    for (const s of m.structs) {
      for (const f of s.fields) {
        // **An array of funcrefs is an array.** `fn[void(i32)][]` starts with `fn[` too, and the
        // host wires *funcref fields* — a field holding a table of them is the module's own storage
        // and crosses nothing. The compiler made the same mistake in `isFuncrefType`, where it made
        // every module holding such a table invalid; `spec/cases/0196` is that one.
        if (!f.type.startsWith("fn[") || f.type.endsWith("[]")) continue;
        if (!callbackTypes.has(f.type)) unresolved.push(`${s.name}.${f.name}: ${f.type}`);
      }
    }
    if (unresolved.length > 0) {
      throw new Error(
        `${unresolved.length} funcref field(s) name a signature the manifest has no dispatcher ` +
          `for — the host cannot wire them:\n  ${unresolved.slice(0, 5).join("\n  ")}`,
      );
    }

    const names = new Set(m.structs.map((s) => s.name));
    const missing = HOST_NEEDS.filter((n) => !names.has(n));
    if (missing.length > 0) {
      throw new Error(`the manifest does not name ${missing.join(", ")} — main.rs asks for each`);
    }

    // **Every enum says how to build it.** `Read` is what `readChunk` answers with, and a host that
    // is not told `$bind$e_Read_Data_new` spells it — which both hosts did until this field existed,
    // making three copies of one convention, two of which keep working wrongly the day it changes
    // [issue 0141]. The check is that the manifest describes enums at all, and names a constructor
    // for each variant.
    const read = m.structs.find((s) => s.name === "Read");
    if (read === undefined) {
      throw new Error("the manifest describes no Read, which is what every readChunk answers with");
    }
    const wanted = ["Data", "End", "Failed"];
    for (const v of wanted) {
      const spec = read.variants.find((x) => x.name === v);
      if (spec === undefined) throw new Error(`Read has no ${v} variant in the manifest`);
      if (!spec.make.startsWith("$bind$")) {
        throw new Error(`Read.${v} names ${JSON.stringify(spec.make)}, which is not an export`);
      }
    }
    // A payload is part of the description too: `Data(u8[] bytes)` is what makes it constructible.
    const data = read.variants.find((x) => x.name === "Data")!;
    if (data.fields.length !== 1 || data.fields[0].type !== "u8[]") {
      throw new Error(`Read.Data carries ${JSON.stringify(data.fields)}, expected one u8[]`);
    }

    // The dispatcher naming is a convention shared with `emit.wac` and the Rust host, so it is
    // stated once here rather than trusted three times.
    for (const [i, c] of m.callbacks.entries()) {
      if (c.field !== `cb${i}`) throw new Error(`callback ${i} is imported as ${c.field}`);
      if (c.helper !== `$bind$fnref_${i}`) throw new Error(`callback ${i} helper is ${c.helper}`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
