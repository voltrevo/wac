// `namesFiles` against the module it describes.
//
// Its only consumer is somebody holding a wasm error that says *function #N* — the engine names no
// function, so this list is how a number becomes a name. That makes a disagreement worse than
// useless: it is a confident wrong answer, and it sent one investigation to `hexOf` for a fault in
// `openRepo` (`issues/lang/0097`). The cause was that the list was built from an `Env` with no file
// table and no import edges, so it declined a different set of functions than the emitter did.
//
// Asserted through the *export section*, which is the only place a name and an index appear together
// in the module itself. An imported function occupies an index too, and they come first.
// test-lane: heavy — 1046 MB and 51s, 176,210 functions across 364 modules

import { loadCorpus } from "./corpus.ts";
import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const emitFiles = mod.emitFiles as (p: string[], s: string[], e: string) => Uint8Array;
const namesFiles = mod.namesFiles as (p: string[], s: string[], e: string) => string;

/** Every exported function's name and index, read out of the module's export section. */
function exportedFunctions(b: Uint8Array): [string, number][] {
  let p = 8;
  const u32 = () => {
    let r = 0, sh = 0, x = 0;
    do { x = b[p++]; r |= (x & 0x7f) << sh; sh += 7; } while (x & 0x80);
    return r >>> 0;
  };
  const sec = new Map<number, number>();
  while (p < b.length) { const id = b[p++], size = u32(); sec.set(id, p); p += size; }
  const out: [string, number][] = [];
  if (!sec.has(7)) return out;
  p = sec.get(7)!;
  const n = u32();
  for (let i = 0; i < n; i++) {
    const len = u32();
    const name = new TextDecoder().decode(b.subarray(p, p + len));
    p += len;
    const kind = b[p++], idx = u32();
    if (kind === 0) out.push([name, idx]);
  }
  return out;
}

/** How many functions the module imports — they are numbered before anything it defines. */
function importedFunctions(b: Uint8Array): number {
  let p = 8;
  const u32 = () => {
    let r = 0, sh = 0, x = 0;
    do { x = b[p++]; r |= (x & 0x7f) << sh; sh += 7; } while (x & 0x80);
    return r >>> 0;
  };
  const sec = new Map<number, number>();
  while (p < b.length) { const id = b[p++], size = u32(); sec.set(id, p); p += size; }
  if (!sec.has(2)) return 0;
  p = sec.get(2)!;
  const n = u32();
  let funcs = 0;
  for (let i = 0; i < n; i++) {
    const l1 = u32(); p += l1;
    const l2 = u32(); p += l2;
    const kind = b[p++];
    u32();
    if (kind === 0) funcs++;
  }
  return funcs;
}

Deno.test("rung 4: every exported function is where `namesFiles` says it is", async () => {
  const entries = await loadCorpus("packages/wacc/test/names.test.ts");
  const paths = entries.map(([name]) => name);
  const sources = entries.map(([, src]) => src);

  const wrong: string[] = [];
  let checkedFiles = 0;
  let checkedExports = 0;
  for (const [file] of entries) {
    const bytes = Uint8Array.from(emitFiles(paths, sources, file) as unknown as number[]);
    if (bytes.length <= 8 || !WebAssembly.validate(bytes)) continue;
    const names = namesFiles(paths, sources, file).split("\n");
    const nimp = importedFunctions(bytes);
    checkedFiles++;
    for (const [name, idx] of exportedFunctions(bytes)) {
      // The helpers are not source functions and have no line in this list. `$trap$message` is one of
      // them and is exported by *every* module — it hands back the string a `trap "…"` left in a global,
      // `issues/lang/0147` — so it needs naming here rather than a prefix rule that would also swallow a
      // source function somebody calls `$trapdoor`.
      if (name.startsWith("$bind$") || name === "$trap$message") continue;
      checkedExports++;
      const said = names[idx - nimp] ?? "(past the end of the list)";
      if (said !== name) wrong.push(`${file}: ${name} is function #${idx}, the list says ${said}`);
    }
  }

  // The canary: a walk that emitted nothing would agree with everything.
  if (checkedFiles < 100) throw new Error(`only ${checkedFiles} modules were readable — the harness is not reaching the emitter`);
  if (checkedExports < 200) throw new Error(`only ${checkedExports} exports checked — too few to mean anything`);
  console.log(`    rung 4 names: ${checkedExports} exports across ${checkedFiles} modules, all where the list says`);
  if (wrong.length > 0) {
    throw new Error(`${wrong.length} exported function(s) are not where \`namesFiles\` puts them:\n  ` +
      wrong.slice(0, 8).join("\n  "));
  }
});

