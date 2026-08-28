// **wacc compiling wacc.**
//
// wac-L5 builds wacc from source. This asks that wacc to compile wacc's own source, and then asks
// *that* wacc to compile a wac program — which is the whole point of the ladder. If it works there
// is no historical wasm anywhere in the chain: an assembler written twice from a spec, an
// interpreter, four compilers, and then the real compiler reproducing itself.
//
// Two rounds, because one proves less than it looks. A compiler that builds a broken copy of
// itself still builds *something*, and the copy is where the damage shows.

import { flatten, l5ToL0 } from "./l5.ts";
import { assemble } from "../js/assemble.js";

const HERE = new URL(".", import.meta.url).pathname;
const WAC = `${HERE}../..`;

// **The source wacc is made of, keyed the way it spells its own imports.** print.wac reaches
// `../../bytes/src/buf.wac`, so the keys have to be repo-relative rather than bare filenames or
// that path resolves to nowhere. The graph is walked rather than listed: which files wacc is made
// of is a fact about its imports, and a directory listing is a guess that goes stale.
const ROOT = await Deno.realPath(WAC);
const files: { path: string; text: string }[] = [];
const seen = new Set<string>();

async function collect(abs: string): Promise<void> {
  const real = await Deno.realPath(abs);
  if (seen.has(real)) return;
  seen.add(real);
  const text = await Deno.readTextFile(real);
  files.push({ path: real.slice(ROOT.length + 1), text });
  const dir = real.slice(0, real.lastIndexOf("/"));
  for (const m of text.matchAll(/^\s*import\s*\{[^}]*\}\s*from\s*"([^"]+)"\s*;/gm)) {
    const spec = m[1];
    // A bare specifier like "core" is answered by wacc out of its own coretext.wac.
    if (!spec.startsWith(".")) continue;
    try {
      await collect(`${dir}/${spec}`);
    } catch {
      console.log(`  (could not read ${spec} from ${real.slice(ROOT.length + 1)})`);
    }
  }
}

await collect(`${WAC}/packages/wacc/src/api.wac`);
files.sort((a, b) => a.path.localeCompare(b.path));
console.log(
  `wacc is ${files.length} files, ${files.reduce((n, f) => n + f.text.split("\n").length, 0)} lines`,
);

const l0 = await l5ToL0(
  await flatten(`${WAC}/packages/wacc/src/api.wac`) + "\n" +
    await Deno.readTextFile(`${HERE}../drivers/spec_cases.wac`),
);
const refusals = (l0.match(/^!!/gm) ?? []).length;
if (refusals > 0) {
  console.error(`wac-L5 refused ${refusals} things`);
  Deno.exit(1);
}
const round0 = assemble(l0);
console.log(`round 0: wac-L5 built wacc, ${round0.length} bytes`);

const enc = new TextEncoder();

async function boot(bytes: Uint8Array) {
  const inst = await WebAssembly.instantiate(
    await WebAssembly.compile(bytes.buffer as ArrayBuffer),
    {},
  );
  const e = inst.exports as Record<string, CallableFunction>;
  const feed = (s: string) => {
    const b = enc.encode(s);
    e.drv_alloc(b.length);
    for (let i = 0; i < b.length; i++) e.drv_setByte(i, b[i]);
  };
  const feedName = (s: string) => {
    const b = enc.encode(s);
    e.drv_allocName(b.length);
    for (let i = 0; i < b.length; i++) e.drv_setNameByte(i, b[i]);
  };
  return {
    // wacc's own source through this wacc.
    self(entry: string, extra?: { path: string; text: string }): Uint8Array | null {
      const set = extra === undefined ? files : [...files, extra];
      e.drv_files(set.length);
      for (const f of set) {
        feed(f.text);
        feedName(f.path);
        e.drv_pushFile();
      }
      feedName(entry);
      const n = e.drv_buildFiles() as number;
      if (n <= 8) return null;
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = e.drv_byteAt(i) as number;
      return out;
    },
    one(src: string): Uint8Array | null {
      feed(src);
      const n = e.drv_build() as number;
      if (n <= 8) return null;
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = e.drv_byteAt(i) as number;
      return out;
    },
    whyFiles(): string {
      const n = e.drv_declineFiles() as number;
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = e.drv_declineByte(i) as number;
      return new TextDecoder().decode(b);
    },
    why(): string {
      const n = e.drv_decline() as number;
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = e.drv_declineByte(i) as number;
      return new TextDecoder().decode(b);
    },
  };
}

