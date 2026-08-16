// What wacc *computes* for the language tour, not merely whether it compiles it.
//
// `spec/tour.wac` is the whole of wac in one annotated file, and every function in it is written
// beside the answer it should give. `compiler/wacSpec.test.ts` compiles it with the reference and
// calls `selfTest()`. Nothing did that for wacc — the tour is in this package's corpus for *checking*
// and *emitting*, so a module that validates and returns the wrong number passed both.
//
// It was returning the wrong number. `%` on a float emitted no instruction at all, so `a % b`
// answered `b`, and `rem(-7.0, 2.0)` was `2` where the line below its definition in the tour says
// `-1.0`. `issues/lang/0135`. That is the shape this file exists to catch: a wrong answer from a
// module nothing refuses.
//
// **The reference is the oracle, called the same way.** Comparing wacc against the tour's written
// answers would work too and would drift — the comments are prose. Comparing two compilers on the
// same source is the differential this repository settles everything else with.

import { wacBind } from "../../../harness/wacBind.ts";
import { wacCompile } from "wac/wacCompile.ts";

/**
 * The differences that are known, each with the issue that owns it.
 *
 * Written as `name` rather than `name(args)`: a rule that is wrong is wrong for every input, and a
 * list keyed by call would grow a row per case and hide the day one of them started agreeing.
 */
const KNOWN_DIFFERENT = new Map<string, string>([
  ["rem", "issues/lang/0135 — `%` on a float emits nothing, so it answers the second operand"],
]);

/** Calls with their arguments, taken from `selfTest()`'s own conjuncts. */
const CALLS: [string, number[]][] = [
  ["double", [21]], ["factorial", [10]], ["strictBool", [3]], ["strictBool", [0]],
  ["useConst", [255]], ["fromTable", [1]], ["mixTypes", [1, 2.7]], ["shifts", [-16]],
  ["nearest", [3.7]], ["nearest", [2.5]], ["raw", [3.7]], ["branch", [-5]], ["branch", [0]],
  ["loops", [3]], ["infinite", [4, 10]], ["forever", [7]], ["classify", [0]], ["classify", [3]],
  ["ternary", [3, 7]], ["mustBePositive", [5]], ["bits", [-1]], ["chkU", [5]], ["clampU", [-5]],
  ["rem", [-7.0, 2.0]], ["rem", [7.0, -2.0]], ["rem", [7.0, 2.0]], ["rem", [7.5, 2.0]],
  // **The zero-argument half, which is most of the tour and costs nothing to add.** These reach the
  // parts the list above does not — arrays, structs, enums, nullability, funcrefs, generics — and
  // they can be compared across two modules where a call taking a *reference* cannot: a `Node` built
  // by one compiler's module is not a value the other's can be handed.
  ["trailingComma", []], ["wrap", []], ["mostNegative", []], ["fiveWide", []],
  ["dec", []], ["decBig", []], ["poly", []], ["padded", []], ["grouped", []], ["million", []],
  ["variables", []], ["constRef", []], ["incr", []], ["strBasics", []], ["strFind", []],
  ["strMid", []], ["arrays", []], ["arrayAlias", []], ["arrayOfRefs", []],
  ["packed", []], ["packedSigned", []], ["construction", []], ["structAlias", []],
  ["defaults", []], ["subtyping", []], ["nullability", []], ["unwrapLvalue", []],
  ["anyrefs", []], ["funcrefs", []], ["funcrefUses", []], ["methodRefs", []],
  ["shadowing", []], ["cells", []], ["inference", []],
];

Deno.test("wacc computes the tour's answers, and the reference is the oracle", async () => {
  const src = await Deno.readTextFile(new URL("../../../spec/tour.wac", import.meta.url));
  const w = await wacBind("spec/tour.wac") as unknown as Record<string, CallableFunction>;

  const r = wacCompile(new Map([["main.wac", src]]), "main.wac") as unknown as
    { ok: boolean; compiled?: { wasm: Uint8Array } };
  if (!r.ok || r.compiled === undefined) throw new Error("the reference no longer compiles the tour");
  // `as BufferSource`: a `Uint8Array` may be backed by a `SharedArrayBuffer`, which the DOM types
  // do not admit here — the same cast the rest of this repository uses at this boundary.
  const inst = await WebAssembly.instantiate(await WebAssembly.compile(r.compiled.wasm as BufferSource), {});
  const ref = inst.exports as unknown as Record<string, CallableFunction>;

  const differ: string[] = [];
  const agreed = new Set<string>();
  for (const [name, args] of CALLS) {
    const a = ref[name], b = w[name];
    if (typeof a !== "function" || typeof b !== "function") {
      throw new Error(`the tour no longer exports ${name} — update this file's call list`);
    }
    const want = String(a(...args));
    let got: string;
    try { got = String(b(...args)); } catch (e) { got = `threw ${e instanceof Error ? e.message : e}`; }
    if (want === got) { agreed.add(name); continue; }
    if (KNOWN_DIFFERENT.has(name)) continue;
    differ.push(`${name}(${args.join(", ")}): reference ${want}, wacc ${got}`);
  }

  if (differ.length > 0) {
    throw new Error(
      `wacc computes a different answer from the reference on the tour:\n  ${differ.join("\n  ")}`,
    );
  }

  // **A known difference that agrees now is a line to delete**, which is `specEmit.test.ts`'s rule
  // and worth as much here: a list of accepted failures nobody prunes is how a fixed bug goes on
  // looking open, and how the next one hides behind it.
  for (const [name, why] of KNOWN_DIFFERENT) {
    if (agreed.has(name)) {
      throw new Error(`${name} agrees with the reference now — take it out of KNOWN_DIFFERENT (${why})`);
    }
  }

  // **And the whole thing, once there is nothing known to be wrong.** `selfTest()` is a conjunction
  // over every function in the tour — far more than the calls listed above, which are only the ones
  // needed to localise a failure. It cannot be asserted while a known difference stands, because one
  // false conjunct makes it false and says nothing about which. So it switches on by itself the day
  // `KNOWN_DIFFERENT` empties, and from then on this file checks the tour rather than a sample of it.
  if (KNOWN_DIFFERENT.size === 0 && String((w.selfTest as CallableFunction)()) !== "true") {
    throw new Error(
      "the tour's selfTest() is false under wacc and nothing is listed as known-different — " +
        "some conjunct disagrees; add calls to CALLS above until one of them localises it",
    );
  }

  // **The canary.** Every call above could be comparing two broken things, or nothing at all: if
  // `wacBind` handed back a module whose exports were all missing, the loop above would have thrown,
  // but if the two agreed *because both were wrong* nothing here would say so. So one answer is
  // checked against the tour's own written value, which is a third source.
  if (String((w.double as CallableFunction)(21)) !== "42") {
    throw new Error("double(21) is not 42 — this comparison is not measuring the tour");
  }
});
