// The other half of `checkSweep.test.ts`: **break a valid program and see whether we notice.**
//
// That file asks whether this checker invents diagnostics on programs the reference accepts, which
// is the invariant. This one asks the opposite question — recall — and it asks it over the same four
// thousand programs, which is what makes it sharper than the generated sweep next door: `generate.ts`
// builds a cross product of type against context, so its recall is a fact about the shapes its author
// enumerated. A *mutation* takes whatever the emitter's corpus happens to contain — generics,
// subtyping, method references, enums, casts — breaks it one way, and asks the reference whether that
// broke it. What comes back is a list of the language's rules, weighted by how often real programs
// depend on them, which no hand-written list is.
//
// Two things are asserted, and recall is not one of them:
//
//   - **No contradiction.** Every position we report on a rejected program is one the reference
//     reports. A subset checker may say less; it may not point somewhere else.
//   - **The harness is asking.** A canary that must be caught, so a run that compares nothing cannot
//     report agreement.
//
// Recall is printed, per diagnostic, most-missed first. It is a queue rather than a threshold: a
// number that must never fall makes every refactor a negotiation, and this package has traded recall
// for the no-false-alarm invariant on purpose before.
//
// **"Missed" means the reference reported and we did not, which is two different things.** One is a gap
// of ours. The other is the reference being wrong, and the `undefined type '…'` row is the second kind:
// it is `issues/lang/0151`, whose whole subject is that the reference refuses an identity test the spec
// allows — `g() is A` where `A` is a `const u64[]` in scope, covered by
// `§wac-is-undefined-type-6qbn3wr`. That issue is filed as *not worth fixing* and says in its own title
// that a sweep row cannot be closed because of it. This is the row.
//
// Worth knowing before working the queue, because nothing in the output distinguishes the two and the
// obvious reading of a miss is that we owe a diagnostic. The check is to run the program: if wacc
// compiles it and the answer is what the spec says, the row is theirs — for this one it does, the same
// array *is* `A` and a different one with equal contents is not.
//
// The rest of the table is ours. `'…' of type '…' is not callable` is `issues/lang/0241a`. `integer
// literal out of range` is
//
//     export u64 f() { return 18446744073709551615.nofield; }
//
// and it is a **member access on a literal**, so there is no expected type and `reportLiteral` — the
// rule that would range-check it — is never asked. Still missed, and the emitter is what refuses the
// program, naming the function: *member of an unknown type*. Reading this row is what found a
// different silence in the same rule, where there *is* an expected type: `i32 b =
// 18446744073709551615;` drew nothing, built, and returned -1, fixed 2026-08-25. So a row can be
// worth working even when the row itself does not move.

import { wacCompile } from "wac/wacCompile.ts";
import { wacBind } from "../../../harness/wacBind.ts";
import { generateEmit } from "./generateEmit.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const dumpTypeErrors = mod.dumpTypeErrors as (src: Uint8Array) => Int32Array;
const enc = new TextEncoder();

type Diag = { line: number; col: number; message: string };

/**
 * Everything the reference refuses the program for, **whichever phase said so** — or null when its
 * parser would not read it, which is rung 2's oracle rather than this one's.
 *
 * Reading only `wacTypeCheck` is the shape the sweep next door uses, and it is narrower than it
 * looks: `struct S { i32 x; i32 x; }` and `enum K { A(i32 x, i32 x) }` are both refused by the
 * reference in the **resolve** phase, and this checker reports both. Comparing against the type
 * phase alone therefore counted two of its correct diagnostics as positions the reference never
 * mentions — the harness disagreeing with itself, not the checker disagreeing with the reference.
 */
function reference(src: string): Diag[] | null {
  const r = wacCompile(new Map([["/main.wac", src]]), "/main.wac");
  if (r.ok) return [];
  const diags = r.diagnostics as { line: number; col: number; message: string; phase?: string; severity?: string }[];
  if (diags.some((d) => d.phase === "parse")) return null;
  // **A program that never reached the type checker has no type diagnostics to compare.** When the
  // reference stops at `resolve` — two enums both declaring `Ok`, say — it never forms an opinion
  // about the bodies, and every opinion this checker has about them is one the reference "does not
  // share" only because it was never asked. Same boundary as the parse one above.
  if (diags.length > 0 && diags.every((d) => d.phase === "resolve")) return null;
  return diags.filter((d) => d.severity !== "warning")
    .map((d) => ({ line: d.line, col: d.col, message: d.message }));
}

