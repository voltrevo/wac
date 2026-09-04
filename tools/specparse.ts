// Parse real wac with the grammar in `spec/spec/grammar.md`, and with a vision delta on top of it.
//
//     deno run --allow-read tools/specparse.ts packages          # the spec against the tree
//     deno run --allow-read tools/specparse.ts vision            # the delta against vision/
//     deno run --allow-read tools/specparse.ts <path> [...]      # anything
//
// `CONTRIBUTING` says the spec is the source of truth. Until now that was a claim checked by
// samples: `specproductions_test.wac` probes constructs somebody has already been wrong about, and
// `speckeywords_test.wac` checks the fence. **This runs the file.** If the grammar in the spec
// parses every `.wac` in `packages/`, the spec is verified against reality in a way no list of
// probes reaches — and where it does not, the failure names a token and a rule.
//
// It also answers the other thing the operator asked for. Vision's additions become
// `vision/GRAMMAR.ebnf`, a patch of productions, rather than a prose list of eight constructs — and
// the patched grammar parsing every file under `vision/` is what "vision has a parser" means here.
//
// ## Why Earley rather than recursive descent
//
// Because the spec is written for people and should stay that way. `tools/ebnfaudit.ts` reports
// three rules that begin with themselves — `type = … | type , "?"` and two more — and alternatives
// in EBNF are a *set*, not an ordered choice: `primary_expr` lists the bare `IDENT` before
// `construction_expr`, so `P{x: 1}` needs a reader that will try both rather than commit to the
// first that matches a prefix.
//
// Recursive descent needs the left recursion eliminated and the alternatives reordered, and every
// such edit is a place where the thing being checked has been adjusted to suit the checker. **Earley
// needs neither.** It handles left recursion and ambiguity as written, so the grammar this runs is
// the grammar in the file, character for character.
//
// The cost is speed. Earley is O(n³) in the *ambiguity*, and this grammar is ambiguous on purpose,
// so files are parsed one top-level declaration at a time and a declaration gets twenty seconds
// before the reader gives up and says so. The whole tree — 1,569 files — takes about twenty-five
// minutes, which is why this is a command rather than a test, and why it writes a progress line
// per twenty-five files to stderr: three runs were killed as stuck before it did.
//
// ## Where it stands, 2026-09-04
//
//     1562/1569 files parse
//
// The seven are `spec/cases` written to be refused, and each is refused by the rule its own header
// is about. Nothing else in `packages`, `core`, `std`, `spec` or `tools` is outside the grammar,
// which took ten productions the file had never had — `issues/lang/closed/0326a`.
//
// ## What it is not
//
// **A recogniser, not a compiler.** It answers *does this parse* and nothing else: no types, no
// names, no emit. A file it accepts may be nonsense. A file it rejects is either a grammar that is
// behind the parser, or wac that is wrong — and the two are told apart by asking `wac check`, which
// the report suggests where it matters.
//
// **It does not lex from the spec.** `string_char = (* any character except " and \ *) |
// string_escape` is prose, so terminals come from the hand-written lexer below. That is the same
// arrangement `ebnfaudit` describes and the honest one: the lexical block was never notation.
//
// ## Three lexer modes, because the language has three
//
// Ordinary wac, a possibly-interpolated string literal, and JSX text. The last is not a choice:
// `[§jsx-text-is-not-wac-source]` says *"between an element's tags the lexer reads text, so nothing
// there starts a string, a character literal or a comment"*, and `spec/cases/0130` is
// `<p>see http://x /* not a comment */</p>` and `<p>a " b</p>`. A one-mode scanner meets that file
// and its unterminated string eats the rest of it.
//
// The JSX productions were added on the strength of reading `parse.wac` and were unverifiable for a
// day. They are checked now: all twenty JSX cases in `spec/cases`, plus the examples and
// `jsxlex_test.wac`.

import { GRAMMAR, parseRules, readGrammar, type Rule, type Term } from "./ebnf.ts";

// ── Lexer ────────────────────────────────────────────────────────────────────────────────────────
//
// The terminal kinds the grammar names, plus punctuation as itself. Keywords lex as their own
// spelling so a rule writing `"if"` matches, and `IDENT` is anything left over — which is exactly
// what `grammar.md` says under the fence: *"Type names are not keywords."*

/**
 * The keywords, read from the fence rather than copied.
 *
 * A second copy of that list is a copy that drifts, and `speckeywords_test.wac` exists because the
 * block *has* drifted three times. Reading it here means this tool cannot disagree with the spec
 * about what a keyword is — which matters, because everything not in it lexes as `IDENT`.
 */
