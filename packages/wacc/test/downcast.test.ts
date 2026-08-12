// `as!` out of `anyref` is a cast, and has to be emitted as one.
//
// A capability handed a callback gets the context back as `anyref` — `packages/ssh/src/sshd.wac`'s
// `keystrokeArrived(anyref ctx)` starts `Keystrokes k = ctx as! Keystrokes;` — so this is the one
// spelling that turns the host's opaque reference back into something with fields. wacc emitted the
// conversion as nothing at all: the value stayed `anyref` and the module failed *validation*,
//
//   Compiling function #72:"keystrokeArrived" failed:
//   local.set[0] expected type (ref null 35), found local.get of type anyref
//
// which is a whole program that does not load rather than a wrong answer [issue 0106].

import { waccApi } from "../../../harness/waccBuild.ts";

const SOURCE = `export struct S { i32 v; }
export bool takes(anyref x) { S s = x as! S; return s.v > 0; }
export bool go() { S s = S(7); return takes(s); }
`;

Deno.test("a downcast out of anyref emits a cast, and the module validates", async () => {
  const api = await waccApi();
  const wasm = Uint8Array.from(
    api.emitFiles(["/t/m.wac"], [SOURCE], "/t/m.wac") as unknown as number[],
  );
  if (wasm.length <= 8) throw new Error("the module was declined");

  let instance: WebAssembly.Instance;
  try {
    instance = new WebAssembly.Instance(new WebAssembly.Module(wasm), {});
  } catch (err) {
    throw new Error(`the module was rejected: ${err instanceof Error ? err.message : err}`);
  }

  // And the cast is a real one: the struct survives the round trip through `anyref` with its field
  // intact, rather than being reinterpreted into something that happens to validate.
  const go = (instance.exports as { go?: () => number }).go;
  if (go === undefined) throw new Error("go was not exported");
  if (go() !== 1) throw new Error(`go() gave ${go()}, expected 1`);
});

Deno.test("a downcast to a nullable target lets a null through instead of trapping", async () => {
  // `ref.cast (ref $T)` and `ref.cast null (ref null $T)` are different instructions, and the
  // difference is exactly whether a null arrives or traps. `S?` is a type a null inhabits.
  const api = await waccApi();
  const source = `export struct S { i32 v; }
export bool gotNull(anyref x) { S? s = x as! S?; return s is null; }
export bool go() { return gotNull(null); }
`;
  const wasm = Uint8Array.from(
    api.emitFiles(["/t/n.wac"], [source], "/t/n.wac") as unknown as number[],
  );
  if (wasm.length <= 8) throw new Error("the module was declined");
  const instance = new WebAssembly.Instance(new WebAssembly.Module(wasm), {});
  const go = (instance.exports as { go?: () => number }).go;
  if (go === undefined) throw new Error("go was not exported");
  if (go() !== 1) throw new Error(`a null did not survive the cast: go() gave ${go()}`);
});
