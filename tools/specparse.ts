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
// The cost is speed — O(n³) worst case, near-linear in practice on grammars like this one. A parse
// of every file in `packages/` is a minute of work, not a millisecond, which is why this is a
// command rather than a test.
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

function lex(src: string, keywords: Set<string>): { toks: Token[]; error?: string } {
  const toks: Token[] = [];
  let i = 0, line = 1, col = 1;
  const adv = (n: number) => {
    for (let k = 0; k < n; k++) {
      if (src[i + k] === "\n") { line++; col = 1; } else col++;
    }
    i += n;
  };

  while (i < src.length) {
    const c = src[i];
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
      let j = i + 1;
      while (j < src.length && src[j] !== '"') { if (src[j] === "\\") j++; j++; }
      if (j >= src.length) return { toks, error: `unterminated string at ${line}:${col}` };
      toks.push({ kind: "STRING", text: src.slice(i, j + 1), ...at });
      adv(j + 1 - i);
      continue;
    }
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
      for (const r of parseRules({ text, firstLine: 1 })) rules.set(r.name, r);
      console.log(`${delta}: ${parseRules({ text, firstLine: 1 }).length} rules over the spec's`);
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
  for (const f of files) {
    const src = Deno.readTextFileSync(f);
    const { toks, error } = lex(src, keywords);
    if (error) { bad.push(`${f}: lex: ${error}`); continue; }

    let failed = false;
    for (const chunk of declarations(toks)) {
      const t0 = performance.now();
      const r = earley(prods, chunk, "program", terminals);
      const ms = performance.now() - t0;
      if (r === "budget") {
        const s = `${f}:${chunk[0]?.line ?? 0}: ${chunk.length} tokens, gave up after ${(ms / 1000).toFixed(0)}s`;
        gaveUp.push(s);
        console.log(`  budget  ${s}`);
        continue;
      }
      if (ms > 2000) {
        const s = `${f}:${chunk[0]?.line ?? 0}: ${chunk.length} tokens, ${(ms / 1000).toFixed(1)}s`;
        slow.push(s);
        console.log(`  slow  ${s}`);
      }
      if (r === "ok") continue;
      const t = chunk[r] ?? chunk[chunk.length - 1];
      bad.push(`${f}:${t?.line ?? 0}:${t?.col ?? 0}: no rule reaches '${t?.text ?? "<eof>"}'`);
      failed = true;
      break;   // everything after the first refusal in a file is cascade
    }
    if (!failed) ok++;
  }

  console.log(`\n${ok}/${files.length} files parse`);
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