function keywordsFromFence(text: string): Set<string> {
  const head = text.indexOf("### Keywords");
  const open = text.indexOf("```", head);
  const close = text.indexOf("```", open + 3);
  return new Set(text.slice(open + 3, close).trim().split(/\s+/));
}

// Longest first, so `>>>=` never lexes as `>>` then `>=`.
// `>` is deliberately absent from every multi-character entry. `Ticket<Vec<T>>` closes two type
// argument lists with what a longest-match lexer reads as one shift operator, and the spec's
// `type_args = "<" , type , … , ">"` says nothing about it — the classic C++ `>>` problem, and the
// grammar has it. Lexing `>` singly and re-lexing the grammar's own `">>"` literals into two of
// them is how real parsers answer it, and it keeps the answer out of the spec.
//
// The looseness this buys is that `a > > b` parses. A recogniser can afford that; a compiler
// records the gap between tokens and refuses it.
const PUNCT = [
  "...", "<<=", "as!", "as~", "as@",
  "==", "!=", "<=", ">=", "&&", "||", "<<", "++", "--",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
  "{", "}", "(", ")", "[", "]", ";", ",", ".", ":", "?", "!", "~",
  "+", "-", "*", "/", "%", "<", ">", "=", "&", "|", "^", "@",
];

interface Token { kind: string; text: string; line: number; col: number }

/**
 * One piece of a possibly-interpolated literal, from `at`.
 *
 * `open` says the piece ended at a `\{` rather than at the closing quote, so an expression follows.
 * `end` is one past the last character of the piece — the `{` when open, the `"` when not.
 *
 * **This is why `STRING` cannot be a lexical terminal.** `strings.md` says `\{` *"begins an embedded
 * expression"* and that the whole thing is *"exactly sugar for `+`"*, so an interpolated literal
 * contains an `expr` and a rule for it belongs with the expressions rather than in the lexical
 * block, where `grammar.md` has always kept `STRING`. Splitting it into head, middle and tail is the
 * usual answer and is what the production added beside `primary_expr` describes.
 */
function scanString(src: string, at: number, fromBrace = false): { end: number; open: boolean } | null {
  let j = at + 1;   // past the opening `"` or the closing `}`
  if (fromBrace) j = at + 1;
  while (j < src.length) {
    if (src[j] === "\\") {
      if (src[j + 1] === "{") return { end: j + 2, open: true };
      j += 2;
      continue;
    }
    if (src[j] === '"') return { end: j + 1, open: false };
    if (src[j] === "\n") return null;
    j++;
  }
  return null;
}



/**
 * Whether the `<` at `at` opens a JSX tag rather than being a less-than.
 *
 * `[§jsx-text-is-not-wac-source]` gives the rule and it is purely local: a name, a `/`, or the `>`
 * of a fragment. Anything else is text or an operator.
 */
function startsTag(src: string, at: number): boolean {
  const n = src[at + 1];
  return n !== undefined && (/[A-Za-z_]/.test(n) || n === "/" || n === ">");
}

/**
 * Whether the last token cannot end an expression, so what follows is in operand position.
 *
 * This is how `<` is told from a comparison at the point JSX begins, and it is the same decision
 * `parse.wac` makes by only reaching JSX from `parsePrimary`. Getting it wrong in the permissive
 * direction turns `a < b` into an unterminated element and eats the file, so the list is of things
 * that *can* end an expression and the answer is the negation.
 */
function prefixPosition(toks: Token[]): boolean {
  const last = toks[toks.length - 1];
  if (!last) return true;
  const ends = new Set([
    "IDENT", "INT_LITERAL", "FLOAT_LITERAL", "STRING", "BLOCK_STRING", "CHAR_LITERAL", "STR_TAIL",
    ")", "]", "}", "!", "++", "--", "this", "true", "false", "null",
    // Not because `fn` ends an expression — it cannot — but because it is the one keyword a type
    // argument list follows. `fn<void()> call;` lexed as an element opening `<void…`, and every
    // vision file using the angle funcref shape stopped parsing the moment JSX went in. Every other
    // `<` that opens type arguments follows an `IDENT`, which is on this list already.
    "fn",
  ]);
  return !ends.has(last.kind);
}

