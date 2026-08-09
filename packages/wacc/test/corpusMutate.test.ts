// Recall on **real code**: break one of the repository's own files and see whether we notice.
//
// `corpusCheck.test.ts` asks the other half of this question — does the checker invent diagnostics
// on the packages — and the answer is no, on all 341 files. This one breaks them. It is the widest
// recall input the package has: 26 mutation kinds against a Tor relay, an SSH server, a shell and a
// compiler, rather than against programs written to be tested.
//
// It found things the generated corpus could not. A method called with the wrong number of arguments
// was seventeen of twenty misses here and had **never once** appeared in four thousand generated
// programs — nobody writes `b.trim(1)` on purpose, and every real codebase has one the moment a
// signature changes. It also found `issues/lang/0087`: a `break` after `while (true)` crashes the
// reference compiler outright, which no synthetic program had written because no generator emits an
// unreachable statement after an infinite loop.
//
// ## What is asserted, and why the contradiction rule is narrower here
//
// A mutated *real* file often has consequences: change one declaration and the reference reports the
// three uses it can see, while this checker — which is given the file alone, with no imports
// resolved — reports a fourth further down that the reference's list stopped short of. Neither side
// is wrong, and calling that a contradiction would be calling the reference's cut-off a rule.
//
// So the assertion is exact where the comparison is exact: on a mutant the reference answers with
// **one** diagnostic, every position we report must be that one. Zero of those, over the whole
// corpus, is a real statement; recall is printed and left as a queue.

import { wacCompile } from "wac/wacCompile.ts";
import { wacBind } from "../../../harness/wacBind.ts";
import { loadCorpus } from "./corpus.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const dumpTypeErrorsFiles = mod.dumpTypeErrorsFiles as
  (paths: string[], sources: string[], entry: string) => Int32Array;
const enc = new TextEncoder();

function sub(s: string, re: RegExp, to: string): string | null {
  const out = s.replace(re, to);
  return out === s ? null : out;
}

/** One mutation per file, chosen by its index, so the run is reproducible. */
const MUTATIONS: [string, (s: string) => string | null][] = [
  ["a declared type changes", (s) => sub(s, /\bi32 (\w+) =/, "string $1 =")],
  ["a name that is not there", (s) => sub(s, /(?<=return )[a-z]\w*;/, "zzz;")],
  ["an argument too many", (s) => sub(s, /(\w+)\(\);/, "$1(1);")],
  ["a field that is not there", (s) => sub(s, /(?<=[A-Za-z_)\]])\.(\w+)(?= [-+*/]|;)/, ".nofield")],
  ["a return loses its value", (s) => sub(s, /return [^;]+;/, "return;")],
  ["a condition that is not a bool", (s) => sub(s, /\bif \(([^()]{1,40})\)/, "if (1)")],
  ["a call to something that is not one", (s) => sub(s, /(?<=return )(\w+);/, "$1();")],
];

Deno.test("rung 3: the repository's own code, broken one way each", async () => {
  const entries = await loadCorpus("packages/wacc/test/corpusEmit.test.ts");
  const all = new Map(entries.map(([name, src]) => [`/${name}`, src]));

  /**
   * The file and what it imports, transitively — the map a compile of it actually needs.
   *
   * Handing the reference all 341 sources costs it a re-read of all 341 per call, and the sweep was
   * two minutes twenty for that reason alone. A closure is five files for most of this corpus, and
   * the answer is identical: what a file imports is what resolves its names.
   */
  function closureOf(entry: string): Map<string, string> {
    const out = new Map<string, string>();
    const queue = [entry];
    while (queue.length > 0) {
      const at = queue.pop()!;
      if (out.has(at)) continue;
      const src = all.get(at);
      if (src === undefined) continue;
      out.set(at, src);
      const dir = at.slice(0, at.lastIndexOf("/"));
      for (const m of src.matchAll(/from\s+"([^"]+)"/g)) {
        const parts = (dir + "/" + m[1]).split("/");
        const norm: string[] = [];
        for (const part of parts) {
          if (part === "." || part === "") continue;
          if (part === "..") norm.pop();
          else norm.push(part);
        }
        queue.push("/" + norm.join("/"));
      }
    }
    return out;
  }

  const cat = new Map<string, { seen: number; caught: number }>();
  const contradictions: string[] = [];
  let broken = 0;
  let caught = 0;
  let crashed = 0;
  for (let i = 0; i < entries.length; i++) {
    const [name, src] = entries[i];
    const [, mutate] = MUTATIONS[i % MUTATIONS.length];
    const mutated = mutate(src);
    if (mutated === null) continue;

    let diags: { line: number; col: number; message: string; phase?: string }[];
    try {
      const r = wacCompile(closureOf(`/${name}`).set(`/${name}`, mutated), `/${name}`);
      if (r.ok) continue;
      diags = r.diagnostics;
    } catch {
      // The reference threw rather than answering — `issues/lang/0087`. Counted, not asserted:
      // this rung compares checkers, and a crash is somebody else's bug rather than a miss.
      crashed++;
      continue;
    }
    if (diags.some((d) => d.phase === "parse")) continue;
    if (diags.every((d) => d.phase === "resolve")) continue;
    broken++;

    const clos = closureOf(`/${name}`);
    const mpaths = [...clos.keys()];
    const msources = mpaths.map((p) => (p === `/${name}` ? mutated : clos.get(p)!));
    const out = dumpTypeErrorsFiles(mpaths, msources, `/${name}`);
    const mine: string[] = [];
    for (let k = 0; k < out.length; k += 3) mine.push(`${out[k + 1]}:${out[k + 2]}`);
    const key = diags[0].message.replace(/'[^']*'/g, "'…'").replace(/\b\d+\b/g, "N");
    const e = cat.get(key) ?? { seen: 0, caught: 0 };
    e.seen++;
    if (mine.length > 0) {
      e.caught++;
      caught++;
    }
    cat.set(key, e);

    if (diags.length !== 1) continue;
    const only = `${diags[0].line}:${diags[0].col}`;
    for (const p of mine) {
      if (p !== only && contradictions.length < 5) {
        contradictions.push(`${name}: we say ${p}, the reference says ${only} — ${diags[0].message}`);
      }
    }
  }

  const worst = [...cat].sort((a, b) => (b[1].seen - b[1].caught) - (a[1].seen - a[1].caught))
    .filter(([, v]) => v.seen > v.caught).slice(0, 4);
  console.log(`    rung 3 on the repository, broken: ${broken} files, ${caught} reported ` +
    `(${Math.round((caught / broken) * 100)}%), ${crashed} crashed the reference (0087)`);
  for (const [k, v] of worst) {
    console.log(`      ${String(v.seen - v.caught).padStart(3)} missed of ${String(v.seen).padStart(3)}  ${k.slice(0, 70)}`);
  }
  if (contradictions.length > 0) {
    throw new Error(`on a mutant the reference answers with one diagnostic, we point elsewhere:\n  ` +
      contradictions.join("\n  "));
  }
});
