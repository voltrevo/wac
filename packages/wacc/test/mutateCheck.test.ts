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
  let duplicated = 0;
  const dupExamples: string[] = [];
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
    // **Two diagnostics at one position is one fault reported twice**, whatever the two codes are.
    // `report` already refuses a repeat of the same code at a position, and this file's neighbour says
    // why that reasoning covers two different codes as well. Counted here rather than asserted until
    // the number is known: `issues/lang/0237a` was one such pair, found by hand.
    if (new Set(mine).size !== mine.length) {
      duplicated++;
      if (dupExamples.length < 4) {
        dupExamples.push(`${mine.join(" ")} in:\n    ` + mutated.replace(/\n/g, " ⏎ ").slice(0, 300));
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

  if (duplicated > 0) {
    console.log(`    ${duplicated} program(s) reported two diagnostics at one position:`);
    for (const d of dupExamples) console.log(`      ${d}`);
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
