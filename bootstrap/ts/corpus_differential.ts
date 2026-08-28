// **Two compilers, the same source, compared byte for byte.**
//
// wac-L5 builds wacc (round 0). Round 0 builds wacc again from the same source (round 1). If
// wac-L5 has a bug then round 0 is a subtly wrong wacc — and round 1, built *by* that wrong
// compiler from correct source, is where the wrongness shows. Compiling the same program with
// both and comparing the bytes is the classic fixed-point test, and it needs no expectations at
// all: the corpus is the input and the two compilers are each other's oracle.
//
// `selfhost.ts` does this for one four-line program. This does it for every package in the repo,
// which is the difference between "the chain closes" and "the chain closes on real code".
//
// Round 0 is driven through the concatenated driver, which can only exist because it is spliced
// onto a flattened graph. Round 1 is driven through the binding layer wacc emits for itself —
// `$bind$arr_u8_from_mem` and friends, named from the element type each array holds.

import { bodies } from "/tmp/claude-1001/-home-claude/d05345b6-fd57-448d-8b8a-2d3c942d2d62/scratchpad/whichfn.ts";
import { flatten, l5ToL0 } from "./l5.ts";
import { assemble } from "../js/assemble.js";

const HERE = new URL(".", import.meta.url).pathname;
const WAC = `${HERE}../..`;
const ROOT = await Deno.realPath(WAC);
const enc = new TextEncoder();

/** A file and everything it imports, keyed repo-relative so a `../..` specifier resolves. */
async function graphOf(entry: string): Promise<{ path: string; text: string }[]> {
  const out: { path: string; text: string }[] = [];
  const seen = new Set<string>();
  async function walk(abs: string): Promise<void> {
    const real = await Deno.realPath(abs);
    if (seen.has(real)) return;
    seen.add(real);
    const text = await Deno.readTextFile(real);
    out.push({ path: real.slice(ROOT.length + 1), text });
    const dir = real.slice(0, real.lastIndexOf("/"));
    for (const m of text.matchAll(/^\s*import\s*\{[^}]*\}\s*from\s*"([^"]+)"\s*;/gm)) {
      const spec = m[1];
      // **A sibling may be named without `./`.** `oracle.wac` imports `"host.wac"`, which is a
      // path and not a package — skipping it because it lacked a dot made the file look like one
      // neither compiler could take, when neither had been given what it asked for. `core/` and
      // `std/` are the ones wacc answers out of its own text.
      const builtin = spec.startsWith("core") || spec.startsWith("std");
      if (!spec.startsWith(".") && (builtin || !spec.endsWith(".wac"))) continue;
      try {
        await walk(`${dir}/${spec}`);
      } catch { /* a specifier this harness cannot resolve; wacc will say so */ }
    }
  }
  await walk(entry);
  return out;
}

// ---------------------------------------------------------------- round 0

const l0 = await l5ToL0(
  await flatten(`${WAC}/packages/wacc/src/api.wac`) + "\n" +
    await Deno.readTextFile(`${HERE}../drivers/spec_cases.wac`),
);
if ((l0.match(/^!!/gm) ?? []).length > 0) {
  console.error("wac-L5 refused something in wacc");
  Deno.exit(1);
}
const round0Bytes = assemble(l0);
const r0 = (await WebAssembly.instantiate(
  await WebAssembly.compile(round0Bytes.buffer as ArrayBuffer),
  {},
)).exports as Record<string, CallableFunction>;
console.log(`round 0: wac-L5 built wacc, ${round0Bytes.length} bytes`);

function r0Feed(fn: string, name: string, s: string) {
  const b = enc.encode(s);
  (r0[fn] as CallableFunction)(b.length);
  for (let i = 0; i < b.length; i++) (r0[name] as CallableFunction)(i, b[i]);
}

function r0Compile(files: { path: string; text: string }[], entry: string): Uint8Array | null {
  r0.drv_files(files.length);
  for (const f of files) {
    r0Feed("drv_alloc", "drv_setByte", f.text);
    r0Feed("drv_allocName", "drv_setNameByte", f.path);
    r0.drv_pushFile();
  }
  r0Feed("drv_allocName", "drv_setNameByte", entry);
  const n = r0.drv_buildFiles() as number;
  if (n <= 8) return null;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = r0.drv_byteAt(i) as number;
  return out;
}

// ---------------------------------------------------------------- round 1

const waccGraph = await graphOf(`${WAC}/packages/wacc/src/api.wac`);
const round1Bytes = r0Compile(waccGraph, "packages/wacc/src/api.wac");
if (round1Bytes === null) {
  console.error("round 0 could not build wacc");
  Deno.exit(1);
}
console.log(`round 1: wacc built wacc, ${round1Bytes.length} bytes`);

const r1 = (await WebAssembly.instantiate(
  await WebAssembly.compile(round1Bytes.buffer as ArrayBuffer),
  {},
)).exports as Record<string, unknown>;
const call = (name: string, ...args: unknown[]): unknown => {
  const f = r1[name];
  if (typeof f !== "function") throw new Error(`round 1 exports no ${name}`);
  return (f as CallableFunction)(...args);
};
const mem = () => (r1["$bind$mem"] as WebAssembly.Memory).buffer;

