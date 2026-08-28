// **Does this ladder reach the same wacc as wac's own bootstrap?**
//
// The two first rungs differ and must: `wac-L5(S)` and `reference(S)` are wacc's source compiled
// by two entirely different compilers, and they come out 223,177 bytes apart. What matters is what
// happens next — both results are *wacc*, so if each is faithful they compile S the same way, and
// the second rung is the same bytes on both paths. The fixed point belongs to wacc's source rather
// than to whatever compiled it first, and that is the property that makes a ladder a replacement
// for a reference rather than a second opinion.
//
// It needs wac's own `compiler/` beside this repo, and skips when that is not there.
//
// **It costs six seconds**, which is most of this suite's running time: it compiles wacc four
// times — once by wac-L5, once by the reference, and once by each of those results. Worth it,
// because nothing else here can say the ladder is a *replacement* rather than a second opinion.

const HERE = new URL(".", import.meta.url).pathname;

async function referenceIsHere(): Promise<boolean> {
  try {
    await Deno.stat(`${HERE}../../compiler/wacCompile.ts`);
    return true;
  } catch {
    return false;
  }
}

Deno.test({
  name: "the ladder and wac's own bootstrap reach the same wacc, byte for byte",
  ignore: !(await referenceIsHere()),
  fn: async () => {
    const { result } = await import("./same_fixed_point.ts");
    if (!result.ourFixedPoint) throw new Error("this ladder is not at a fixed point");
    if (!result.referenceFixedPoint) throw new Error("the reference is not at a fixed point");
    if (!result.sameFixedPoint) {
      throw new Error(
        `the two fixed points differ: ${result.sizes.W1} bytes against ${result.sizes.X1}`,
      );
    }
  },
});
