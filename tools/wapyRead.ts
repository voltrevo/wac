#!/usr/bin/env -S deno run --allow-read
// wapyRead — parse wapy into wac's AST.
//
//   deno run --allow-read tools/wapyRead.ts file.wapy
//
// ## What it produces, and why that shape
//
// A **`Token[]` carrying wapy's own positions**, handed to `wacParse`. So the AST that comes
// out has line and column numbers pointing into the `.wapy` file the author wrote, and every
// diagnostic downstream is correct without anything else knowing wapy exists.
//
// An earlier version emitted wac *source text* and carried a line map beside it to translate
// diagnostics back. That worked, and it was scar tissue: the map existed only because the text
// pass had thrown the positions away, and every consumer of a position would then have had to
// learn about maps. Positions belong to tokens, so tokens are what this emits.
//
// Dropping the text stage removed the rest of it too — no re-lexing, and no rules about where a
// space may go so that `as~` does not become `as ~`. A token stream has no spacing.
//
// ## What it is not
//
// Not a second parser. `wacParse` stays the only parser and the only grammar; this is a
// frontend that feeds it. Token *kinds* come from `wacLex` classifying each token's text, so
// wac's keyword set is not duplicated here either — add a keyword to the language and this
// picks it up.
//
// Reversing the printer's word substitutions is positional, because every one of them is also a
// legal wac identifier. wac's grammar is unambiguous about operand versus operator position,
// which is what makes that sound: `a and b` has `and` where an operator belongs, `f(and)` has
// it where an operand belongs, and `case None:` is a pattern.

import { wacLex, type Token } from "../atoms/wac/wacLex.ts";
import { wacParse, type ParseError, type Program } from "../atoms/wac/wacParse.ts";

// ── Lexing wapy ──────────────────────────────────────────────────────────────

type Tok = { t: string; kind: "id" | "num" | "str" | "punct"; line: number; col: number };

const PUNCT = [
  "as!", "as~", "as@", ">>>=", "<<=", ">>=", ">>>", "&&", "||", "==", "!=", "<=", ">=",
  "<<", ">>", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "->",
  "{", "}", "(", ")", "[", "]", ",", ";", ":", ".", "?", "!", "+", "-", "*", "/", "%",
  "<", ">", "=", "&", "|", "^", "~", "@",
];

/** Tokenise one line. `#` starts a comment, except inside a string. */
function lexLine(line: string, lineNo: number): { toks: Tok[]; comment: string } {
  const toks: Tok[] = [];
  let i = 0;
  const at = () => ({ line: lineNo, col: i + 1 });
  while (i < line.length) {
    const c = line[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c === "#") return { toks, comment: line.slice(i) };

    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== c) j += line[j] === "\\" ? 2 : 1;
      toks.push({ t: line.slice(i, j + 1), kind: "str", ...at() });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^(0[xXbBoO][0-9a-fA-F_]+|[0-9][0-9_]*(\.[0-9_]+)?([eE][+-]?[0-9]+)?)/
        .exec(line.slice(i))!;
      toks.push({ t: m[0], kind: "num", ...at() });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(i))!;
      // The checked casts are a word glued to a sigil, and the identifier rule would otherwise
      // win the race against PUNCT and split them.
      if (m[0] === "as" && "!~@".includes(line[i + 2] ?? "")) {
        toks.push({ t: `as${line[i + 2]}`, kind: "punct", ...at() });
        i += 3;
        continue;
      }
      toks.push({ t: m[0], kind: "id", ...at() });
      i += m[0].length;
      continue;
    }
    const p = PUNCT.find((q) => line.startsWith(q, i));
    toks.push({ t: p ?? c, kind: "punct", ...at() });
    i += (p ?? c).length;
  }
  return { toks, comment: "" };
}

// ── Blocks ───────────────────────────────────────────────────────────────────

type Node = { indent: number; toks: Tok[]; comment: string; kids: Node[]; line: number };

function readTree(src: string): Node[] {
  const flat: Node[] = [];
  src.split("\n").forEach((raw, i) => {
    if (raw.trim() === "") return;
    const { toks, comment } = lexLine(raw, i + 1);
    flat.push({ indent: raw.length - raw.trimStart().length, toks, comment, kids: [], line: i + 1 });
  });
  const roots: Node[] = [];
  const stack: Node[] = [];
  for (const n of flat) {
    while (stack.length && stack[stack.length - 1].indent >= n.indent) stack.pop();
    (stack.length ? stack[stack.length - 1].kids : roots).push(n);
    // A comment-only line never opens a block.
    if (n.toks.length) stack.push(n);
  }
  return roots;
}

