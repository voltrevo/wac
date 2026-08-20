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
// **It reads 223/223 as of 2026-08-15, and what is asserted is a floor rather than the count.**
// Which mutation a file gets is its index modulo the table, so adding one file to the corpus
// reshuffles every mutation after it: an assertion on 223 would fail on an unrelated commit and teach
// people to edit the number. A *share* survives that — the corpus can grow and the ratio holds — and
// it catches the thing the count was meant to catch, which is recall falling out from under a change
// nobody connected to it.
//
// The floor is a few points under, like `waccx.test.ts`'s three, so ordinary movement does not fail
// the suite and a regression does. Raise it when you raise the number.
//
// **What it can and cannot see, measured rather than claimed.** A mutant counts as caught when *any*
// diagnostic fires, so recall is nearly blind to one rule: disabling the missing-method rule
// entirely leaves this at 223/223, because the mutants it catches are caught by something else too.
// What moves it is the checker failing broadly — making `report` a no-op takes it to 0/223, which is
// what the floor catches.
//
// So this guards the front end as a whole and the *named misses* below are what guard individual
// rules: a rule that stops firing shows up there, on a specific file, and not here. Both were
// checked by breaking them.
//
// **Recall is printed, and every miss is named.** It used to print four counts by category and no
// file, which says a queue exists without saying what is in it: working one meant reproducing the
// sweep by hand. The 1-of-1 `struct '…' has no method '…'` turned out to be `sh.jobs.len()` broken
// to `sh.jobs.nope()` in `packages/sh/src/exec.wac`, and it was a whole class — a missing method
// went unreported whenever the receiver was not a plain name — which naming it is what surfaced.

import { wacCompile } from "wac/wacCompile.ts";
import { wacBind } from "../../../harness/wacBind.ts";
import { loadCorpus } from "./corpus.ts";
import { cached, compilerKeyParts, contentKey } from "../../../harness/buildCache.ts";

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
  const entries = await loadCorpus("packages/wacc/test/corpusMutate.test.ts");
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
  /**
   * What the reference said about one mutant — everything this sweep reads from it.
   *
   * A record rather than the diagnostics themselves, because only these fields are used: whether it
   * compiled, whether it threw, the phases (a parse or all-resolve answer is skipped), the first
   * message (the category key and the named miss) and the first position with the count (the
   * contradiction check).
   */
  type RefAnswer =
    | { kind: "ok" }
    | { kind: "threw" }
    | {
      kind: "diags";
      phases: (string | undefined)[];
      message: string;
      line: number;
      col: number;
      count: number;
    };

/**
 * Which mutation a file gets — keyed on its **name**, not its position.
 *
 * It was `MUTATIONS[i % MUTATIONS.length]` over the corpus index, and that made the recall figure
 * below a property of where files happen to sit in a list. Adding one `.wac` file *anywhere* shifted
 * every later file's mutation by one, so the whole assignment re-rolled and the number moved: on
 * 2026-08-20 a new test file in `packages/wacc/test/wac/` took it from 165/169 (97.6%) to 165/171
 * (96.5%) against a 97% floor, with three new misses in `webrtc`, `zstd` and `zstd` again and one
 * gone from `zstd` — **not one of them in the file that was added.**
 *
 * That is the shape `tools/push.sh` calls the line not to cross: a check that fails for something the
 * person pushing did not do. Keyed on the name, adding a file changes that file's mutation and
 * nothing else's, so the figure moves by at most one either way.
 *
 * FNV-1a because it is four lines and needs no import; any stable string hash would do. What matters
 * is that it is a function of the name rather than of the corpus.
 *
 * **`mutateCheck.test.ts` and `missed.ts` keep `i % MUTATIONS.length` and should.** They iterate
 * `generateEmit()`'s cells, whose order is fixed by the generator's own source — nothing outside can
 * insert into it, and if the generator changes then the assignment *should* change. The instability
 * was specific to a corpus that grows from elsewhere in the repository.
 *
 * `issues/system/0212` is this, filed on 2026-08-19 with the hash proposal in it — and hit again
 * on 2026-08-20 and re-diagnosed from scratch, because the failure names the checker rather than
 * the harness and nobody grepped `issues/`.
 */
