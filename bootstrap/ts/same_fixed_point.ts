// **Do the two bootstraps reach the same fixed point?**
//
//   the reference:  X0 = R(S)          then X1 = X0(S)
//   this ladder:    W0 = wac-L5(S)     then W1 = W0(S)
//
// X0 and W0 differ, and must: they are wacc's source compiled by two entirely different compilers.
// But X0 and W0 are both *wacc*, so if each is faithful they compile S the same way — and X1 and
// W1 are the same bytes. That is the claim, and it is the only one that matters: the fixed point
// belongs to wacc's source, not to whatever compiled it first.

import { flatten, l5ToL0 } from "./l5.ts";
import { assemble } from "../js/assemble.js";
import { wacCompile } from "../../wac/compiler/wacCompile.ts";

const HERE = new URL(".", import.meta.url).pathname;
const WAC = `${HERE}../../wac`;
const ROOT = await Deno.realPath(WAC);
const enc = new TextEncoder();

const files: { path: string; text: string }[] = [];
const seen = new Set<string>();
async function walk(abs: string) {
  const real = await Deno.realPath(abs);
  if (seen.has(real)) return;
  seen.add(real);
  const text = await Deno.readTextFile(real);
  files.push({ path: real.slice(ROOT.length + 1), text });
  const dir = real.slice(0, real.lastIndexOf("/"));
  for (const m of text.matchAll(/^\s*import\s*\{[^}]*\}\s*from\s*"([^"]+)"\s*;/gm)) {
    const spec = m[1];
    const builtin = spec.startsWith("core") || spec.startsWith("std");
    if (!spec.startsWith(".") && (builtin || !spec.endsWith(".wac"))) continue;
    try { await walk(`${dir}/${spec}`); } catch { /* not on disk */ }
  }
}
await walk(`${WAC}/packages/wacc/src/api.wac`);
const ENTRY = "packages/wacc/src/api.wac";

/** Any wacc module, driven through the binding layer it emits for itself. */
async function bind(bytes: Uint8Array) {
  const inst = await WebAssembly.instantiate(
    await WebAssembly.compile(bytes.buffer as ArrayBuffer),
    {},
  );
  const x = inst.exports as Record<string, unknown>;
  const call = (n: string, ...a: unknown[]) => (x[n] as CallableFunction)(...a);
  const mem = () => (x["$bind$mem"] as WebAssembly.Memory).buffer;
  const give = (make: string, data: Uint8Array) => {
    call("$bind$mem_ensure", data.length);
    new Uint8Array(mem()).set(data, 0);
    return call(make, data.length);
  };
  const str = (s: string) => give("$bind$str_from_mem", enc.encode(s));
  return {
    compile(set: { path: string; text: string }[], entry: string): Uint8Array {
      const blank = str("");
      const paths = call("$bind$arr_string_new", set.length, blank);
      const sources = call("$bind$arr_string_new", set.length, blank);
      set.forEach((f, i) => {
        call("$bind$arr_string_set", paths, i, str(f.path));
        call("$bind$arr_string_set", sources, i, str(f.text));
      });
      const out = call("emitFiles", paths, sources, str(entry));
      const n = call("$bind$arr_u8_len", out) as number;
      call("$bind$mem_ensure", n + 8);
      call("$bind$arr_u8_to_mem", out);
      return new Uint8Array(mem()).slice(0, n);
    },
  };
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

// **W0 is driven differently, because wac-L5 emits no binding layer.** Everything above it does:
// a module wacc built exports `$bind$*` for its own host. W0 is the one module in this comparison
// that was not built by a wacc, so it gets the concatenated driver instead.
const l0 = await l5ToL0(
  await flatten(`${WAC}/packages/wacc/src/api.wac`) + "\n" +
    await Deno.readTextFile(`${HERE}../drivers/spec_cases.wac`),
);
const W0 = assemble(l0);
const w0inst = await WebAssembly.instantiate(
  await WebAssembly.compile(W0.buffer as ArrayBuffer),
  {},
);
const e0 = w0inst.exports as Record<string, CallableFunction>;
const feed0 = (a: string, b: string, str: string) => {
  const u = enc.encode(str);
  e0[a](u.length);
  for (let i = 0; i < u.length; i++) e0[b](i, u[i]);
};
const w0 = {
  compile(set: { path: string; text: string }[], entry: string): Uint8Array {
    e0.drv_files(set.length);
    for (const f of set) {
      feed0("drv_alloc", "drv_setByte", f.text);
      feed0("drv_allocName", "drv_setNameByte", f.path);
      e0.drv_pushFile();
    }
    feed0("drv_allocName", "drv_setNameByte", entry);
    const n = e0.drv_buildFiles() as number;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = e0.drv_byteAt(i) as number;
    return out;
  },
};
let t = performance.now();
const W1 = w0.compile(files, ENTRY);
const w1ms = Math.round(performance.now() - t);
const W2 = (await bind(W1)).compile(files, ENTRY);

// X0 is built here rather than read from a file, so the comparison is against the reference as it
// stands rather than against an artefact somebody produced once.
const asMap = new Map(files.map((f) => [f.path, f.text]));
t = performance.now();
const refResult = wacCompile(asMap, ENTRY);
const refms = Math.round(performance.now() - t);
if (!refResult.ok) {
  console.error("the reference could not compile wacc");
  Deno.exit(1);
}
const X0 = refResult.compiled.wasm;
const x0 = await bind(X0);
t = performance.now();
const X1 = x0.compile(files, ENTRY);
const x1ms = Math.round(performance.now() - t);
const X2 = (await bind(X1)).compile(files, ENTRY);

console.log(`W0  wacc by wac-L5           ${String(W0.length).padStart(7)} bytes`);
console.log(`X0  wacc by the reference    ${String(X0.length).padStart(7)} bytes  (${refms} ms)`);
console.log(`W1  wacc by W0               ${String(W1.length).padStart(7)} bytes  (${w1ms} ms)`);
console.log(`X1  wacc by X0               ${String(X1.length).padStart(7)} bytes  (${x1ms} ms)`);
console.log("");
console.log(`W1 == W2  (our ladder is at its fixed point)     ${same(W1, W2)}`);
console.log(`X1 == X2  (the reference is at its fixed point)  ${same(X1, X2)}`);
console.log(`W1 == X1  (the two fixed points are the same)    ${same(W1, X1)}`);

export const result = {
  sameFixedPoint: same(W1, X1),
  ourFixedPoint: same(W1, W2),
  referenceFixedPoint: same(X1, X2),
  sizes: { W0: W0.length, X0: X0.length, W1: W1.length, X1: X1.length },
};
if (!same(W1, X1)) {
  const at = W1.findIndex((v, i) => v !== X1[i]);
  console.log(`  first difference at byte ${at} of ${W1.length} vs ${X1.length}`);
}