// ── Making wac tokens ────────────────────────────────────────────────────────

const lexCache = new Map<string, { kind: Token["kind"]; text: string }>();

/**
 * wac's own lexing of one token's source text.
 *
 * Both halves matter. The *kind* means wac's keyword set is not duplicated here — add a keyword
 * to the language and this picks it up. The *text* means escapes are resolved by the same code
 * that resolves them for wac: an earlier version special-cased a string as `slice(1, -1)`, which
 * left `"\\u00"` as a literal backslash-backslash and changed the program.
 */
function classify(src: string): { kind: Token["kind"]; text: string } {
  let c = lexCache.get(src);
  if (c === undefined) {
    const t = wacLex(src).tokens[0];
    c = { kind: t?.kind ?? "ident", text: t?.text ?? src };
    lexCache.set(src, c);
  }
  return c;
}

type Pos = { line: number; col: number };

/** A wac token at a wapy position. */
function wtok(src: string, at: Pos): Token {
  const { kind, text } = classify(src);
  return { kind, text, line: at.line, col: at.col };
}

const conv = (t: Tok): Token => wtok(t.t, t);

// ── Reversing the printer's substitutions ────────────────────────────────────

const ENDS_OPERAND = new Set([")", "]", "!", "}"]);
const NOT_OPERAND_ENDERS = new Set([
  "and", "or", "not", "is", "in", "if", "else", "case", "return", "match", "switch",
  "while", "for", "trap", "scope", "do",
]);

function afterOperand(toks: Tok[], i: number): boolean {
  if (i === 0) return false;
  const p = toks[i - 1];
  if (p.kind === "num" || p.kind === "str") return true;
  if (p.kind === "punct") return ENDS_OPERAND.has(p.t);
  return !NOT_OPERAND_ENDERS.has(p.t);
}

function words(toks: Tok[]): Tok[] {
  return toks.map((t, i) => {
    if (t.kind !== "id") return t;
    if (i > 0 && (toks[i - 1].t === "." || toks[i - 1].t === "case")) return t;
    const as = (s: string, kind: Tok["kind"] = "punct"): Tok => ({ ...t, t: s, kind });
    if (t.t === "and" && afterOperand(toks, i)) return as("&&");
    if (t.t === "or" && afterOperand(toks, i)) return as("||");
    if (t.t === "not" && !afterOperand(toks, i) && toks[i - 1]?.t !== "is") return as("!");
    if (t.t === "None" && !afterOperand(toks, i)) return as("null", "id");
    if (t.t === "True") return as("true", "id");
    if (t.t === "False") return as("false", "id");
    if (t.t === "self") return as("this", "id");
    return t;
  });
}

/** `(X if C else Y)` → `(C ? X : Y)`. The printer always parenthesises, so this is a lookup. */
function ternaries(toks: Tok[]): Tok[] {
  for (let open = toks.length - 1; open >= 0; open--) {
    if (toks[open].t !== "(") continue;
    let d = 0, close = -1;
    for (let j = open; j < toks.length; j++) {
      if (toks[j].t === "(") d++;
      else if (toks[j].t === ")") { d--; if (!d) { close = j; break; } }
    }
    if (close < 0) continue;
    let k = 0, ifAt = -1, elseAt = -1;
    for (let j = open + 1; j < close; j++) {
      const s = toks[j].t;
      if (s === "(" || s === "[") k++;
      else if (s === ")" || s === "]") k--;
      else if (k === 0 && s === "if" && ifAt < 0) ifAt = j;
      else if (k === 0 && s === "else" && ifAt >= 0 && elseAt < 0) elseAt = j;
    }
    if (ifAt < 0 || elseAt < 0) continue;
    const rebuilt = [
      toks[open],
      ...toks.slice(ifAt + 1, elseAt),
      { ...toks[ifAt], t: "?", kind: "punct" as const },
      ...toks.slice(open + 1, ifAt),
      { ...toks[elseAt], t: ":", kind: "punct" as const },
      ...toks.slice(elseAt + 1, close),
      toks[close],
    ];
    return ternaries([...toks.slice(0, open), ...rebuilt, ...toks.slice(close + 1)]);
  }
  return toks;
}