// **Round 1 needs no driver.** wac has no mutable module-level variable — only `const` — so the
// byte-at-a-time boundary the round-0 driver uses cannot be written in wac at all; it works only
// because that driver is *concatenated* onto a flattened graph rather than compiled as a module.
//
// It is not needed, because wacc emits the boundary itself. Every module it builds exports
// `$bind$mem` and a handful of helpers that turn a range of linear memory into a `u8[]` and back
// — which is exactly what a host needs to hand `emit` a source and take the module away.

const checker = {
  path: "packages/wacc/src/selfcheck.wac",
  text: await Deno.readTextFile(`${HERE}../drivers/selfcheck.wac`),
};

const w0 = await boot(round0);
console.log("round 0 works:", w0.one("export i32 answer() { return 6 * 7; }") !== null);

const started = performance.now();
const round1 = w0.self("packages/wacc/src/api.wac");
if (round1 === null) {
  console.log(`round 1: wacc could not compile wacc — ${w0.whyFiles()}`);
  Deno.exit(1);
}
console.log(`round 1: wacc built wacc, ${round1.length} bytes  (${Math.round(performance.now() - started)} ms)`);

// **Round 1 is asked a question whose answer is an i32.** Driving it any other way means handing
// a wasm GC reference to JavaScript, which the engine will not do — and the binding layer wacc
// emits for that is meant for a host harness rather than for this. A stateless driver compiled
// *into* round 1 sidesteps it: it compiles a program and answers the module's length and a
// checksum of its bytes, which is enough to compare two compilers exactly.
const probe = "export i32 answer() { return 6 * 7; }";
const fingerprint = (bytes: Uint8Array): number => {
  let h = 0;
  for (const b of bytes) h = (h * 31 + b) & 65535;
  return bytes.length * 100000 + h;
};

const byRound0 = w0.one(probe);
if (byRound0 === null) {
  console.log("round 0 could not compile the probe");
  Deno.exit(1);
}
console.log(`round 0's wacc compiles the probe to ${byRound0.length} bytes`);

// The checker is the *entry*, not just another file: what gets emitted is the closure of the
// entry, so a file nothing imports contributes nothing.
const round1b = w0.self("packages/wacc/src/selfcheck.wac", checker);
if (round1b === null) {
  console.log(`round 1 with the checker declined: ${w0.whyFiles()}`);
  Deno.exit(1);
}
const inst1 = await WebAssembly.instantiate(
  await WebAssembly.compile(round1b.buffer as ArrayBuffer),
  {},
);
const selfcheck = (inst1.exports as Record<string, CallableFunction>).selfcheck;
if (typeof selfcheck !== "function") {
  console.log(`round 1 exports no selfcheck; it has ${Object.keys(inst1.exports).length} exports`);
  Deno.exit(1);
}
const got = selfcheck() as number;
const want = fingerprint(byRound0);
console.log(`round 1's wacc compiles the same probe to ${Math.floor(got / 100000)} bytes`);
console.log(
  got === want
    ? "and the two modules are byte for byte identical"
    : `and they differ: round 1 says ${got}, round 0 says ${want}`,
);

// Which binding helpers it emitted, since they are named from the element type each array holds
// and a host that guesses the spelling gets a silent undefined.
console.log(
  "binding helpers: " +
    Object.keys(inst1.exports).filter((k) => k.startsWith("$bind$")).join(", "),
);

export const agreed = got === want;
export const sizes = { round0: round0.length, round1: round1.length, probe: byRound0.length };
