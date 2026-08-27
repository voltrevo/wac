// **The bootstrap, closed.**
//
// wac-L5 builds wacc from source; that wacc compiles wacc's own source; and the two compilers are
// asked to compile the same program and compared byte for byte. If they agree there is no
// historical wasm anywhere in the chain — an assembler written twice from a written format, an
// interpreter, four compilers, and then the real compiler reproducing itself.
//
// The comparison is a length and a checksum rather than the bytes, because the second compiler has
// to answer without handing a wasm GC reference to JavaScript, which the engine will not do. A
// stateless driver compiled into it answers an i32 instead — wac has no mutable module-level
// variable, so stateless is the only kind of driver a wac module can have.

const HERE = new URL(".", import.meta.url).pathname;

async function corpusIsHere(): Promise<boolean> {
  try {
    await Deno.stat(`${HERE}../../wac/packages/wacc/src/api.wac`);
    return true;
  } catch {
    return false;
  }
}

Deno.test({
  name: "wacc built by wac-L5 builds wacc, and the two agree byte for byte",
  ignore: !(await corpusIsHere()),
  fn: async () => {
    const { agreed, sizes } = await import("./selfhost.ts");
    if (sizes.round1 < 100000) throw new Error(`round 1 is only ${sizes.round1} bytes`);
    if (!agreed) throw new Error("the two compilers disagree about what a program compiles to");
  },
});
