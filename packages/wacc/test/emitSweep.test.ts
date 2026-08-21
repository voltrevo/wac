// Rung 4's generated sweep: run what both compilers emit, over programs nobody wrote by hand.
//
// The hand-written differential cases test what their author thought to write down, and that bias
// cost a real bug — 172 programs and 222 calls in which **every integer literal was plain decimal**,
// so `0xff` compiled to 0 and `1_000` to 1, silently, since the first slice. This is the same answer
// rung 3 reached one level down: generate the cross product and let the reference say what each
// program means.
//
// It found eleven distinct cast bugs on its first run, in a family the hand-written cases had
// "covered" with in-range values. `as@` wraps where the others saturate; a float-to-integer cast
// saturates rather than traps; `as~` rounds where `as@` truncates; a sign change at the same width
// needs one clamp and not two; an unsigned source is never below its target's minimum; and widening
// is still a sign change.
//
// What is asserted is that every answer agrees. A program the reference refuses is not a case, and a
// program this emitter declines is counted rather than compared — declining is honest and measured
// elsewhere, by the corpus test's invariant.
// test-lane: heavy — 599 MB and 29s, a generated cross product of casts

import { wacCompile } from "wac/wacCompile.ts";
import { wacBind } from "../../../harness/wacBind.ts";
import { generateEmit } from "./generateEmit.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const emit = mod.emit as (src: Uint8Array) => Uint8Array;
const blocked = mod.blocked as (src: Uint8Array) => string;
const enc = new TextEncoder();

Deno.test("rung 4: the generated sweep — every answer agrees", () => {
  const cells = generateEmit();
  if (cells.length < 1000) throw new Error(`only ${cells.length} cells generated`);

  let compared = 0;
  let declined = 0;
  const declines: string[] = [];
  let refused = 0;
  let trapped = 0;
  const mismatches: string[] = [];
  for (const cell of cells) {
    const r = wacCompile(new Map([["/main.wac", cell.src]]), "/main.wac");
    if (!r.ok) {
      refused++;
      continue;
    }
    // **A decline here is a program the reference just accepted**, so it is not "honest" by default:
    // it is wacc refusing to emit something that compiles. Today that count is **0** over 4102
    // compared programs, which makes it assertable — and an assertion is what `issues/lang/0170a`
    // needs, because tightening `typeOfE` there collapsed self-hosting over four rounds and the note
    // reads "there is no way to find round 4 from here". A round that refuses correct code now fails
    // this test *with the expression in the message*.
    const why = blocked(enc.encode(cell.src));
    if (why !== "") {
      declined++;
      if (declines.length < 10) declines.push(`${cell.context}: ${why} in ${cell.src}`);
      continue;
    }
    let want: unknown;
    try {
      want = (new WebAssembly.Instance(
        new WebAssembly.Module(Uint8Array.from(r.compiled.wasm)),
        {},
      ).exports.f as () => unknown)();
    } catch {
      // The reference's own module traps — a legitimate answer, but not one to compare.
      trapped++;
      continue;
    }
    let got: unknown;
    try {
      const bytes = Uint8Array.from(emit(enc.encode(cell.src)) as unknown as number[]);
      got = (new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports.f as () => unknown)();
    } catch (e) {
      got = `threw: ${(e as Error).message.slice(0, 40)}`;
    }
    compared++;
    if (String(want) !== String(got)) {
      if (mismatches.length < 10) {
        mismatches.push(`${cell.context}: ours=${got} reference=${want} in ${cell.src}`);
      }
    }
  }
  console.log(`    rung 4 sweep: ${cells.length} programs — ${compared} compared, ` +
    `${mismatches.length} mismatched, ${declined} declined, ${refused} not valid wac, ${trapped} trap`);

  // The canary: a sweep that compared nothing would report that everything agrees.
  if (compared < 1000) throw new Error(`only ${compared} programs were actually run and compared`);
  // **And the ceiling on declines, which used to be a number nobody read.** If one of these is a
  // program wac genuinely does not allow, the reference is the thing to fix — it accepted it three
  // lines above.
  if (declined !== 0) {
    throw new Error(
      `${declined} program(s) the reference compiled were declined by this emitter:\n  ` +
        declines.join("\n  "),
    );
  }
  if (mismatches.length !== 0) {
    throw new Error(`answers differ:\n  ` + mismatches.join("\n  "));
  }
});
