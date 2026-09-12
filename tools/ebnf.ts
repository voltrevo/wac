// Reading `spec/spec/grammar.md` as a grammar.
//
// The EBNF blocks in that file, as a term tree, for anything that wants to treat the spec as the
// definition it says it is rather than as prose to grep. Two callers today —
// `tools/ebnfaudit.ts`, which says what is wrong with the notation, and `tools/specparse.ts`,
// which parses real wac files with it.
//
// **Terminals are not modelled here.** `IDENT`, `STRING` and the rest are named by the lexical
// block in prose-with-notation — `string_char = (* any character except " and \ *) | string_escape`
// is not something to generate a lexer from — so a caller brings its own lexer and treats those
// names as terminals. That is the honest arrangement rather than a gap, and `ebnfaudit` says so.

export const GRAMMAR = "spec/spec/grammar.md";

/** One EBNF term. `alt` is a choice, `seq` a concatenation, the rest wrap a single child. */
export type Term =
  | { kind: "ref"; name: string }
  | { kind: "lit"; text: string }
  | { kind: "range"; from: string; to: string }
  | { kind: "prose" }
  | { kind: "opt"; of: Term }
  | { kind: "rep"; of: Term }
  | { kind: "seq"; of: Term[] }
  | { kind: "alt"; of: Term[] };

export interface Rule {
  name: string;
  body: Term;
  line: number;
  /**
   * Written `name += …` rather than `name = …`: an **extra alternative** for a rule that already
   * exists, rather than a replacement of it.
   *
   * Only a patch file uses this, and it exists because a patch that copies a whole rule in order to
   * add one branch goes stale the moment the original changes. `vision/vibes/GRAMMAR.ebnf` copied
   * `primary_expr` to add `trap`, and two hours later the spec's `primary_expr` gained
   * `string_literal` and `jsx_expr` — so the vision grammar stopped parsing two of its own files,
   * for a reason that had nothing to do with vision.
   */
  add?: boolean;
}

/** Every ```ebnf block, with EBNF comments removed and the line each rule started on kept. */
export function ebnfSource(text: string): { text: string; firstLine: number }[] {
  const out: { text: string; firstLine: number }[] = [];
  const lines = text.split("\n");
  // A file with no fence in it *is* the block. `spec/spec/grammar.md` carries its grammar inside
  // ```ebnf fences because it is prose with a grammar in it; `vision/vibes/GRAMMAR.ebnf` is a grammar, and
  // asking for the fences in one returns nothing — which is how `tools/ebnfaudit.ts` came to report
  // *0 rules, 0 distinct* and a clean bill of health for a file with nine duplicate definitions in
  // it. Answering the whole text is what every caller meant.
  if (!lines.some((l) => l.startsWith("```ebnf"))) return [{ text, firstLine: 1 }];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith("```ebnf")) {
      const start = i + 1;
      let j = start;
      while (j < lines.length && !lines[j].startsWith("```")) j++;
      out.push({ text: lines.slice(start, j).join("\n"), firstLine: start + 1 });
      i = j + 1;
    } else i++;
  }
  return out;
}

/**
 * Blank out `(* … *)` comments, keeping newlines so line numbers survive.
 *
 * Not deleted: a comment can span lines — `func_decl`'s does — and removing it outright would move
 * every rule after it, which is the difference between a report you can act on and one you cannot.
 */
function blankComments(s: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === "(*") depth++;
    if (depth === 0) out += s[i];
    else out += s[i] === "\n" ? "\n" : " ";
    if (two === "*)" && depth > 0) {
      depth--;
      i++; // the ')' was already blanked by the line above
      out += " ";
    }
  }
  return out;
}

/** A single EBNF token. Quoted strings keep their content; everything else is punctuation or a name. */
type Tok = { t: string; v: string };