// **`_from_mem` takes the length and nothing else**: the staging buffer is always at offset zero.
// Passing an offset as well is silently a length of zero, which arrives as an empty string — and
// an empty program compiles to a perfectly good empty module, so the mistake looks like a
// compiler that answers small rather than a host that asked wrong.
//
// The view is taken between the two calls because `mem_ensure` may grow the memory, and growing
// detaches the ArrayBuffer a caller was holding.
function give(make: string, data: Uint8Array): unknown {
  call("$bind$mem_ensure", data.length);
  new Uint8Array(mem()).set(data, 0);
  return call(make, data.length);
}
const toWasmString = (s: string): unknown => give("$bind$str_from_mem", enc.encode(s));
const toWasmBytes = (s: string): unknown => give("$bind$arr_u8_from_mem", enc.encode(s));
function fromWasmBytes(w: unknown): Uint8Array {
  const n = call("$bind$arr_u8_len", w) as number;
  call("$bind$mem_ensure", n + 8);
  call("$bind$arr_u8_to_mem", w);
  return new Uint8Array(mem()).slice(0, n);
}

function r1Compile(files: { path: string; text: string }[], entry: string): Uint8Array | null {
  // **`_new` takes a fill value as well as a count** when the element is a reference: there is no
  // default for a non-nullable one, so the array cannot be made empty and then written into.
  const blank = toWasmString("");
  const paths = call("$bind$arr_string_new", files.length, blank);
  const sources = call("$bind$arr_string_new", files.length, blank);
  files.forEach((f, i) => {
    call("$bind$arr_string_set", paths, i, toWasmString(f.path));
    call("$bind$arr_string_set", sources, i, toWasmString(f.text));
  });
  const out = call("emitFiles", paths, sources, toWasmString(entry));
  const bytes = fromWasmBytes(out);
  return bytes.length <= 8 ? null : bytes;
}

// **The boundary is checked before it is trusted.** A marshalling mistake and a compiler bug both
// show up as "round 1 produced nothing", and telling them apart afterwards costs more than
// proving the boundary works on a program whose answer is already known.
{
  const probe = "export i32 answer() { return 6 * 7; }";
  const viaEmit = fromWasmBytes(call("emit", toWasmBytes(probe)));
  const viaFiles = r1Compile([{ path: "p.wac", text: probe }], "p.wac");
  const byR0 = r0Compile([{ path: "p.wac", text: probe }], "p.wac");
  console.log(
    `boundary check: emit ${viaEmit.length} bytes, emitFiles ${viaFiles?.length ?? 0}, ` +
      `round 0 ${byR0?.length ?? 0}`,
  );
  if (viaFiles === null) {
    console.log("the emitFiles boundary is wrong, not the compiler — stopping here");
    Deno.exit(1);
  }
}

// ---------------------------------------------------------------- the sweep

const entries: string[] = [];
for (const pkg of Deno.readDirSync(`${WAC}/packages`)) {
  if (!pkg.isDirectory) continue;
  try {
    for (const f of Deno.readDirSync(`${WAC}/packages/${pkg.name}/src`)) {
      if (f.isFile && f.name.endsWith(".wac")) {
        entries.push(`packages/${pkg.name}/src/${f.name}`);
      }
    }
  } catch { /* no src/ */ }
}
entries.sort();
console.log(`\n${entries.length} entry points in the corpus\n`);

let same = 0;
let differ = 0;
let neither = 0;
const notes: string[] = [];
for (const rel of entries) {
  let files: { path: string; text: string }[];
  try {
    files = await graphOf(`${ROOT}/${rel}`);
  } catch (err) {
    notes.push(`${rel}  unreadable: ${(err as Error).message.slice(0, 50)}`);
    continue;
  }
  let a: Uint8Array | null = null;
  let b: Uint8Array | null = null;
  try {
    a = r0Compile(files, rel);
  } catch (err) {
    notes.push(`${rel}  round 0 trapped: ${(err as Error).message.slice(0, 50)}`);
  }
  try {
    b = r1Compile(files, rel);
  } catch (err) {
    notes.push(`${rel}  round 1 trapped: ${(err as Error).message.slice(0, 50)}`);
  }
  if (a === null && b === null) {
    neither++;
    notes.push(`${rel}  neither compiled it`);
    continue;
  }
  if (a === null || b === null) {
    differ++;
    notes.push(`${rel}  one compiled and the other did not (r0 ${a?.length ?? "-"}, r1 ${b?.length ?? "-"})`);
    continue;
  }
  if (a.length === b.length && a.every((v, i) => v === b[i])) same++;
  else {
    differ++;
    const at = a.findIndex((v, i) => v !== b[i]);
    const hex = (u: Uint8Array, from: number, n: number) =>
      [...u.slice(from, from + n)].map((x) => x.toString(16).padStart(2, "0")).join(" ");
    const ba = bodies(a);
    const bb = bodies(b);
    let which = -1;
    for (let i = 0; i < Math.min(ba.length, bb.length); i++) {
      const x = a.slice(ba[i].at, ba[i].at + ba[i].len);
      const y = b.slice(bb[i].at, bb[i].at + bb[i].len);
      if (x.length !== y.length || !x.every((v, k) => v === y[k])) { which = i; break; }
    }
    let detail = "";
    if (which >= 0) {
      const x = a.slice(ba[which].at, ba[which].at + ba[which].len);
      const y = b.slice(bb[which].at, bb[which].at + bb[which].len);
      const d = x.findIndex((v, k) => v !== y[k]);
      detail = `\n      function #${which} of ${ba.length}, body ${x.length} vs ${y.length} bytes, differs at ${d}` +
        `\n      round 0: ${hex(x, Math.max(0, d - 8), 20)}` +
        `\n      round 1: ${hex(y, Math.max(0, d - 8), 20)}`;
    }
    notes.push(`${rel}  ${a.length} vs ${b.length} bytes${detail}`);
  }
}

console.log(`${same} agree byte for byte`);
console.log(`${differ} differ`);
console.log(`${neither} neither compiled — declined by both, which is agreement of a kind`);
if (notes.length > 0) {
  console.log(`\n${notes.length} to look at:`);
  for (const n of notes.slice(0, 30)) console.log(`  ${n}`);
}