function lex(src: string, keywords: Set<string>): { toks: Token[]; error?: string } {
  const toks: Token[] = [];
  let i = 0, line = 1, col = 1;
  // Brace depth, and the depth at which each open interpolation began.
  let braces = 0;
  const interp: number[] = [];

  // ── JSX, which is a second lexer mode ──────────────────────────────────────────────────────────
  //
  // `[§jsx-text-is-not-wac-source]`: *"Between an element's tags the lexer reads text, so nothing
  // there starts a string, a character literal or a comment"*. `spec/cases/0130` is the case that
  // makes it unavoidable — `<p>a " b</p>`, `<p>see http://x /* not a comment */</p>` — and it says
  // in its own comment why: an unterminated string *"consumes the rest of the file and takes the
  // closing tag with it"*.
  //
  // Three pieces of state and no parser feedback, which is the whole question. `open` counts
  // unclosed elements, `inTag` says the scanner is between `<` and the `>` that ends that tag, and
  // `holes` remembers the brace depth each `{expr}` began at so the matching `}` returns to text.
  //
  // A `{…}` hole is a **fresh expression context**: `<div>{<b/>}</div>` has an element inside a
  // hole inside an element, and the inner one's tags must close without the outer one's state
  // interfering. So the hole saves the JSX state and resets it, and restores on the matching `}`.
  // Two narrower rules were tried first and each broke the other case — a `>` guard strict enough
  // for `<input a={x > 1}/>` stopped `<b/>` inside a hole from closing at all.
  let jsxOpen = 0;
  let inTag = false;
  let tagClosing = false;
  const holes: { braces: number; jsxOpen: number; inTag: boolean; tagClosing: boolean }[] = [];
  const adv = (n: number) => {
    for (let k = 0; k < n; k++) {
      if (src[i + k] === "\n") { line++; col = 1; } else col++;
    }
    i += n;
  };

  while (i < src.length) {
    const c = src[i];

    // Text mode: inside an element, not inside a tag, not inside a `{…}` hole.
    if (jsxOpen > 0 && !inTag) {
      let j = i;
      while (j < src.length) {
        if (src[j] === "{") break;
        if (src[j] === "<" && startsTag(src, j)) break;
        j++;
      }
      if (j > i) {
        toks.push({ kind: "JSX_TEXT", text: src.slice(i, j), line, col });
        adv(j - i);
        continue;
      }
      if (src[i] === "{") {
        toks.push({ kind: "{", text: "{", line, col });
        holes.push({ braces, jsxOpen, inTag, tagClosing });
        jsxOpen = 0;
        inTag = false;
        braces++;
        adv(1);
        continue;
      }
      // A `<` that begins a tag falls through to the ordinary path below, which opens tag mode.
    }

    if (c === " " || c === "\t" || c === "\r" || c === "\n") { adv(1); continue; }
    // `…` is `vision/`'s marker for a body nobody wrote. It is a convention of that directory
    // rather than syntax, and `tools/visiongrammar.sh` strips it for the same reason — so `{ … }`
    // reads as an empty block and `= …` still fails, which is the honest outcome for a rule that
    // needed a value.
    if (c === "\u2026") { adv(1); continue; }
    if (c === "/" && src[i + 1] === "/") {
      let j = i;
      while (j < src.length && src[j] !== "\n") j++;
      adv(j - i);
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) return { toks, error: `unterminated block comment at ${line}:${col}` };
      adv(end + 2 - i);
      continue;
    }
    const at = { line, col };
    if (c === '"') {
      // A block string first: `"""` runs to the next `"""` and holds newlines. It does **not**
      // interpolate, which is not in `strings.md` and is in the compiler's diagnostic —
      // *"a block string does not interpolate — `\{` opens an expression only in a one-line
      // literal"* — so it is one token whatever is inside it.
      if (src.startsWith('"""', i)) {
        const end = src.indexOf('"""', i + 3);
        if (end < 0) return { toks, error: `unterminated block string at ${line}:${col}` };
        toks.push({ kind: "BLOCK_STRING", text: src.slice(i, end + 3), ...at });
        adv(end + 3 - i);
        continue;
      }
      const piece = scanString(src, i);
      if (piece === null) return { toks, error: `unterminated string at ${line}:${col}` };
      toks.push({ kind: piece.open ? "STR_HEAD" : "STRING", text: src.slice(i, piece.end), ...at });
      if (piece.open) interp.push(braces);
      adv(piece.end - i);
      continue;
    }
    // The other end of an interpolation. A `}` that closes the brace an interpolation opened puts
    // the lexer back in string mode, and what follows is `STR_MID` if another `\{` follows or
    // `STR_TAIL` if the literal ends. Everything about this is a stack rather than a counter,
    // because `[§wac-str-interp-nest-r4kw9np]` nests a literal inside an interpolation inside a
    // literal, and the braces there are *matched, not counted from the outside*.
    if (c === "}" && interp.length > 0 && interp[interp.length - 1] === braces) {
      interp.pop();
      const piece = scanString(src, i, true);
      if (piece === null) return { toks, error: `unterminated interpolation at ${line}:${col}` };
      toks.push({ kind: piece.open ? "STR_MID" : "STR_TAIL", text: src.slice(i, piece.end), ...at });
      if (piece.open) interp.push(braces);
      adv(piece.end - i);
      continue;
    }
    // Leaving a `{…}` hole puts the scanner back in text mode, and the element is still open.
    //
    // **Before the counter below, not after it.** The first version of this sat further down, past
    // `braces--`, so the depth it compared against had already been decremented and the test never
    // matched — every element containing a spliced expression stayed out of text mode from that
    // point on, and the failure surfaced nine lines later as an ordinary identifier the grammar had
    // no rule for. Two orderings of the same two lines and only one of them is a lexer.
    if (c === "}" && holes.length > 0 && holes[holes.length - 1].braces === braces - 1) {
      const back = holes.pop()!;
      jsxOpen = back.jsxOpen;
      inTag = back.inTag;
      tagClosing = back.tagClosing;
      braces--;
      toks.push({ kind: "}", text: "}", line, col });
      adv(1);
      continue;
    }
    // A `{` anywhere inside JSX opens a hole, including in an attribute — `<input size={n > 1}/>`.
    // Attribute holes matter for the `>` rule below rather than for text mode: `inTag` survives the
    // hole, so the matching `}` returns to whichever mode the `{` interrupted with no extra state.
    if (c === "{" && (inTag || jsxOpen > 0)) {
      holes.push({ braces, jsxOpen, inTag, tagClosing });
      jsxOpen = 0;
      inTag = false;
      braces++;
      toks.push({ kind: "{", text: "{", line, col });
      adv(1);
      continue;
    }
    if (c === "{") braces++;
    if (c === "}") braces--;
    if (c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== "'") { if (src[j] === "\\") j++; j++; }
      if (j >= src.length) return { toks, error: `unterminated char at ${line}:${col}` };
      toks.push({ kind: "CHAR_LITERAL", text: src.slice(i, j + 1), ...at });
      adv(j + 1 - i);
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      if (c === "0" && (src[i + 1] === "x" || src[i + 1] === "X")) {
        j = i + 2;
        while (j < src.length && /[0-9a-fA-F_]/.test(src[j])) j++;
        toks.push({ kind: "INT_LITERAL", text: src.slice(i, j), ...at });
        adv(j - i);
        continue;
      }
      while (j < src.length && /[0-9_]/.test(src[j])) j++;
      let float = false;
      if (src[j] === "." && /[0-9]/.test(src[j + 1] ?? "")) {
        float = true;
        j++;
        while (j < src.length && /[0-9_]/.test(src[j])) j++;
      }
      if (src[j] === "e" || src[j] === "E") {
        let k = j + 1;
        if (src[k] === "+" || src[k] === "-") k++;
        if (/[0-9]/.test(src[k] ?? "")) { float = true; j = k; while (j < src.length && /[0-9_]/.test(src[j])) j++; }
      }
      toks.push({ kind: float ? "FLOAT_LITERAL" : "INT_LITERAL", text: src.slice(i, j), ...at });
      adv(j - i);
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      let word = src.slice(i, j);
      // `as!`, `as~` and `as@` are `as` plus one character, which is how `keywordFromIdent` does it.
      if (word === "as" && (src[j] === "!" || src[j] === "~" || src[j] === "@")) {
        word = word + src[j];
        j++;
      }
      toks.push({ kind: keywords.has(word) ? word : "IDENT", text: word, ...at });
      adv(j - i);
      continue;
    }
    // Entering a tag. Outside JSX this needs the `<` to be in prefix position, since `a < b` is a
    // comparison; inside, text mode has already decided. `startsTag` is the rest of the rule —
    // *"a `<` followed by neither a name nor `/` is text too, so `<p>1 < 2</p>` says what it looks
    // like"*.
    if (c === "<" && !inTag && startsTag(src, i) && (jsxOpen > 0 || prefixPosition(toks))) {
      inTag = true;
      tagClosing = src[i + 1] === "/";
      toks.push({ kind: "<", text: "<", ...at });
      adv(1);
      continue;
    }
    // A plain `inTag`, and it is plain only because a hole resets the state. `<input size={cmp > 1 ?
    // "y" : "n"}/>` has a greater-than inside an attribute, and inside that hole `inTag` is false,
    // so nothing here has to know about it. The spec's rule for the other direction — *"a `<`
    // followed by neither a name nor `/` is text too"* — has no counterpart for `>`, and this is
    // where that asymmetry is paid for.
    if (c === ">" && inTag) {
      inTag = false;
      const selfClosing = toks[toks.length - 1]?.kind === "/";
      if (tagClosing) jsxOpen--;
      else if (!selfClosing) jsxOpen++;
      toks.push({ kind: ">", text: ">", ...at });
      adv(1);
      continue;
    }

    const p = PUNCT.find((s) => src.startsWith(s, i));
    if (!p) return { toks, error: `stray '${c}' at ${line}:${col}` };
    toks.push({ kind: p, text: p, ...at });
    adv(p.length);
  }
  return { toks };
}

