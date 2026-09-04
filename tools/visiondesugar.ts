// Rewrite the constructs `vision/GRAMMAR.md` lists into the nearest thing today's parser accepts.
//
// This is the completeness half of `visiongrammar.sh`. That pass reports the *first* place a file
// stops parsing, so it is a lower bound and cannot say whether anything sits behind it. Desugaring
// every known addition and parsing again turns the question round: whatever is still refused is a
// construct nobody has accounted for — one I invented without noticing, which is a class the other
// two passes are blind to.
//
// **Parse only.** An unknown name, a missing return, a type that does not exist — all later stages,
// and all irrelevant here. The rewrites are allowed to produce nonsense as long as it is nonsense
// with today's shape.
//
// Written in TypeScript rather than as `sed` rules for a reason worth recording: the `sed` version
// died on `\{` (an interval expression in BRE) and then on a bracket expression, and because a
// failed `sed` produces an empty file and an empty `.wac` compiles clean, **it reported every file
// as accounted for while not running at all**. A canary — a deliberate `frobnicate 3 with 4;` — is
// what caught it, and `--canary` keeps that check one flag away.

const RULES: [RegExp, string][] = [
  // A re-export, and a named type: both whole lines with no equivalent today.
  [/^\s*export \{[^}]*\} from ".*";$/gm, ""],
  [/^\s*export union<[^>]*> \w+;$/gm, ""],
  [/^\s*export \w+<[^>]*> \w+;$/gm, ""],
  // `schedule <target>;` has no statement form today.
  [/^\s*schedule .*;$/gm, ""],
  // A union in type position, and a default type argument.
  [/\bunion<[^>]*>/g, "i32"],
  [/\s*=\s*union>/g, ">"],
  // The `gen` return form, and `async` as a modifier anywhere.
  [/\bgen<[^>]*>\s+/g, ""],
  [/\basync\s+/g, ""],
  // `defer { … }` is a block with a keyword in front of it.
  [/\bdefer\s*\{/g, "if (true) {"],
  // A loop head over a generator, failing or not. Rewritten before `try` is stripped.
  // Lazy: a greedy `.*\)` runs to the *last* `)` on the line, so a body like
  // `{ if (!p.settled()) { … } }` had its own brace eaten and an extra one left behind.
  [/\b(?:try )?(?:await )?for \([^;\n]*?\bin\b.*?\)(\s*\{)/g, "for (i32 _i = 0; _i < 1; _i++)$1"],
  // Inheriting from a generic instantiation: today's parent is a bare IDENT.
  [/^(\s*(?:export )?struct \w+(?:<[^>]*>)? : )(\w+)<[^{]*>(\s*\{)/gm, "$1$2$3"],
  // `try` in statement and expression position.
  [/\btry\s+/g, ""],
  // `T??` — the parser takes one `?`.
  [/\?\?/g, "?"],
  // A match arm: no `case`, `default` where today writes `else`, a nested pattern, and a binding
  // with no parentheses. The last two are separate constructs — measured: `case Ok(A(v)):` is
  // `expected ')', found '('` and `case A x:` is `expected ':', found 'x'`.
  [/^(\s*)default:/gm, "$1else:"],
  // No rules for a nested pattern or for a binding without parentheses. Both were reported and
  // both were avoidable — `Err(e): { … e.what }` and, for a type test, naming the subject so the
  // arm narrows it. Rewriting either would stop this pass reporting it if somebody wrote it again.
  [/^(\s*)([A-Z]\w*)(\([^)]*\))?:(\s)/gm, "$1case $2$3:$4"],
  // A method declared with no body. The parameter list may itself contain brackets — `fn[void()]`
  // — so this counts to the end of the line rather than to the first `)`.
  // Every one of them takes `this` — they are interface methods — and requiring that is what keeps
  // the rule off an ordinary call statement like `out.pushAll(one);`, which has no space before the
  // name and which an earlier version of this rule turned into `out.pushAll(one) { }`.
  // `this` has to be the whole first parameter. Requiring the delimiter is what keeps this off
  // `return Slice(this.of, this.from + lo, hi - lo);`, which an earlier version turned into a
  // method declaration because it saw `(this`.
  // `[^;\n]` and not `[^;]`: a negated class matches a newline in JS whatever the `s` flag says, so
  // the earlier version ran from a method's opening line into the statement below it and turned
  // `this.reserve();` into `this.reserve() { }`.
  [/^(\s*)([\w<>\[\]?,]+(?: [\w<>\[\]?,]+)* \w+\((?:const )?this(?=[,)])[^;\n]*\));$/gm, "$1$2 { }"],
  // `yield` has no statement form today. `yield x;` keeps the expression so a bad one still shows.
  // Not anchored to the line: `{ yield out.take(); }` is a one-line body, and anchoring missed it.
  [/\byield\s+([^;\n]*);/g, "$1;"],
  [/\byield;/g, ""],
  // No rule for an unnamed variant payload. `Ok(T)` was written in one file out of eight and is
  // not a proposal: a payload's name is its *field accessor* — `case Circle: return s.radius;` —
  // so an unnamed one is unreadable. Desugaring it would make this pass accept the mistake again,
  // which is worse than not having the rule.
];

/** `fn<…>` to `fn[…]`, counting brackets — the payload nests, as in `fn<Ticket<Result<V, E>>()>`. */
function funcrefs(s: string): string {
  let out = "", i = 0;
  while (i < s.length) {
    const at = s.indexOf("fn<", i);
    if (at < 0) return out + s.slice(i);
    out += s.slice(i, at) + "fn[";
    let depth = 1, j = at + 3;
    for (; j < s.length && depth > 0; j++) {
      if (s[j] === "<") depth++;
      else if (s[j] === ">") { depth--; if (depth === 0) break; }
    }
    out += s.slice(at + 3, j) + "]";
    i = j + 1;
  }
  return out;
}

/** `src` with every known addition rewritten, plus the two things the other passes also remove. */
export function desugar(src: string): string {
  // An import may span lines, so this is not `^import .*$`.
  let out = funcrefs(
    src.replace(/^import [^;]*;/gms, "").replaceAll("…", ""),
  );
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out;
}

if (import.meta.main) {
  const arg = Deno.args[0];
  if (arg === "--canary") {
    // The instrument must be able to fail. This is the input it must refuse.
    console.log(desugar("export i32 probe() { frobnicate 3 with 4; }"));
  } else {
    console.log(desugar(await Deno.readTextFile(arg)));
  }
}
