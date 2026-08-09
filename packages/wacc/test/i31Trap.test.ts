// The one place wacc is **specified to disagree** with the compiler it is otherwise measured against.
//
// `spec/spec/casts.md` states the rule for the whole family — *"`as!` — checked: exact or trap"* —
// and says it again for this cast in particular: `42 as! i31ref` is "checked (i32 may not fit in 31
// bits)". A value with a thirty-second bit has no `i31ref` to be, so the cast has to trap.
//
// The reference truncates instead: `1073741824 as! i31ref as i32` comes back as -1073741824, and
// `-1073741825` as 1073741823. That is `issues/lang/0085`, and until it is fixed the two compilers
// answer differently on purpose — which is exactly why these two programs are *not* in
// `generateEmit.ts`. A differential sweep can only report a mismatch; a mismatch that is expected
// would have to be excused every run, and an excuse is the thing that hides the next real one.
//
// So the assertion here is against the *specification* rather than against the other implementation.

import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const emit = mod.emit as (src: Uint8Array) => Uint8Array;
const enc = new TextEncoder();

function run(src: string): unknown {
  const bytes = Uint8Array.from(emit(enc.encode(src)) as unknown as number[]);
  return (new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports.f as () => unknown)();
}

Deno.test("rung 4: `as! i31ref` is checked, as the spec says and the reference does not", () => {
  // In range, both ends of it: thirty-one bits signed is -2^30 … 2^30-1 after `i31.get_s`.
  const cases: [string, number][] = [
    ["0", 0],
    ["42", 42],
    ["-42", -42],
    ["1073741823", 1073741823],
    ["-1073741824", -1073741824],
  ];
  for (const [lit, want] of cases) {
    const got = run(`export i32 f() { i31ref r = ${lit} as! i31ref; return r as i32; }`);
    if (got !== want) throw new Error(`${lit} as! i31ref as i32 gave ${got}, not ${want}`);
  }

  // Outside it, in both directions: a trap rather than the low thirty-one bits.
  for (const lit of ["1073741824", "-1073741825", "2147483647", "-2147483648"]) {
    let trapped = false;
    try {
      run(`export i32 f() { i31ref r = ${lit} as! i31ref; return r as i32; }`);
    } catch {
      trapped = true;
    }
    if (!trapped) throw new Error(`${lit} as! i31ref did not trap, and \`as!\` is checked`);
  }
});