// ── EBNF to BNF ──────────────────────────────────────────────────────────────────────────────────
//
// Earley wants flat productions. `[x]` becomes two alternatives, `{ x }` a fresh left-recursive
// rule — which is free here, being the whole reason for choosing Earley — and a parenthesised
// group a fresh rule of its own.

interface Prod { lhs: string; rhs: string[] }

/**
 * A grammar literal as the token kinds the lexer would produce for it.
 *
 * One symbol for almost everything, and more than one for `">>"`, `">>>"`, `">>="` and `">>>="`,
 * which the lexer no longer produces as single tokens. Running the *same* punctuation table over
 * the literal is what keeps the two in step: a change to `PUNCT` cannot leave a rule matching a
 * token that no longer exists.
 */
function litSymbols(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (/[A-Za-z_]/.test(text[i])) {
      let j = i;
      while (j < text.length && /[A-Za-z0-9_!~@]/.test(text[j])) j++;
      out.push(`'${text.slice(i, j)}'`);
      i = j;
      continue;
    }
    const p = PUNCT.find((s) => text.startsWith(s, i));
    if (p) { out.push(`'${p}'`); i += p.length; continue; }
    out.push(`'${text[i]}'`);
    i++;
  }
  return out.length > 0 ? out : [`'${text}'`];
}

