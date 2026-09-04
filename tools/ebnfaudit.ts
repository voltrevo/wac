// Read `spec/spec/grammar.md` as a grammar rather than as prose, and say what is wrong with it.
//
//     deno run --allow-read tools/ebnfaudit.ts
//
// Every instrument pointed at that file so far compares it with the parser one construct at a time:
// `speckeywords_test.wac` checks the keyword fence, `specproductions_test.wac` checks a list of
// samples somebody has already been wrong about. Both are lists. **Neither reads the EBNF as EBNF**,
// so a rule that refers to something that does not exist, or that cannot terminate, or that nothing
// can reach, is invisible to all of it.
//
// This is the first pass that parses the notation. It is a static audit and checks nothing against
// the compiler; that is deliberate, because everything it reports is wrong *on the page* and needs
// no second opinion.
//
// ## Why bother, given the file is for humans
//
// Because the operator has floated writing a parser for the vision syntax, and the cheapest honest
// route to one is to generate it from the spec's own grammar plus a small delta — which would make
// the vision additions a readable patch instead of a prose list, and would check the spec against
// every `.wac` in the tree as a side effect. That only works if the notation is machine-readable.
// **This says how far off it is**, before anything is built on the assumption that it is close.
//
// ## What it checks
//
//   undefined     a rule refers to a name nothing defines
//   unreachable   a rule nothing refers to, and that is not `program`
//   left-recursive  a rule that can begin with itself — a generated recursive-descent parser
//                 loops forever on one, and the fix is mechanical when the recursion is a suffix
//   nullable-rep  `{ x }` where `x` can match nothing — an infinite loop for any parser
//   dup           two rules with the same name
//
// It reports and exits 0 regardless. This is not a gate: the findings are about a document that is
// written for people, and some of them are going to be judgement calls about whether the notation
// or the reader should give way.
//
// ## What the first run found, 2026-09-04
//
// **One rule name referred to and defined nowhere: `type_name`.** `construction_expr` is
// `type_name , "(" , [ arg_list ] , ")"` and nothing said what a `type_name` was. Now defined as
// `IDENT , [ type_args ]`, measured — `B<i32>(3)` and `B<i32>{v: 3}` both parse, and `B(3).v` with
// no expected type does not, so the written arguments are load-bearing rather than a convenience.
//
// Nothing else. No duplicate names, and every rule reachable from `program` — which is a stronger
// result about the file than anything previously known, and is why the two categories below are
// worth reading as notation rather than as bugs.
//
// **Three rules can begin with themselves**: `type`, `element_type` and `array_type`, all through
// the same suffix form — `type = … | type , "?"`. That is good human EBNF and a mechanical fix for
// a generator (`base , { "?" }`), so it belongs in the generator rather than in the spec. Left
// recursion is only a problem for a reader that descends, and the file is not written for one.
//
// **`STRING`'s repetition can match nothing**, because `string_char = (* any character except " and
// \ *) | string_escape` states its first alternative as prose, which a reader has to treat as empty.
// The lexical block is prose-with-notation throughout and always was; a generator takes its
// terminals from a hand-written lexer, which is the honest arrangement and not a gap.
//
// ## And a fourth thing it did not check, which the fix turned up
//
// Reading `type_name` into place meant reading every mention of type arguments, and three comments
// each claimed a *different* one of them was the only place type arguments appear: `type_args` said
// *"only ever in type position"*, `primary_expr` said a call was *"the one place they appear"*, and
// `array_construction` said it was *"the one place type arguments appear in something that reads as
// an expression"*. There are four places, all measured, and they are now listed once at `type_args`.
//
// Nothing here catches that and neither does `specproductions_test.wac`, which checks tokens in
// productions. **Three comments claiming uniqueness for three different sites is a shape worth
// knowing about and there is no instrument for it.**

import { GRAMMAR, readGrammar, type Rule, type Term } from "./ebnf.ts";

function refsOf(t: Term, into: Set<string>): void {
  switch (t.kind) {
    case "ref": into.add(t.name); return;
    case "opt": case "rep": refsOf(t.of, into); return;
    case "seq": case "alt": for (const x of t.of) refsOf(x, into); return;
    default: return;
  }
}