/** wac parenthesises a match subject; wapy does not. */
function matchSubjects(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].t === "match" && !afterOperand(toks, i)) {
      let j = i + 1, d = 0;
      while (j < toks.length && !(d === 0 && toks[j].t === "{")) {
        if ("([".includes(toks[j].t)) d++;
        else if (")]".includes(toks[j].t)) d--;
        j++;
      }
      if (j < toks.length) {
        out.push(
          toks[i],
          { ...toks[i + 1], t: "(", kind: "punct" },
          ...toks.slice(i + 1, j),
          { ...toks[j - 1], t: ")", kind: "punct" },
        );
        i = j - 1;
        continue;
      }
    }
    out.push(toks[i]);
  }
  return out;
}

function splitTop(toks: Tok[], sep = ","): Tok[][] {
  const parts: Tok[][] = [];
  let cur: Tok[] = [], d = 0;
  for (const t of toks) {
    if ("([{".includes(t.t)) d++;
    else if (")]}".includes(t.t)) d--;
    if (d === 0 && t.t === sep) { parts.push(cur); cur = []; continue; }
    cur.push(t);
  }
  if (cur.length || parts.length) parts.push(cur);
  return parts;
}

/**
 * Named arguments. wapy writes `Point(y=4.0)` and `i32[3](fill=-1)`; wac spells the first
 * `Point { y: 4.0 }` and the second `i32[3](fill: -1)`. A `]` before the paren is what tells a
 * sized array from a struct literal.
 */
function namedArgs(toks: Tok[]): Tok[] {
  let out = [...toks];
  for (let open = out.length - 1; open >= 0; open--) {
    if (out[open].t !== "(") continue;
    let d = 0, close = -1;
    for (let j = open; j < out.length; j++) {
      if (out[j].t === "(") d++;
      else if (out[j].t === ")") { d--; if (!d) { close = j; break; } }
    }
    if (close < 0 || close === open + 1) continue;
    const parts = splitTop(out.slice(open + 1, close));
    if (!parts.length || !parts.every((p) => p.length >= 2 && p[0].kind === "id" && p[1].t === "=")) {
      continue;
    }
    const joined: Tok[] = [];
    parts.forEach((p, i) => {
      if (i) joined.push({ ...p[0], t: ",", kind: "punct" });
      joined.push(p[0], { ...p[1], t: ":", kind: "punct" }, ...p.slice(2));
    });
    const isArray = out[open - 1]?.t === "]";
    out = [
      ...out.slice(0, open),
      { ...out[open], t: isArray ? "(" : "{" },
      ...joined,
      { ...out[close], t: isArray ? ")" : "}" },
      ...out.slice(close + 1),
    ];
  }
  return out;
}

/** An expression run, as wac tokens. */
function ex(toks: Tok[]): Token[] {
  return namedArgs(matchSubjects(ternaries(words(toks)))).map(conv);
}

/**
 * A type run, as wac tokens. `T | None` → `T?`, and `Name[args]` → `Name<args>` for a generic —
 * but not `fn[...]`, which is wac's own syntax, and not the empty `[]` of an array.
 */
function typ(toks: Tok[]): Token[] {
  let ts = [...toks];
  let nullable: Tok | null = null;
  if (ts.length >= 2 && ts[ts.length - 1].t === "None" && ts[ts.length - 2].t === "|") {
    nullable = ts[ts.length - 1];
    ts = ts.slice(0, -2);
  }
  const out = ts.map((t) => ({ ...t }));
  for (let i = 0; i < out.length; i++) {
    if (out[i].t !== "[") continue;
    const prev = out[i - 1];
    if (!prev || prev.kind !== "id" || prev.t === "fn" || out[i + 1]?.t === "]") continue;
    let d = 0, j = i;
    for (; j < out.length; j++) {
      if (out[j].t === "[") d++;
      else if (out[j].t === "]") { d--; if (!d) break; }
    }
    if (j >= out.length) continue;
    out[i].t = "<";
    out[j].t = ">";
  }
  const done = out.map(conv);
  return nullable ? [...done, wtok("?", nullable)] : done;
}

// ── Emitting ─────────────────────────────────────────────────────────────────