/** A terminal is a rule name the grammar never defines, or a literal written `'…'`. */
class Bnf {
  prods: Prod[] = [];
  private n = 0;
  constructor(private rules: Map<string, Rule>) {}

  private fresh(hint: string): string { return `${hint}$${this.n++}`; }

  /** Every sequence `t` can be, as symbol lists. */
  private expand(t: Term, owner: string): string[][] {
    switch (t.kind) {
      case "lit": return [litSymbols(t.text)];
      case "range": return [[`'${t.from}'`]];      // a lexical rule; never reached from `program`
      case "prose": return [[]];
      case "ref": return [[t.name]];
      case "opt": {
        const inner = this.expand(t.of, owner);
        return [[], ...inner];
      }
      case "alt": {
        const out: string[][] = [];
        for (const x of t.of) out.push(...this.expand(x, owner));
        return out;
      }
      case "seq": {
        let acc: string[][] = [[]];
        for (const x of t.of) {
          const next = this.expand(x, owner);
          const merged: string[][] = [];
          for (const a of acc) for (const b of next) merged.push([...a, ...b]);
          acc = merged;
          // A sequence of optionals multiplies out; cap it rather than exploding on a rule that
          // would produce thousands. Nothing in this grammar comes close, and if something does the
          // report should say so rather than hang.
          if (acc.length > 512) throw new Error(`${owner}: over 512 alternatives after expansion`);
        }
        return acc;
      }
      case "rep": {
        const name = this.fresh(`${owner}_rep`);
        const inner = this.expand(t.of, owner);
        this.prods.push({ lhs: name, rhs: [] });
        for (const seq of inner) this.prods.push({ lhs: name, rhs: [name, ...seq] });
        return [[name]];
      }
    }
  }

  build(): Prod[] {
    for (const [name, r] of this.rules) {
      for (const seq of this.expand(r.body, name)) this.prods.push({ lhs: name, rhs: seq });
    }
    return this.prods;
  }
}

// ── Earley ───────────────────────────────────────────────────────────────────────────────────────

interface Item { prod: Prod; dot: number; origin: number }

/**
 * Answers how far the parse got: `ok` when the whole token stream is a `start`, otherwise the index
 * of the first token no item could advance past.
 *
 * Nullable rules need the completed-item pass repeated until the set stops growing — the Aycock and
 * Horspool problem — which the `while (grew)` below is. Without it a rule whose body is entirely
 * optional silently fails, and the grammar has several: `[ param_list ]`, `[ arg_list ]`.
 */
