// Rung 5, the whole claim: **stage 2 equals stage 3**.
//
// `fixpointEmit.test.ts` puts one source file through both stages. This puts *the compiler* through
// them. Stage A is `wacc` built by the reference; stage B is `wacc` built by stage A; and stage C is
// what stage B produces when it is asked to compile `wacc`. If B and C are the same bytes, the
// compiler reproduces itself, which is what a bootstrap means and what nothing short of running it
// can show.
//
// The awkward part is again the boundary: `emitFiles(string[], string[], string)` cannot be called
// from JavaScript on a module emitted here by hand. It does not have to be — the driver is wac, so
// it builds those arrays itself. Every source in the entry's import closure is embedded in it as
// chunked string literals, and the driver hands them to `emitFiles` from inside the module.
//
// Three things are compared, and the third is the one that ties this to the rest of the suite: the
// bytes stage B produces must equal the bytes the *harness* gets from `emitFiles` directly, which is
// the number `selfEmit.test.ts` and the corpus test are measuring all along.

import { wacCompile } from "wac/wacCompile.ts";
import { loadCorpus } from "./corpus.ts";
import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const emitFiles = mod.emitFiles as (p: string[], s: string[], e: string) => Uint8Array;

const ENTRY = "packages/wacc/src/api.wac";
const DRIVER = "packages/wacc/test/wac/selfhost_generated.wac";

/** The same checksum the driver computes, so the two can be compared at all. */
function checksum(bytes: Uint8Array): number {
  let h = 7;
  for (const b of bytes) h = (Math.imul(h, 31) + b) & 2147483647;
  return h;
}

const escape = (t: string) =>
  '"' + t.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t") +
  '"';

/** Chunked, because one literal is one `array.new_fixed` and an engine caps its element count. */
function chunked(t: string): string {
  const out: string[] = [];
  for (let i = 0; i < t.length; i += 3000) out.push(escape(t.slice(i, i + 3000)));
  return out.join(" +\n    ");
}

/** Resolve an import the way the emitter's linker does — `./x` and `../y/z`, and nothing else. */
function resolve(from: string, rel: string): string {
  const out = from.slice(0, from.lastIndexOf("/")).split("/");
  for (const part of rel.split("/")) {
    if (part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

Deno.test("rung 5: wacc compiled by wacc compiles wacc to the same bytes", async () => {
  const entries = await loadCorpus("packages/wacc/test/selfHostEmit.test.ts");
  const paths = entries.map(([name]) => name);
  const sources = entries.map(([, src]) => src);

  // The import closure of the entry. One of wacc's sources reaches outside its own directory, and a
  // file the driver does not carry is a module that refuses to link rather than one that is wrong.
  const closure: string[] = [];
  const queue = [ENTRY];
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i];
    if (closure.includes(path)) continue;
    closure.push(path);
    const at = paths.indexOf(path);
    if (at < 0) throw new Error(`${path} is not in the corpus`);
    for (const m of sources[at].matchAll(/^import\s*\{[^}]*\}\s*from\s*"([^"]+)"/gm)) {
      queue.push(resolve(path, m[1]));
    }
  }
  if (closure.length < 8) throw new Error(`only ${closure.length} sources in wacc's closure`);

  const bodies = closure.map((p, i) =>
    `string src${i}() { return ${chunked(sources[paths.indexOf(p)])}; }`).join("\n\n");
  const fill = closure.map((p, i) => `  ps[${i}] = ${escape(p)};\n  ss[${i}] = src${i}();`).join("\n");
  const driver = `import { emitFiles, blockedFiles } from "../../src/api.wac";

${bodies}

i32 sumBytes(u8[] b) {
  i32 h = 7;
  for (i32 i = 0; i < b.len(); i++) { h = (h * 31 + b[i]) & 2147483647; }
  return h;
}

u8[] whole() {
  string[] ps = string[${closure.length}]();
  string[] ss = string[${closure.length}]();
${fill}
  return emitFiles(ps, ss, ${escape(ENTRY)});
}

export i32 wholeLen() { return whole().len(); }
export i32 wholeSum() { return sumBytes(whole()); }
export i32 blockedLen() {
  string[] ps = string[${closure.length}]();
  string[] ss = string[${closure.length}]();
${fill}
  return blockedFiles(ps, ss, ${escape(ENTRY)}).len();
}
`;

  // **The driver's own closure, not the whole corpus.** `wacCompile` parses *every* file it is given,
  // not only the ones the entry imports — so handing it the repository meant every corpus file had to
  // be parseable by the reference. A wacc-only feature anywhere in the tree then failed this test with
  // "the reference refuses the generated driver", naming a file the driver never imports.
  //
  // The driver imports `../../src/api.wac` and embeds everything else as string literals, so the
  // closure is exactly what it needs. Narrowing this makes the test *more* precise: what rung 5
  // claims is about wacc compiling wacc, and the rest of the corpus was never part of that claim.
  // `issues/lang/0139`.
  const allPaths = [...closure, DRIVER];
  const allSources = [...closure.map((p) => sources[paths.indexOf(p)]), driver];
  const files = new Map(allPaths.map((p, i) => ["/" + p, allSources[i]]));

  const r = wacCompile(files, "/" + DRIVER);
  if (!r.ok) {
    throw new Error(`the reference refuses the generated driver: ` +
      JSON.stringify(r.diagnostics.slice(0, 2)));
  }
  const A = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(r.compiled.wasm)), {});
  const B = new WebAssembly.Instance(
    new WebAssembly.Module(
      Uint8Array.from(emitFiles(allPaths, allSources, DRIVER) as unknown as number[]),
    ),
    {},
  );

  const ask = (i: WebAssembly.Instance, name: string) => {
    try {
      return (i.exports[name] as () => number)();
    } catch (e) {
      throw new Error(`${name} threw in one of the stages: ${(e as Error).message.slice(0, 80)}`);
    }
  };

  // The canaries, before the comparison. A stage that declined the whole compiler would emit an
  // eight-byte header, and two eight-byte headers agree about nothing at all.
  const blocked = ask(A, "blockedLen");
  if (blocked !== 0) {
    throw new Error(`stage A declines wacc itself (${blocked} characters of reason), so both ` +
      `stages would be compared on an empty module`);
  }
  const lenA = ask(A, "wholeLen");
  if (lenA < 100_000) throw new Error(`stage A emitted only ${lenA} bytes for the whole compiler`);

  const lenB = ask(B, "wholeLen");
  const sumA = ask(A, "wholeSum");
  const sumB = ask(B, "wholeSum");

  // And the third opinion: what the harness gets from `emitFiles` directly is what every other test
  // in this package measures, and stage B's answer has to be that same module.
  const direct = Uint8Array.from(emitFiles(paths, sources, ENTRY) as unknown as number[]);
  console.log(`    rung 5 self-host: ${closure.length} sources, ${lenA} bytes, checksum ${sumA}`);

  const differ: string[] = [];
  if (lenA !== lenB) differ.push(`length: stage A=${lenA}, stage B=${lenB}`);
  if (sumA !== sumB) differ.push(`checksum: stage A=${sumA}, stage B=${sumB}`);
  if (direct.length !== lenB) differ.push(`the harness emits ${direct.length} bytes, stage B ${lenB}`);
  if (checksum(direct) !== sumB) {
    differ.push(`the harness's checksum is ${checksum(direct)}, stage B's ${sumB}`);
  }
  if (differ.length !== 0) {
    throw new Error(`wacc compiled by wacc does not reproduce wacc:\n  ` + differ.join("\n  "));
  }
});