const MODIFIERS = new Map([["export", "export"], ["const", "const"], ["override", "override"]]);
const modifierOf = (n: Node) =>
  n.toks.length === 2 && n.toks[0].t === "@" ? MODIFIERS.get(n.toks[1].t) : undefined;

function idx(toks: Tok[], want: string, from = 0): number {
  let d = 0;
  for (let i = from; i < toks.length; i++) {
    const t = toks[i].t;
    if ("([{".includes(t)) d++;
    else if (")]}".includes(t)) d--;
    else if (d === 0 && t === want) return i;
  }
  return -1;
}

/** The matching close for the bracket at `i`. */
function matching(T: Tok[], i: number, open: string, close: string): number {
  let d = 0;
  for (let j = i; j < T.length; j++) {
    if (T[j].t === open) d++;
    else if (T[j].t === close) { d--; if (!d) return j; }
  }
  return T.length - 1;
}

/** `name: T` / `const name: T` → `T name`, and the `self` forms → `this`. */
function param(toks: Tok[]): Token[] {
  let ts = toks;
  const out: Token[] = [];
  if (ts[0]?.t === "const") { out.push(conv(ts[0])); ts = ts.slice(1); }
  if (ts.length === 1 && ts[0].t === "self") return [...out, wtok("this", ts[0])];
  const colon = idx(ts, ":");
  if (colon < 0) return [...out, ...ts.map(conv)];
  return [...out, ...typ(ts.slice(colon + 1)), ...ts.slice(0, colon).map(conv)];
}

/** A declaration, assignment or expression, without its terminator. */
function stmtTokens(T: Tok[]): Token[] {
  let ts = T;
  const out: Token[] = [];
  if (ts[0]?.t === "const") { out.push(conv(ts[0])); ts = ts.slice(1); }
  const colon = idx(ts, ":");
  const eq = idx(ts, "=");
  if (colon > 0 && ts[colon - 1].kind === "id" && (eq < 0 || colon < eq)) {
    const t = typ(ts.slice(colon + 1, eq < 0 ? ts.length : eq));
    const name = ts.slice(0, colon).map(conv);
    if (eq < 0) return [...out, ...t, ...name];
    return [...out, ...t, ...name, conv(ts[eq]), ...ex(ts.slice(eq + 1))];
  }
  return [...out, ...ex(ts)];
}

function comma(parts: Token[][], at: Pos): Token[] {
  const out: Token[] = [];
  parts.forEach((p, i) => { if (i) out.push(wtok(",", at)); out.push(...p); });
  return out;
}

function variant(n: Node): Token[] {
  const T = n.toks;
  if (T.length === 1) return [conv(T[0])];
  const close = matching(T, 1, "(", ")");
  const parts = splitTop(T.slice(2, close)).filter((p) => p.length).map(param);
  return [conv(T[0]), wtok("(", T[1]), ...comma(parts, T[0]), wtok(")", T[close])];
}