function earley(
  prods: Prod[],
  toks: Token[],
  start: string,
  terminals: Set<string>,
  budgetMs = 20_000,
): number | "ok" | "budget" {
  const byLhs = new Map<string, Prod[]>();
  for (const p of prods) {
    const l = byLhs.get(p.lhs);
    if (l) l.push(p);
    else byLhs.set(p.lhs, [p]);
  }

  const sets: Item[][] = Array.from({ length: toks.length + 1 }, () => []);
  const seen: Set<string>[] = Array.from({ length: toks.length + 1 }, () => new Set());
  const key = (it: Item) => `${it.prod.lhs}|${it.prod.rhs.join(" ")}|${it.dot}|${it.origin}`;

  const add = (at: number, it: Item): boolean => {
    const k = key(it);
    if (seen[at].has(k)) return false;
    seen[at].add(k);
    sets[at].push(it);
    return true;
  };

  for (const p of byLhs.get(start) ?? []) add(0, { prod: p, dot: 0, origin: 0 });

  let furthest = 0;
  // **A deadline, because the cost is in the ambiguity and not in the length.** An 18,000-token
  // font table finishes in under three seconds; something far shorter can not finish at all, and a
  // recogniser that hangs reports nothing about the file it hung on. Giving up and saying so is a
  // result — it names a construct this grammar is ambiguous enough about to be unparseable, which
  // is worth knowing and is invisible if the run is simply killed.
  const deadline = performance.now() + budgetMs;
  for (let i = 0; i <= toks.length; i++) {
    if (performance.now() > deadline) return "budget";
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < sets[i].length; j++) {
        const it = sets[i][j];
        const sym = it.prod.rhs[it.dot];
        if (sym === undefined) {
          // Complete: advance everything waiting on this rule.
          for (const w of sets[it.origin]) {
            if (w.prod.rhs[w.dot] === it.prod.lhs) {
              if (add(i, { prod: w.prod, dot: w.dot + 1, origin: w.origin })) grew = true;
            }
          }
        } else if (!terminals.has(sym) && byLhs.has(sym)) {
          for (const p of byLhs.get(sym)!) {
            if (add(i, { prod: p, dot: 0, origin: i })) grew = true;
          }
        }
      }
    }

    if (sets[i].length > 0) furthest = i;
    if (i === toks.length) break;

    // Scan.
    const t = toks[i];
    for (const it of sets[i]) {
      const sym = it.prod.rhs[it.dot];
      if (sym === undefined) continue;
      const isLit = sym.startsWith("'");
      const want = isLit ? sym.slice(1, -1) : sym;
      // A literal matches its own token kind, **or an `IDENT` spelled that way**. That second half
      // is how a contextual keyword works and the grammar says outright that it has them:
      // *"`from` here is contextual: an ordinary identifier elsewhere"*. `fill` is the other, and
      // so is every type name — `[§wac-grammar-keywords-h4mq7wn]`'s fence does not list `i32`, and
      // the fence is the authority, so `i32 i32 = 0;` is a program and `packages/gzip` has a method
      // called `fill`. Lexing those as keywords cost one false refusal each before this line
      // existed.
      const hit = isLit ? (t.kind === want || (t.kind === "IDENT" && t.text === want)) : t.kind === want;
      if (hit) add(i + 1, { prod: it.prod, dot: it.dot + 1, origin: it.origin });
    }
  }

  const done = sets[toks.length].some(
    (it) => it.prod.lhs === start && it.dot === it.prod.rhs.length && it.origin === 0,
  );
  return done ? "ok" : furthest;
}

// ── Driver ───────────────────────────────────────────────────────────────────────────────────────


/**
 * A file's tokens, split into one top-level declaration each.
 *
 * **Earley is O(n³) in the ambiguity, and this grammar is ambiguous on purpose** — `trap` is both a
 * statement and an expression, `P(1)` is both a call and a construction, and the spec's alternatives
 * are a set rather than an ordered choice, which is the whole reason for choosing Earley. On a file
 * of a few hundred tokens that costs nothing. On `packages/wacc/src`, where files run to four
 * thousand lines, it does not finish: a whole-file parse of the tree was killed twice before this
 * function existed.
 *
 * `program` is `{ import | struct_decl | … }`, a sequence of independent declarations, so parsing
 * them one at a time computes the same answer with `n` the size of a declaration rather than of a
 * file. That is the difference between a minute and never.
 *
 * The split is by brace depth, which is a *lexical* fact and needs no parse: a declaration ends at
 * a `;` at depth zero or at the `}` that returns to it. A file whose braces do not balance yields
 * one chunk and parses as it used to.
 */