/** Every function index the `name` custom section names, and what it calls it. */
function nameSection(b: Uint8Array): Map<number, string> {
  const out = new Map<number, string>();
  const secs = WebAssembly.Module.customSections(new WebAssembly.Module(b as BufferSource), "name");
  if (secs.length === 0) return out;
  const s = new Uint8Array(secs[0]);
  let p = 0;
  const u32 = () => {
    let r = 0, sh = 0, x = 0;
    do { x = s[p++]; r |= (x & 0x7f) << sh; sh += 7; } while (x & 0x80);
    return r >>> 0;
  };
  while (p < s.length) {
    const id = s[p++], size = u32(), end = p + size;
    // Subsection 1 is the function names; nothing else writes one today, and a reader that assumed
    // so would misread the first module that gains a local-name subsection.
    if (id === 1) {
      const n = u32();
      for (let i = 0; i < n; i++) {
        const idx = u32(), len = u32();
        out.set(idx, new TextDecoder().decode(s.subarray(p, p + len)));
        p += len;
      }
    }
    p = end;
  }
  return out;
}

/** How many functions a module has at all: the imported ones, then its own. */
function declaredFunctions(b: Uint8Array): number {
  let p = 8;
  const u32 = () => {
    let r = 0, sh = 0, x = 0;
    do { x = b[p++]; r |= (x & 0x7f) << sh; sh += 7; } while (x & 0x80);
    return r >>> 0;
  };
  let own = 0;
  while (p < b.length) {
    const id = b[p++], size = u32(), end = p + size;
    if (id === 3) own = u32();
    p = end;
  }
  return importedFunctions(b) + own;
}

Deno.test("the name section names every function, not most of them", async () => {
  // **The gap this closes was in the last block of the module.** The section named the imports, the
  // program's own functions, the builtins and every exported helper — 303 of `json`'s 335 — and left
  // the callback trampolines, which are the frames a host's own callback runs inside. So the one
  // function a host could put a fault in was the one with no name. `issues/lang/0101`.
  //
  // Written as "every index has a name" rather than as a list of the blocks, because the list is what
  // was wrong: each block was named where it was emitted, and a block added later is named nowhere.
  const entries = await loadCorpus("packages/wacc/test/names.test.ts");
  const paths = entries.map(([name]) => name);
  const sources = entries.map(([, src]) => src);

  const gaps: string[] = [];
  let checkedFiles = 0, checkedFunctions = 0;
  for (const [file] of entries) {
    const bytes = Uint8Array.from(emitFiles(paths, sources, file) as unknown as number[]);
    if (bytes.length <= 8 || !WebAssembly.validate(bytes)) continue;
    const names = nameSection(bytes);
    const total = declaredFunctions(bytes);
    if (total === 0) continue;
    checkedFiles++;
    checkedFunctions += total;
    const missing: number[] = [];
    for (let i = 0; i < total; i++) if (!names.has(i)) missing.push(i);
    if (missing.length > 0) {
      gaps.push(
        `${file}: ${missing.length} of ${total} unnamed — ${missing.slice(0, 6).join(", ")}` +
          `${missing.length > 6 ? " …" : ""} (the one before the first is ` +
          `${names.get(missing[0] - 1) ?? "also unnamed"})`,
      );
    }
  }

  if (checkedFiles < 100) {
    throw new Error(`only ${checkedFiles} modules were readable — the harness is not reaching the emitter`);
  }
  console.log(`    name section: ${checkedFunctions} functions across ${checkedFiles} modules, all named`);
  if (gaps.length > 0) {
    throw new Error(`${gaps.length} module(s) have unnamed functions:\n  ` + gaps.slice(0, 6).join("\n  "));
  }
});
