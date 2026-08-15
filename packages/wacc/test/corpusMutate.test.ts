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
// three uses it can see, while this checker reports a fourth further down that the reference's list
// stopped short of. Neither side is wrong, and calling that a contradiction would be calling the
// reference's cut-off a rule.
//
// (This paragraph used to say the checker was "given the file alone, with no imports resolved". It
// is not, and has not been since it moved to `dumpTypeErrorsFiles` over the entry's closure — the
// comment outlived the code it described, and reading it cost a wrong first guess about why a
// cross-module bug had survived this sweep.)
//
// So the assertion is exact where the comparison is exact: on a mutant the reference answers with
// **one** diagnostic, every position we report must be that one. Zero of those, over the whole
// corpus, is a real statement.
//
// **Recall is printed, and every miss is named.** It used to print four counts by category and no
// file, which says a queue exists without saying what is in it: working one meant reproducing the
// sweep by hand. The 1-of-1 `struct '…' has no method '…'` turned out to be `sh.jobs.len()` broken
// to `sh.jobs.nope()` in `packages/sh/src/exec.wac`, and it was a whole class — a missing method
// went unreported whenever the receiver was not a plain name — which naming it is what surfaced.

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
  // **A second dozen, for the same reason the generated set has one.** Seven kinds of breakage is
  // seven facts about this checker, and the widening that took the generated set from thirteen to
  // twenty-six found two categories it had missed entirely. These break what real code has that
  // generated programs do not: methods, `const`, casts between named types, enums with variants,
  // loops that go somewhere.
  ["a string becomes an integer", (s) => sub(s, /"[^"\\]{2,}"/, "1")],
  ["an integer becomes a string", (s) => sub(s, /(?<=[=(,] )\d+(?![\w.])/, '"s"')],
  ["bool becomes i32", (s) => sub(s, /\bbool (\w+) =/, "i32 $1 =")],
  ["an unwrap goes missing", (s) => sub(s, /!(?=\.)/, "")],
  ["a method that is not there", (s) => sub(s, /\.len\(\)/, ".nope()")],
  ["an argument too few", (s) => sub(s, /\(([^()]+), ([^(),]+)\);/, "($1);")],
  ["a lossless cast becomes plain", (s) => sub(s, /\bas!\s/, "as ")],
  ["a truncating cast becomes plain", (s) => sub(s, /\bas~\s/, "as ")],
  ["a break with nothing to leave", (s) => sub(s, /^(\s*)return ([^;]+);/m, "$1break;\n$1return $2;")],
  ["a continue with nothing to repeat", (s) => sub(s, /^(\s*)return ([^;]+);/m, "$1continue;\n$1return $2;")],
  ["a while that is not a bool", (s) => sub(s, /\bwhile \(([^()]{1,30})\)/, 'while ("s")')],
  ["an index that is not an integer", (s) => sub(s, /\[(\w+)\](?!\()/, '["s"]')],
  ["a variant that is not there", (s) => sub(s, /(?<=case )(\w+)(?=[(:])/, "Nope")],
  ["a parameter declared twice", (s) => sub(s, /\((i32 \w+)\)/, "($1, $1)")],
  ["a const is written to", (s) => sub(s, /\bconst (\w+) (\w+) = ([^;]+);/, "const $1 $2 = $3;\n$2 = $3;")],
  ["a field on a number", (s) => sub(s, /(?<=return )(\d+);/, "$1.nofield;")],
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
  /** The mutants nothing was reported on, by name — the queue this instrument exists to produce. */
  const misses: string[] = [];
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
    } else if (misses.length < 8) {
      // **Named, because a count is not a queue.** This printed four misses by category and no file,
      // so working one meant reproducing the sweep by hand to find out which mutant it was. The
      // 1-of-1 `struct '…' has no method '…'` was `sh.jobs.len()` broken to `sh.jobs.nope()` in
      // `packages/sh/src/exec.wac`, and naming it is what turned it into a fix.
      misses.push(`${name} — ${MUTATIONS[i % MUTATIONS.length][0]} — ${diags[0].message}`);
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
  for (const m of misses) console.log(`      miss: ${m.slice(0, 110)}`);
  if (contradictions.length > 0) {
    throw new Error(`on a mutant the reference answers with one diagnostic, we point elsewhere:\n  ` +
      contradictions.join("\n  "));
  }
});