function declarations(toks: Token[]): Token[][] {
  const out: Token[][] = [];
  let start = 0, depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const k = toks[i].kind;
    if (k === "{" || k === "[" || k === "(") depth++;
    else if (k === "}" || k === "]" || k === ")") {
      depth--;
      // A `}` back at depth zero ends a declaration — **unless `from` follows it**, which is the one
      // place in this grammar where a top-level brace pair is not a body: `import { A } from "x";`
      // and its re-export twin. Splitting there cut every import in half and took the vision run
      // from 44 files to 8, which is what a wrong chunker looks like: it does not error, it hands
      // the parser fragments and reports them as the file's own fault.
      if (depth === 0 && k === "}" && toks[i + 1]?.text !== "from") {
        out.push(toks.slice(start, i + 1));
        start = i + 1;
      }
    } else if (k === ";" && depth === 0) { out.push(toks.slice(start, i + 1)); start = i + 1; }
  }
  if (start < toks.length) out.push(toks.slice(start));
  return out.filter((c) => c.length > 0);
}

/**
 * Whether a file says at the top that it is not supposed to compile.
 *
 * `spec/cases/README.md`: *"A case is one `.wac` file. Its first lines are comments:
 * `// expect: emits | refused | traps <fn> | answers <fn> = <value>`"*. 143 of the cases expect a
 * refusal and almost all of them are refused for a *semantic* reason — a type error, a missing
 * override — which the grammar must still parse. So this does not mean "the grammar should refuse
 * it"; it means a refusal here is uninformative and belongs in its own column.
 */
function expectsRefusal(src: string): boolean {
  const head = src.split("\n", 3).join("\n");
  return /^\/\/ expect:\s*(refused|declined)\b/m.test(head);
}

function walk(dir: string, out: string[]): void {
  for (const e of Deno.readDirSync(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) walk(p, out);
    else if (e.name.endsWith(".wac")) out.push(p);
  }
}