/** Names a term can begin with, following only the leftmost position through optionals. */
function firstRefs(t: Term, rules: Map<string, Rule>, seen: Set<string>): Set<string> {
  const out = new Set<string>();
  const walk = (x: Term): boolean => {   // answers: can this match nothing?
    switch (x.kind) {
      case "ref": {
        out.add(x.name);
        const r = rules.get(x.name);
        if (!r || seen.has(x.name)) return false;
        seen.add(x.name);
        for (const n of firstRefs(r.body, rules, seen)) out.add(n);
        return nullable(r.body, rules, new Set());
      }
      case "opt": walk(x.of); return true;
      case "rep": walk(x.of); return true;
      case "alt": { let any = false; for (const y of x.of) if (walk(y)) any = true; return any; }
      case "seq": {
        for (const y of x.of) if (!walk(y)) return false;
        return true;
      }
      default: return false;
    }
  };
  walk(t);
  return out;
}

function nullable(t: Term, rules: Map<string, Rule>, seen: Set<string>): boolean {
  switch (t.kind) {
    case "opt": case "rep": return true;
    case "lit": case "range": return false;
    case "prose": return true;      // a prose alternative is an empty one as far as this can tell
    case "ref": {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      const r = rules.get(t.name);
      return r ? nullable(r.body, rules, seen) : false;
    }
    case "alt": return t.of.some((x) => nullable(x, rules, seen));
    case "seq": return t.of.every((x) => nullable(x, rules, seen));
  }
}

function repsOf(t: Term, into: Term[]): void {
  switch (t.kind) {
    case "rep": into.push(t.of); repsOf(t.of, into); return;
    case "opt": repsOf(t.of, into); return;
    case "seq": case "alt": for (const x of t.of) repsOf(x, into); return;
    default: return;
  }
}

function main(argv: string[]): number {
  // A path, because until 2026-09-04 this audited `spec/spec/grammar.md` and nothing else — it took
  // no argument and silently ignored one. So its very first check, *two rules with one name*, had
  // never been pointed at `vision/GRAMMAR.ebnf`, which had nine of them: 47 entries under 38 names,
  // with the later definition winning and the earlier one dead text carrying the comment that
  // explained it. A check that exists, passes, and has never seen the artefact that needs it.
  const which = argv.find((a) => !a.startsWith("--")) ?? GRAMMAR;
  const { all, rules } = readGrammar(which);
  // Nothing to audit is a failure, not a pass. This printed `0 rules, 0 distinct` and then `none`
  // against every check, which reads exactly like a clean file.
  if (all.length === 0) {
    console.log(`no rules in ${which} — is it a grammar?`);
    return 2;
  }
  const seen = new Set<string>();
  const dup: string[] = [];
  for (const r of all) {
    if (seen.has(r.name)) dup.push(r.name);
    seen.add(r.name);
  }

  console.log(`${all.length} rules, ${rules.size} distinct, from ${which}`);

  const say = (label: string, lines: string[]) => {
    console.log(`\n-- ${label} --`);
    if (lines.length === 0) console.log("  none");
    else for (const l of lines) console.log(`  ${l}`);
  };

  say("two rules with one name", dup.map((n) => `${n}`));

  // Undefined: referred to and never defined. The terminals are named in the lexical block, so a
  // genuinely missing one shows up here rather than being assumed away.
  const undef: string[] = [];
  for (const r of all) {
    const refs = new Set<string>();
    refsOf(r.body, refs);
    for (const n of refs) if (!rules.has(n)) undef.push(`${r.name}:${r.line} → ${n}`);
  }
  say("a rule refers to a name nothing defines", [...new Set(undef)]);

  // Unreachable from `program`.
  const live = new Set<string>();
  const visit = (n: string) => {
    if (live.has(n)) return;
    live.add(n);
    const r = rules.get(n);
    if (!r) return;
    const refs = new Set<string>();
    refsOf(r.body, refs);
    for (const m of refs) visit(m);
  };
  visit("program");
  say("nothing reaches it from `program`", [...rules.keys()].filter((n) => !live.has(n)));

  // Left recursion: a rule that can begin with itself.
  const leftRec: string[] = [];
  for (const r of all) {
    if (firstRefs(r.body, rules, new Set()).has(r.name)) leftRec.push(`${r.name}:${r.line}`);
  }
  say("can begin with itself — a generated parser loops", leftRec);

  // `{ x }` where x matches nothing: an infinite loop whatever reads it.
  const nullRep: string[] = [];
  for (const r of all) {
    const inner: Term[] = [];
    repsOf(r.body, inner);
    for (const x of inner) if (nullable(x, rules, new Set())) nullRep.push(`${r.name}:${r.line}`);
  }
  say("a repetition whose body can match nothing", [...new Set(nullRep)]);

  return 0;
}

Deno.exit(main(Deno.args));