function emit(n: Node, out: Token[], mods: string[]): void {
  const T = n.toks;
  if (T.length === 0) return;                       // a comment-only line
  const here: Pos = { line: n.line, col: T[0].col };
  const M = mods.map((m) => wtok(m, here));
  const kids = () => emitAll(n.kids, out);
  const last = T[T.length - 1];
  const head = T[0].t;

  switch (head) {
    // `from` is also an ordinary identifier in wac — `slice(a, from, to)` is real code — so a
    // line beginning with it is an import only when it has the whole shape.
    case "from": {
      const imp = idx(T, "import");
      if (!(T[1]?.kind === "str" && imp === 2)) break;
      const items = splitTop(T.slice(imp + 1)).filter((p) => p.length).map((p) => p.map(conv));
      out.push(
        wtok("import", here), wtok("{", T[imp]), ...comma(items, here), wtok("}", last),
        wtok("from", T[imp]), conv(T[1]), wtok(";", last),
      );
      return;
    }

    case "class": {
      let i = 2;
      let gen: Token[] = [], base: Token[] = [], isEnum = false;
      if (T[i]?.t === "[") {
        const j = matching(T, i, "[", "]");
        gen = [wtok("<", T[i]), ...T.slice(i + 1, j).map(conv), wtok(">", T[j])];
        i = j + 1;
      }
      if (T[i]?.t === "(") {
        const j = matching(T, i, "(", ")");
        if (T.slice(i + 1, j).map((t) => t.t).join("") === "enum") isEnum = true;
        else base = [wtok(":", T[i]), ...T.slice(i + 1, j).map(conv)];
      }
      out.push(...M, wtok(isEnum ? "enum" : "struct", here), conv(T[1]), ...gen, ...base,
               wtok("{", last));
      if (isEnum) {
        const vs = n.kids.filter((k) => k.toks.length && k.toks[0].t !== "def" && !modifierOf(k));
        const ms = n.kids.filter((k) => !k.toks.length || k.toks[0].t === "def" || modifierOf(k));
        out.push(...comma(vs.map(variant), here));
        emitAll(ms, out);
      } else kids();
      out.push(wtok("}", last));
      return;
    }

    case "def": {
      let i = 2;
      let gen: Token[] = [];
      if (T[i]?.t === "[") {
        const j = matching(T, i, "[", "]");
        gen = [wtok("<", T[i]), ...T.slice(i + 1, j).map(conv), wtok(">", T[j])];
        i = j + 1;
      }
      const close = matching(T, i, "(", ")");
      const ps = splitTop(T.slice(i + 1, close)).filter((p) => p.length).map(param);
      const arrow = idx(T, "->", close + 1);
      const ret = arrow >= 0 ? typ(T.slice(arrow + 1, T.length - 1)) : [wtok("void", here)];
      out.push(...M, ...ret, conv(T[1]), ...gen, wtok("(", T[i]), ...comma(ps, here),
               wtok(")", T[close]), wtok("{", last));
      kids();
      out.push(wtok("}", last));
      return;
    }

    // `const` also heads a const field and a const local, which have no initialiser. Only the
    // form with a top-level `=` is a module constant.
    case "const": {
      const eq = idx(T, "=");
      if (eq < 0) break;
      const colon = idx(T, ":");
      out.push(...M, conv(T[0]), ...typ(T.slice(colon + 1, eq)), conv(T[1]), conv(T[eq]),
               ...ex(T.slice(eq + 1)), wtok(";", last));
      return;
    }

    case "if":
    case "elif":
      if (head === "elif") out.push(wtok("}", here), wtok("else", here));
      out.push(wtok("if", here), wtok("(", here), ...ex(T.slice(1, T.length - 1)),
               wtok(")", last), wtok("{", last));
      kids();
      return;                                        // closed by emitAll's lookahead

    case "else":
      out.push(wtok("}", here), wtok("else", here), wtok("{", last));
      kids();
      return;

    case "do":
      out.push(wtok("do", here), wtok("{", last));
      kids();
      return;                                        // closed by the `while` tail

    case "while":
      // A `while` with no trailing colon is a `do` tail, and its brace is already open.
      if (last.t !== ":") {
        out.push(wtok("}", here), wtok("while", here), wtok("(", here), ...ex(T.slice(1)),
                 wtok(")", last), wtok(";", last));
        return;
      }
      out.push(wtok("while", here), wtok("(", here), ...ex(T.slice(1, T.length - 1)),
               wtok(")", last), wtok("{", last));
      kids();
      out.push(wtok("}", last));
      return;

    case "for": {
      const body = T.slice(1, T.length - 1);
      const inAt = idx(body, "in");
      out.push(wtok("for", here), wtok("(", here));
      if (inAt >= 0 && body[inAt + 1]?.t === "range") {
        const colon = idx(body.slice(0, inAt), ":");
        const nameToks = colon >= 0 ? body.slice(0, colon) : body.slice(0, inAt);
        const ty = colon >= 0 ? typ(body.slice(colon + 1, inAt)) : [wtok("i32", body[0])];
        const close = matching(body, inAt + 2, "(", ")");
        const args = splitTop(body.slice(inAt + 3, close)).map(ex);
        const nm = () => nameToks.map(conv);
        out.push(...ty, ...nm(), wtok("=", body[0]), ...args[0], wtok(";", body[0]),
                 ...nm(), wtok("<", body[0]), ...args[1], wtok(";", body[0]));
        if (args[2]) out.push(...nm(), wtok("+=", body[0]), ...args[2]);
        else out.push(...nm(), wtok("++", body[0]));
      } else {
        // The explicit three-clause form, for a loop that is not a counted range.
        const parts = splitTop(body, ";");
        const at = body[0] ?? here;
        out.push(...(parts[0]?.length ? stmtTokens(parts[0]) : []), wtok(";", at));
        out.push(...(parts[1]?.length ? ex(parts[1]) : []), wtok(";", at));
        out.push(...(parts[2]?.length ? stmtTokens(parts[2]) : []));
      }
      out.push(wtok(")", last), wtok("{", last));
      kids();
      out.push(wtok("}", last));
      return;
    }

    case "match":
    case "switch": {
      out.push(wtok(head, here), wtok("(", here), ...ex(T.slice(1, T.length - 1)),
               wtok(")", last), wtok("{", last));
      for (const c of n.kids) {
        if (!c.toks.length) continue;
        const pat = c.toks.slice(1, c.toks.length - 1);
        const cl = c.toks[c.toks.length - 1];
        if (head === "switch") {
          const isDefault = pat.length === 1 && pat[0].t === "_";
          out.push(isDefault ? wtok("default", c.toks[0]) : wtok("case", c.toks[0]));
          if (!isDefault) out.push(...ex(pat));
          out.push(wtok(":", cl), wtok("{", cl));
          emitAll(c.kids, out);
          out.push(wtok("}", cl));
        } else {
          // A match arm is a variant name and bindings, never an expression.
          const isElse = pat.length === 1 && pat[0].t === "else";
          out.push(isElse ? wtok("else", c.toks[0]) : wtok("case", c.toks[0]));
          if (!isElse) out.push(...pat.map(conv));
          out.push(wtok(":", cl));
          emitAll(c.kids, out);
        }
      }
      out.push(wtok("}", last));
      return;
    }

    case "return":
      out.push(wtok("return", here), ...(T.length > 1 ? ex(T.slice(1)) : []), wtok(";", last));
      return;
    case "break":    out.push(wtok("break", here), wtok(";", last)); return;
    case "continue": out.push(wtok("continue", here), wtok(";", last)); return;
    case "trap":
      out.push(wtok("trap", here), ...(T.length > 3 ? ex(T.slice(2, T.length - 1)) : []),
               wtok(";", last));
      return;

    // An empty wac block needs nothing — but `pass` is also an ordinary variable name.
    case "pass":
      if (T.length === 1) return;
      break;

    // A bare block, which Python cannot express and wac uses for scoping.
    case "scope":
      out.push(wtok("{", here));
      kids();
      out.push(wtok("}", last));
      return;
  }

  out.push(...stmtTokens(T), wtok(";", last));
}