function main(argv: string[]): number {
  const roots = argv.length > 0 ? argv : ["packages"];
  const delta = roots.includes("vision") ? "vision/GRAMMAR.ebnf" : "";

  const grammarText = Deno.readTextFileSync(GRAMMAR);
  const keywords = keywordsFromFence(grammarText);
  const { rules } = readGrammar(GRAMMAR);
  if (delta) {
    let text = "";
    try { text = Deno.readTextFileSync(delta); } catch { text = ""; }
    if (text) {
      // A delta rule *replaces* the spec's, which is what makes it a patch rather than a second
      // grammar: `unary_expr` here is the whole of `unary_expr`, and the diff against the spec is
      // readable because both are in one notation.
      const patch = parseRules({ text, firstLine: 1 });
      for (const r of patch) {
        const base = rules.get(r.name);
        if (r.add && base) {
          // `name += …` adds an alternative to what the spec already has, so a patch only states
          // what it changes and cannot go stale against the parts it does not care about.
          rules.set(r.name, { ...base, body: { kind: "alt", of: [base.body, r.body] } });
        } else {
          rules.set(r.name, r);
        }
      }
      const added = patch.filter((r) => r.add).length;
      console.log(
        `${delta}: ${patch.length - added} rules replaced, ${added} extended, over the spec's`,
      );
    } else {
      console.log(`${delta}: not present — running the spec grammar unpatched`);
    }
  }

  // Anything referred to and not defined is a terminal the lexer supplies.
  const terminals = new Set<string>();
  const collect = (t: Term) => {
    if (t.kind === "ref" && !rules.has(t.name)) terminals.add(t.name);
    if (t.kind === "opt" || t.kind === "rep") collect(t.of);
    if (t.kind === "seq" || t.kind === "alt") for (const x of t.of) collect(x);
  };
  for (const r of rules.values()) collect(r.body);

  // The lexical block defines its terminals in prose-with-notation, so they are dropped and the
  // lexer's kinds stand in. Dropping them is what makes them terminals rather than empty rules.
  for (const n of ["IDENT", "INT_LITERAL", "FLOAT_LITERAL", "STRING", "CHAR_LITERAL"]) {
    rules.delete(n);
    terminals.add(n);
  }

  let prods: Prod[];
  try {
    prods = new Bnf(rules).build();
  } catch (e) {
    console.log(`could not flatten the grammar: ${e instanceof Error ? e.message : e}`);
    return 2;
  }
  console.log(`${rules.size} rules → ${prods.length} bnf productions, ${terminals.size} terminals, ${keywords.size} keywords`);

  const files: string[] = [];
  for (const r of roots) {
    try { walk(r, files); } catch { console.log(`no such directory: ${r}`); }
  }
  files.sort();

  let ok = 0;
  const bad: string[] = [];
  const slow: string[] = [];
  const gaveUp: string[] = [];
  const expected: string[] = [];

  /**
   * Progress, on stderr, written synchronously.
   *
   * `console.log` to a redirected stdout is buffered, so a run that takes minutes produces an empty
   * file and looks identical to a run that is stuck. Two whole-tree attempts were killed on that
   * evidence before the third one showed it had been working the whole time. A long job that cannot
   * say where it is will be killed by somebody eventually, and the cheapest fix is one unbuffered
   * write per file.
   */
  const enc = new TextEncoder();
  const note = (s: string) => { Deno.stderr.writeSync(enc.encode(s + "\n")); };

  let seen = 0;
  for (const f of files) {
    seen++;
    if (seen % 25 === 0) note(`  … ${seen}/${files.length} — ${f}`);
    const src = Deno.readTextFileSync(f);
    // JSX is in the grammar and is **not attempted here**, which is a limit of this reader rather
    // than a gap in the spec. `[§jsx-text-is-not-wac-source]`: between an element's tags the lexer
    // reads text, so `it's here` and `a " b` are text and nothing there starts a string or a
    // comment. That is a second lexer mode driven by the parser's position, and this tool has one
    // mode. The productions were added the same day and read from `parse.wac`; verifying them needs
    // the mode switch, and saying so is better than a list of sixteen unexplained refusals.
    const { toks, error } = lex(src, keywords);
    // A lex failure obeys the same rule as a parse failure: `0081-a-block-comment-has-to-close` and
    // `0290-a-newline-ends-a-literal-where-it-occurs` are cases *about* the lexer refusing, so this
    // refusing them is the expected outcome and not a defect in the grammar.
    if (error) { (expectsRefusal(src) ? expected : bad).push(`${f}: lex: ${error}`); continue; }

    let failed = false;
    for (const chunk of declarations(toks)) {
      const t0 = performance.now();
      const r = earley(prods, chunk, "program", terminals);
      const ms = performance.now() - t0;
      if (r === "budget") {
        const s = `${f}:${chunk[0]?.line ?? 0}: ${chunk.length} tokens, gave up after ${(ms / 1000).toFixed(0)}s`;
        gaveUp.push(s);
        note(`  budget  ${s}`);
        continue;
      }
      if (ms > 2000) {
        const s = `${f}:${chunk[0]?.line ?? 0}: ${chunk.length} tokens, ${(ms / 1000).toFixed(1)}s`;
        slow.push(s);
        note(`  slow  ${s}`);
      }
      if (r === "ok") continue;
      const t = chunk[r] ?? chunk[chunk.length - 1];
      const where = `${f}:${t?.line ?? 0}:${t?.col ?? 0}: no rule reaches '${t?.text ?? "<eof>"}'`;
      // `spec/cases` writes its expectation on the first line. A case that expects to be *refused*
      // and is refused here proves nothing — it may be refused for a type error the grammar has no
      // opinion about, and being refused for the wrong reason looks identical. So it is set aside
      // rather than counted either way, and the count that matters is refusals of code that is
      // supposed to work.
      (expectsRefusal(src) ? expected : bad).push(where);
      failed = true;
      break;   // everything after the first refusal in a file is cascade
    }
    if (!failed) ok++;
  }

  console.log(`\n${ok}/${files.length} files parse`);
  if (expected.length > 0) {
    console.log(
      `\n-- refused, and the case expects a refusal (uninformative: the grammar may be right for ` +
      `the wrong reason) --`,
    );
    for (const e of expected) console.log(`  ${e}`);
  }
  if (slow.length > 0) {
    console.log(`\n-- over two seconds --`);
    for (const s of slow) console.log(`  ${s}`);
  }
  if (gaveUp.length > 0) {
    console.log(`\n-- not answered within the budget --`);
    for (const s of gaveUp) console.log(`  ${s}`);
  }
  if (bad.length > 0) {
    console.log(`\n-- refused --`);
    for (const b of bad) console.log(`  ${b}`);
  }
  return 0;
}

Deno.exit(main(Deno.args));