function mutationFor(name: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < name.length; k++) {
    h ^= name.charCodeAt(k);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % MUTATIONS.length;
}

  /** Every mutant this run will judge, before any of them is compiled. */
  const mutants: { at: number; name: string; mutated: string }[] = [];
  for (let i = 0; i < entries.length; i++) {
    const [name, src] = entries[i];
    const [, mutate] = MUTATIONS[mutationFor(name)];
    const mutated = mutate(src);
    if (mutated !== null) mutants.push({ at: i, name, mutated });
  }

  /**
   * **The reference's half, cached per mutant — it was 12.6s of this test's 13.0s.**
   *
   * Measured 2026-08-19: the reference compiling the mutants is 12.6s of a 13.0s run and our checker
   * judging them 776ms — 451 of them now, where that measurement said 341, because the corpus has grown.
   * The mutants are deterministic — mutation `i % 26` applied to corpus file `i` — so a mutant's answer
   * is a pure function of *its own* sources and `compiler/`.
   *
   * **One file per mutant, keyed on its own closure.** The first version of this cached all 341 answers
   * in one entry keyed on the whole corpus, which meant an edit to any of its 900-odd files recomputed
   * every answer: 16.1s on the gate that pulled somebody's change, 2.4s otherwise, and the gate pulls.
   * Keyed per mutant, an edit invalidates the mutants that actually read the edited file.
   *
   * The name is stable and the key lives *inside* the file rather than in its name, because
   * `buildCache.ts` prunes a cache directory to 120 entries — 341 content-keyed names would evict each
   * other and never hit. A file whose key does not match is recomputed and rewritten, which is the same
   * invalidation with none of the churn.
   *
   * Measured, all four directions: **4.0s warm**, 17.4s when `compiler/` changes and every answer is
   * recomputed, **6.8s after a real edit** to `packages/codec/src/hex.wac` — the mutants that read it —
   * and 4.0s when only an mtime moved, since the key is content. The one-deep file means reverting an
   * edit recomputes rather than finding the older answer, which is a trade for keeping 451 files instead
   * of an unbounded pile.
   *
   * **Ours is not cached and must not be**: it runs on every mutant on every pass. A differential with
   * one remembered side is still a differential; one with two is nothing. And the sweep's own floor is
   * the canary — an empty or wrong set of answers leaves `broken` at zero, which throws "no mutant was
   * measurable" rather than passing quietly.
   */
  const MUTANT_CACHE = ".cache/corpus-mutant";

  async function referenceAnswers(): Promise<RefAnswer[]> {
    const compiler = await compilerKeyParts();
    const answerOf = (name: string, mutated: string): RefAnswer => {
      try {
        const r = wacCompile(closureOf(`/${name}`).set(`/${name}`, mutated), `/${name}`);
        if (r.ok) return { kind: "ok" };
        const d = r.diagnostics;
        return {
          kind: "diags",
          phases: d.map((x) => x.phase),
          message: d[0].message,
          line: d[0].line,
          col: d[0].col,
          count: d.length,
        };
      } catch {
        return { kind: "threw" };
      }
    };
    // No compiler identity means no key that could be trusted, so the answers are computed. The
    // alternative — keying on the sources alone — would serve a stale reference's opinion after a
    // change to `compiler/`, which is the one thing this test is comparing against.
    if (compiler === null) return mutants.map((m) => answerOf(m.name, m.mutated));

    await Deno.mkdir(MUTANT_CACHE, { recursive: true }).catch(() => {});
    const out: RefAnswer[] = [];
    for (const { name, mutated } of mutants) {
      const scope = closureOf(`/${name}`).set(`/${name}`, mutated);
      const key = await contentKey([
        "corpus-mutant 1",
        ...compiler,
        ...[...scope].flatMap(([at, src]) => [at, src]),
      ]);
      const at = `${MUTANT_CACHE}/${name.replaceAll("/", "_")}.json`;
      let answer: RefAnswer | null = null;
      try {
        const held = JSON.parse(await Deno.readTextFile(at)) as { key: string; answer: RefAnswer };
        if (held.key === key) answer = held.answer;
      } catch {
        // Not there, or not readable as ours: recompute.
      }
      if (answer === null) {
        answer = answerOf(name, mutated);
        await Deno.writeTextFile(at, JSON.stringify({ key, answer })).catch(() => {});
      }
      out.push(answer);
    }
    return out;
  }

  const answers = await referenceAnswers();
  // Kept, though the per-mutant cache can no longer produce a short list: this is one answer per
  // mutant by construction now, and the check costs nothing to leave standing for whatever comes next.
  if (answers.length !== mutants.length) {
    throw new Error(
      `the reference answered ${answers.length} of ${mutants.length} mutants, so nothing below was judged`,
    );
  }

  for (let m = 0; m < mutants.length; m++) {
    const { at: i, name, mutated } = mutants[m];
    const answer = answers[m];
    if (answer.kind === "ok") continue;
    if (answer.kind === "threw") {
      // The reference threw rather than answering — `issues/lang/0087`. Counted, not asserted:
      // this rung compares checkers, and a crash is somebody else's bug rather than a miss.
      crashed++;
      continue;
    }
    const diags = [{ line: answer.line, col: answer.col, message: answer.message }];
    const phases = answer.phases;
    if (phases.some((p) => p === "parse")) continue;
    if (phases.length > 0 && phases.every((p) => p === "resolve")) continue;
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
      misses.push(`${name} — ${MUTATIONS[mutationFor(name)][0]} — ${diags[0].message}`);
    }
    cat.set(key, e);

    if (answer.count !== 1) continue;
    const only = `${diags[0].line}:${diags[0].col}`;
    for (const p of mine) {
      if (p !== only && contradictions.length < 5) {
        contradictions.push(`${name}: we say ${p}, the reference says ${only} — ${diags[0].message}`);
      }
    }
  }

  const worst = [...cat].sort((a, b) => (b[1].seen - b[1].caught) - (a[1].seen - a[1].caught))
    .filter(([, v]) => v.seen > v.caught).slice(0, 4);
  // **The fraction, not only the percentage.** 222 of 223 rounds to "100%", which reads as nothing
  // left to do while a named miss is printed two lines below it. The count is the number that cannot
  // round a remaining gap away.
  console.log(`    rung 3 on the repository, broken: ${broken} files, ${caught}/${broken} reported ` +
    `(${((caught / broken) * 100).toFixed(1)}%), ${crashed} crashed the reference (0087)`);
  for (const [k, v] of worst) {
    console.log(`      ${String(v.seen - v.caught).padStart(3)} missed of ${String(v.seen).padStart(3)}  ${k.slice(0, 70)}`);
  }
  for (const m of misses) console.log(`      miss: ${m.slice(0, 110)}`);
  // The ratchet. `broken` is zero only if the sweep found nothing to break, which the line above
  // would already have made obvious; guarded anyway so a division by zero cannot read as a pass.
  const share = broken === 0 ? 0 : caught / broken;
  if (broken === 0) {
    throw new Error("no mutant was measurable — the sweep broke nothing, so recall means nothing");
  }
  if (share < 0.97) {
    throw new Error(
      `recall on the repository's own broken code is ${caught}/${broken} ` +
        `(${(share * 100).toFixed(1)}%), and the floor is 97%. The misses are named above.`,
    );
  }
  if (contradictions.length > 0) {
    throw new Error(`on a mutant the reference answers with one diagnostic, we point elsewhere:\n  ` +
      contradictions.join("\n  "));
  }
});
