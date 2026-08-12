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
        if (!f.type.startsWith("fn[")) continue;
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
