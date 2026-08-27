// `deno run -A ts/ask_wacc.ts <file.wac>...` — put a wac program through the wacc that wac-L5
// built and say what came back: parse errors, type errors, whether a module was emitted, and the
// reason if the emitter declined.
//
// The single-case counterpart to `spec_cases.ts`. Narrowing a failure means asking the same
// question of a dozen variants, and rebuilding wacc for each would make that take minutes — so
// wacc is built once and every file goes through the same instance.

import { flatten, l5ToL0 } from "./l5.ts";
import { assemble } from "./assemble.ts";

const HERE = new URL(".", import.meta.url).pathname;
const l0 = await l5ToL0(
  await flatten(`${HERE}../../wac/packages/wacc/src/api.wac`) + "\n" +
    await Deno.readTextFile(`${HERE}../drivers/spec_cases.wac`),
);
const inst = await WebAssembly.instantiate(
  await WebAssembly.compile(assemble(l0).buffer as ArrayBuffer),
  {},
);
const e = inst.exports as Record<string, CallableFunction>;

const enc = new TextEncoder();
const feed = (s: string) => {
  const b = enc.encode(s);
  e.drv_alloc(b.length);
  for (let i = 0; i < b.length; i++) e.drv_setByte(i, b[i]);
};
const decline = (): string => {
  const n = e.drv_decline() as number;
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = e.drv_declineByte(i) as number;
  return new TextDecoder().decode(b);
};

for (const path of Deno.args) {
  const src = await Deno.readTextFile(path);
  feed(src);
  const parse = e.drv_parseErrors() as number;
  const typed = e.drv_typeErrors() as number;
  const n = e.drv_build() as number;
  const why = decline();
  const name = path.split("/").pop();
  console.log(
    `${name}\n  parse errors ${parse / 3}, type errors ${typed / 3}, module ${n} bytes` +
      (why === "" ? "" : `\n  declined: ${why}`),
  );
  if (n > 8) {
    const mod = new Uint8Array(n);
    for (let i = 0; i < n; i++) mod[i] = e.drv_byteAt(i) as number;
    try {
      const i2 = await WebAssembly.instantiate(
        await WebAssembly.compile(mod.buffer as ArrayBuffer),
        {},
      );
      const names = Object.keys(i2.exports).filter((k) => !k.startsWith("$"));
      // **Exporting `f` is not the same as `f` being right.** A lookup that falls back to
      // matching a method by name alone emits a module that runs and answers the wrong thing,
      // and a probe that stops at the export list cannot tell the two apart.
      const answers = names.map((k) => {
        const fn = (i2.exports as Record<string, CallableFunction>)[k];
        if (typeof fn !== "function") return `${k}=?`;
        try {
          return `${k}() = ${fn()}`;
        } catch (err) {
          return `${k}() traps: ${(err as Error).message.slice(0, 40)}`;
        }
      });
      console.log(`  ${answers.join(", ")}`);
    } catch (err) {
      console.log(`  the engine refused it: ${(err as Error).message.slice(0, 90)}`);
    }
  }
}