function foldMods(nodes: Node[]): { node: Node; mods: string[] }[] {
  const out: { node: Node; mods: string[] }[] = [];
  let mods: string[] = [];
  for (const n of nodes) {
    const m = modifierOf(n);
    if (m) { mods.push(m); continue; }
    out.push({ node: n, mods });
    mods = [];
  }
  return out;
}

/**
 * A run of siblings.
 *
 * The one subtlety is the if/elif/else chain: each arm opens a brace and leaves it open,
 * because only the *next* sibling knows whether the chain continues.
 */
function emitAll(nodes: Node[], out: Token[]): void {
  const items = foldMods(nodes);
  items.forEach(({ node, mods }, i) => {
    emit(node, out, mods);
    const h = node.toks[0]?.t;
    if (h === "if" || h === "elif" || h === "else") {
      const nh = items[i + 1]?.node.toks[0]?.t;
      if (nh !== "elif" && nh !== "else") out.push(wtok("}", node.toks[node.toks.length - 1]));
    }
  });
}

// ── The frontend ─────────────────────────────────────────────────────────────

/** wapy source to wac tokens, each carrying the position it was written at. */
export function tokensOf(src: string): Token[] {
  const out: Token[] = [];
  emitAll(readTree(src), out);
  out.push({ kind: "eof", text: "", line: src.split("\n").length, col: 1 });
  return out;
}

/** wapy source to wac's AST, with positions pointing into the wapy source. */
export function parseWapy(src: string, path: string): { program: Program; errors: ParseError[] } {
  return wacParse(tokensOf(src), path);
}

if (import.meta.main) {
  if (Deno.args.length === 0) { console.error("usage: wapyRead.ts <file.wapy>"); Deno.exit(2); }
  for (const p of Deno.args) {
    const { program, errors } = parseWapy(await Deno.readTextFile(p), p);
    for (const e of errors) console.error(`${e.file}:${e.line}:${e.col} ${e.message}`);
    if (errors.length) Deno.exit(1);
    console.log(JSON.stringify(program, null, 2));
  }
}