function ours(src: string): string[] {
  const out = dumpTypeErrors(enc.encode(src));
  const at: string[] = [];
  for (let i = 0; i < out.length; i += 3) at.push(`${out[i + 1]}:${out[i + 2]}`);
  return at;
}

/** Replace the first match, or answer null when the program has no such site. */
function sub(s: string, re: RegExp, to: string): string | null {
  const out = s.replace(re, to);
  return out === s ? null : out;
}

/**
 * One mutation each, chosen by the program's index so the whole run is reproducible.
 *
 * Each is a *plausible* mistake rather than a random edit: the wrong type in a declaration, an
 * argument too few, a name that is not there. A mutation the reference still accepts is discarded —
 * it did not break anything — so the set below is allowed to be optimistic.
 */
const MUTATIONS: [string, (s: string) => string | null][] = [
  ["i32 → string", (s) => sub(s, /\bi32\b/, "string")],
  ["string → i32", (s) => sub(s, /\bstring\b/, "i32")],
  ["bool → i32", (s) => sub(s, /\bbool\b/, "i32")],
  ["f64 → bool", (s) => sub(s, /\bf64\b/, "bool")],
  ["an integer becomes a string", (s) => sub(s, /(?<=[=(,+\- ])\d+(?![\w.])/, '"s"')],
  ["a string becomes an integer", (s) => sub(s, /"[^"]*"/, "1")],
  ["an unwrap goes missing", (s) => sub(s, /!(?=\.)/, "")],
  ["a name that is not there", (s) => sub(s, /(?<=return )[a-z]\w*/, "zzz")],
  ["a method that is not there", (s) => sub(s, /\.len\(\)/, ".nope()")],
  ["an argument too few", (s) => sub(s, /\(([^()]+), ([^(),]+)\)/, "($1)")],
  ["an argument too many", (s) => sub(s, /\(([^()]+)\)(?=[;.])/, "($1, 1)")],
  ["a return loses its value", (s) => sub(s, /return [^;]+;/, "return;")],
  ["a parameter declared twice", (s) => sub(s, /\((i32 \w+)\)/, "($1, $1)")],
  // **A second dozen, because the first was a fact about thirteen mistakes.** Recall over a
  // mutation set is recall over the mutations, and the first set was all about *types* — swap one,
  // drop an argument, rename something. These break the other rules the language has: what may be
  // written to, which cast spelling is which, where a `break` may stand, what a `const` promises.
  ["a const is written to", (s) => sub(s, /\bconst (\w+) (\w+) = ([^;]+);/, "const $1 $2 = $3;\n  $2 = $3;")],
  ["a lossless cast becomes lossy", (s) => sub(s, /\bas!\s/, "as ")],
  ["a checked cast becomes plain", (s) => sub(s, /\bas~\s/, "as ")],
  ["a plain cast becomes raw", (s) => sub(s, / as (?=[iuf]\d)/, " as@ ")],
  ["a break with nothing to leave", (s) => sub(s, /return ([^;]+);/, "break;\n  return $1;")],
  ["a continue with nothing to repeat", (s) => sub(s, /return ([^;]+);/, "continue;\n  return $1;")],
  ["a condition that is not a bool", (s) => sub(s, /\bif \(([^()]+)\)/, "if (1)")],
  ["a while that is not a bool", (s) => sub(s, /\bwhile \(([^()]+)\)/, 'while ("s")')],
  ["an index that is not an integer", (s) => sub(s, /\[(\w+)\](?!\()/, '["s"]')],
  ["something that is not an array, indexed", (s) => sub(s, /(?<=return )(\w+)\.len\(\)/, "$1[0].len()")],
  ["a call to something that is not one", (s) => sub(s, /(?<=return )(\w+);/, "$1();")],
  // The lookbehind keeps this off a decimal point: without it the mutation turns `0.0` into
  // `0.nofield`, which is a real program the reference refuses — but it is a field on a *number*,
  // not the field-on-a-struct this is aiming at, and one mutation should mean one thing.
  ["a field that is not there", (s) => sub(s, /(?<=[A-Za-z_\)\]])\.(\w+)(?= [-+*/]|;)/, ".nofield")],
  ["a field on a number", (s) => sub(s, /(?<=return )(\d+)\b(?![.\w])/, "$1.nofield")],
  ["a struct built with a name it has not", (s) => sub(s, /\{ (\w+): /, "{ nofield: ")],
  ["an override with nothing to override", (s) => sub(s, /\b(i32|f64|string|bool|void) (\w+)\(const this\)/, "override $1 $2(const this)")],
];

/** Message text with the names taken out, so two of the same rule group together. */
function family(m: string): string {
  return m.replace(/'[^']*'/g, "'…'").replace(/\b\d+\b/g, "N").replace(/"[^"]*"/g, '"…"');
}

/**
 * `family`, with primitive type names collapsed as well — for grouping *shapes* rather than messages.
 *
 * **A key too fine is a cap by another route.** Grouping the louder cases on `family` alone put the
 * fifteen in fifteen families, because `type mismatch in '…': i32 and u32` keeps its two type names
 * where the quoted parts and the numbers are already collapsed. Fifteen rows of one member each reads
 * as fifteen things to investigate; it is one shape — a mismatched comparison returned from a
 * non-`bool` function — with fourteen siblings differing only in which pair of types was mismatched.
 *
 * Left out of `family` itself deliberately: that keys the recall table, where collapsing types would
 * merge rows a reader may want apart, and one report changing shape at a time is easier to trust.
 */
function shape(m: string): string {
  return family(m).replace(/\b(?:[iu](?:8|16|32|64)|f32|f64|bool|string|anyref)\b/g, "T");
}

Deno.test("rung 3: valid programs broken one way each — no contradiction", () => {
  const cells = generateEmit();
  if (cells.length < 4000) throw new Error(`only ${cells.length} cells generated`);

  const canary = "export i32 f() { return \"x\"; }";
  if ((reference(canary) ?? []).length === 0 || ours(canary).length === 0) {
    throw new Error("the canary is no longer rejected by both — this sweep is blind");
  }

  const cat = new Map<string, { seen: number; caught: number }>();
  const contradictions: string[] = [];
  let contradicted = 0;
  let louder = 0;
  // **Grouped, because a cap is not a sample.** This kept the first four and printed them, and all
  // four were the same shape — a mismatched comparison returned from a non-`bool` function — so
  // "15 programs" read as fifteen things to look at when it was one family and eleven of its
  // siblings. Keyed on the *reference's* first message, which is the fault both compilers agree is
  // there. `issues/lang/0238a` is the queue this feeds.
  const louderBy = new Map<string, { n: number; example: string }>();
  let broken = 0;
  let caught = 0;
  for (let i = 0; i < cells.length; i++) {
    const [, mutate] = MUTATIONS[i % MUTATIONS.length];
    const mutated = mutate(cells[i].src);
    if (mutated === null) continue;
    let theirs: Diag[] | null;
    try {
      theirs = reference(mutated);
    } catch {
      continue;
    }
    // Unchanged meaning, or a program the parser will not read: neither is a rejection to recall.
    if (theirs === null || theirs.length === 0) continue;
    broken++;

    const mine = ours(mutated);
    // **Saying more than the reference is a disagreement too, and nothing else here measures it.**
    // Every other assertion in this file is about saying *less*: the contradiction check is a subset
    // relation, and recall counts what we miss. `issues/lang/0237a` was the other direction — two
    // diagnostics where the reference gives one, for one fault — and it was found by hand.
    //
    // **A queue, not a verdict, and the sorting is by hand.** Some hits are ours: `~s` in an `i32`
    // function draws the operand rule *and* a slot rule that compares a type this checker invented for
    // an expression it had just refused. Others are the reference stopping early —
    // `i32 x; u32 y; return x != y;` in an `i32` function has two independent faults, and its
    // `checkBinaryOp` answers null for the comparison so it never reaches the second. Counting cannot
    // tell those apart; `issues/lang/0238a` says what distinguishes them.
    //
    // **Counted, not asserted, and it is a count rather than a position test.** An earlier version of
    // this looked for two of our diagnostics sharing a position, on the theory that one fault cannot
    // be at one place twice. That measures co-location, not duplication: `return x as i32` in a
    // `string` function is a redundant cast *and* a return-type mismatch, two independent faults at
    // one position, and the reference reports both there too. All 24 hits were of that kind.
    if (mine.length > theirs.length) {
      louder++;
      const lk = shape(theirs[0].message);
      const seen = louderBy.get(lk);
      if (seen === undefined) {
        louderBy.set(lk, {
          n: 1,
          example: `${mine.length} ours vs ${theirs.length} theirs: ` +
            mutated.replace(/\n/g, " ⏎ ").slice(0, 200),
        });
      } else {
        seen.n++;
      }
    }
    const key = family(theirs[0].message);
    const e = cat.get(key) ?? { seen: 0, caught: 0 };
    e.seen++;
    if (mine.length > 0) {
      e.caught++;
      caught++;
    }
    cat.set(key, e);

    const theirPos = new Set(theirs.map((d) => `${d.line}:${d.col}`));
    for (const p of mine) {
      if (theirPos.has(p)) continue;
      contradicted++;
      if (contradictions.length < 6) {
        contradictions.push(`${p} is ours alone (they say ${[...theirPos].join(", ")}) in:\n    ` +
          mutated.replace(/\n/g, " ⏎ ").slice(0, 400));
      }
    }
  }

  if (louder > 0) {
    console.log(`    ${louder} program(s) where we report more diagnostics than the reference, ` +
      `in ${louderBy.size} ${louderBy.size === 1 ? "family" : "families"}:`);
    for (const [k, v] of [...louderBy].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`      ${String(v.n).padStart(3)}×  ${k.slice(0, 70)}`);
      console.log(`           ${v.example}`);
    }
  }
  const missing = [...cat].sort((a, b) => (b[1].seen - b[1].caught) - (a[1].seen - a[1].caught))
    .filter(([, v]) => v.seen > v.caught);
  const worst = missing.slice(0, 6);
  console.log(`    rung 3 mutation sweep: ${broken} broken programs, ${caught} reported ` +
    `(${Math.round((caught / broken) * 100)}%), ${contradicted} contradictions`);
  for (const [k, v] of worst) {
    console.log(`      ${String(v.seen - v.caught).padStart(3)} missed of ${String(v.seen).padStart(3)}  ${k.slice(0, 76)}`);
  }
  // **The rows have to add up to the total, or the queue is shorter than it looks.** Six rows were
  // printed and sixteen diagnostics were missed: eight of them were in the seventh row and below, so
  // the table said "eight to go" beside a number that said sixteen, and a reader picking the next
  // thing to fix could not see half the work. The tail is one line rather than forty rows — this is a
  // queue, and the head of it is what anybody acts on — but the arithmetic now closes.
  const shownMissed = worst.reduce((n, [, v]) => n + (v.seen - v.caught), 0);
  const rest = broken - caught - shownMissed;
  if (missing.length > worst.length || rest !== 0) {
    console.log(
      `      … and ${missing.length - worst.length} more ` +
        `${missing.length - worst.length === 1 ? "category" : "categories"} holding ${rest} ` +
        `${rest === 1 ? "miss" : "misses"} — ` +
        `\`deno run -A --unstable-net packages/wacc/test/missed.ts "<category>"\` prints the programs`,
    );
  }
  // **A floor, for the reason the neighbouring sweeps have one.** Printed, this sat at 94% in
  // `packages/wacc/README.md` while it was 95% — an understatement nobody trips over, and a drop
  // would sit just as quietly. A share rather than a count, because the mutation table and the
  // generated corpus both change; and a share is what it can see, since a program counts as reported
  // when any diagnostic fires. The per-kind misses printed above are what guard individual rules.
  if (broken === 0) throw new Error("nothing was broken — the sweep measured nothing");
  const share = caught / broken;
  if (share < 0.92) {
    throw new Error(
      `recall on the broken generated programs is ${caught}/${broken} ` +
        `(${(share * 100).toFixed(1)}%), and the floor is 92%. The kinds it missed most are above.`,
    );
  }
  if (contradicted > 0) {
    throw new Error(`we report ${contradicted} position(s) the reference does not:\n  ` +
      contradictions.join("\n  "));
  }
});
