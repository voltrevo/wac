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
  let broken = 0;
  let caught = 0;
  for (let i = 0; i < cells.length; i++) {
    // `anyref` and `i31ref` are unmodelled by rung 3 and skipped by name in `checkSweep.test.ts`
    // for the same reason: what this checker says about them is neither right nor wrong, it is
    // absent, and a mutation of a program built on them measures the gap rather than the checker.
    if (/\banyref\b/.test(cells[i].src)) continue;
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

  const worst = [...cat].sort((a, b) => (b[1].seen - b[1].caught) - (a[1].seen - a[1].caught))
    .filter(([, v]) => v.seen > v.caught).slice(0, 6);
  console.log(`    rung 3 mutation sweep: ${broken} broken programs, ${caught} reported ` +
    `(${Math.round((caught / broken) * 100)}%), ${contradicted} contradictions`);
  for (const [k, v] of worst) {
    console.log(`      ${String(v.seen - v.caught).padStart(3)} missed of ${String(v.seen).padStart(3)}  ${k.slice(0, 76)}`);
  }
  if (contradicted > 0) {
    throw new Error(`we report ${contradicted} position(s) the reference does not:\n  ` +
      contradictions.join("\n  "));
  }
});