function lexEbnf(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j++;
      toks.push({ t: "lit", v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    // `"a".."f"` and `"a"..."f"` both appear, which is itself a finding.
    if (c === "." && src[i + 1] === ".") {
      let j = i;
      while (src[j] === ".") j++;
      toks.push({ t: "..", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if ("=|,;[]{}()".includes(c)) { toks.push({ t: c, v: c }); i++; continue; }
    let j = i;
    while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
    if (j === i) { i++; continue; }        // anything else is notation this reader does not model
    toks.push({ t: "name", v: src.slice(i, j) });
    i = j;
  }
  return toks;
}

/** Recursive-descent over the EBNF itself: alt → seq → postfix → atom. */
export class EbnfParser {
  private at = 0;
  constructor(private toks: Tok[]) {}

  done(): boolean { return this.at >= this.toks.length; }
  peek(): Tok | undefined { return this.toks[this.at]; }
  take(): Tok { return this.toks[this.at++]; }
  eat(t: string): boolean {
    if (this.peek()?.t === t) { this.at++; return true; }
    return false;
  }

  alt(): Term {
    const branches = [this.seq()];
    while (this.eat("|")) branches.push(this.seq());
    return branches.length === 1 ? branches[0] : { kind: "alt", of: branches };
  }

  seq(): Term {
    const items: Term[] = [];
    for (;;) {
      const t = this.peek();
      if (!t || t.t === "|" || t.t === ";" || t.t === "]" || t.t === "}" || t.t === ")") break;
      if (t.t === ",") { this.at++; continue; }
      items.push(this.atom());
    }
    if (items.length === 1) return items[0];
    return { kind: "seq", of: items };
  }

  atom(): Term {
    const t = this.take();
    if (t.t === "[") { const of = this.alt(); this.eat("]"); return { kind: "opt", of }; }
    if (t.t === "{") { const of = this.alt(); this.eat("}"); return { kind: "rep", of }; }
    if (t.t === "(") { const of = this.alt(); this.eat(")"); return of; }
    if (t.t === "lit") {
      if (this.peek()?.t === "..") {
        this.at++;
        const to = this.take();
        return { kind: "range", from: t.v, to: to.v };
      }
      return { kind: "lit", text: t.v };
    }
    if (t.t === "name") return { kind: "ref", name: t.v };
    return { kind: "prose" };
  }
}

/**
 * Split a block into `name = body ;` rules.
 *
 * On `;` at depth zero, since a `";"` *token* is a quoted literal and the lexer has already turned
 * it into a `lit` — the reason this splits on tokens rather than on text.
 */
export function parseRules(block: { text: string; firstLine: number }): Rule[] {
  const rules: Rule[] = [];
  const src = blankComments(block.text);
  const lines = src.split("\n");

  // A rule starts at a line whose first token is a name followed by `=`. Everything up to the next
  // such line, or the end, is its body.
  const heads: { name: string; from: number; add: boolean }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(\+?)=/.exec(lines[i]);
    if (m) heads.push({ name: m[1], from: i, add: m[2] === "+" });
  }
  for (let h = 0; h < heads.length; h++) {
    const to = h + 1 < heads.length ? heads[h + 1].from : lines.length;
    const text = lines.slice(heads[h].from, to).join("\n");
    const body = text.slice(text.indexOf("=") + 1);
    const p = new EbnfParser(lexEbnf(body));
    rules.push({
      name: heads[h].name,
      body: p.alt(),
      line: block.firstLine + heads[h].from,
      add: heads[h].add,
    });
  }
  return rules;
}


/** Every rule in the file, in order, plus a name→rule map with the first of any duplicate. */
export function readGrammar(path = GRAMMAR): { all: Rule[]; rules: Map<string, Rule> } {
  const blocks = ebnfSource(Deno.readTextFileSync(path));
  const all: Rule[] = [];
  for (const b of blocks) all.push(...parseRules(b));
  const rules = new Map<string, Rule>();
  for (const r of all) if (!rules.has(r.name)) rules.set(r.name, r);
  return { all, rules };
}
