// wapy's lexer.
//
// wapy is wac with an indentation-based surface. It is not a subset of Python, does not accept
// Python, and is not trying to — see `spec/spec/wapy.md`. It is a second *frontend* for the
// same language: same AST, same resolver, same checker, same emitter.
//
// ## What this does that `wacLex` does not
//
// **Significant indentation.** Physical lines are grouped into a tree by leading whitespace, so
// the parser sees blocks without brace tokens. Indentation errors — a tab where the file uses
// spaces, a dedent to a column no enclosing block sits at — are lexical errors here, reported
// against the line that has them.
//
// **Comments are kept.** wac drops them at lex time. A wapy line carries any trailing comment,
// so a formatter can put it back.
//
// ## What it deliberately does not do
//
// It does not rewrite `and` into `&&`. Every token keeps the text the author wrote, and the
// *kind* is the shared one, so the parser below matches on kind and every diagnostic quotes
// what was actually typed. An earlier attempt substituted the text and produced errors about
// operators nobody had written.

import { KEYWORDS, type Token, type TokenKind } from "./wacLex.ts";

export type WapyError = { message: string; file: string; line: number; col: number; hint?: string };

/** One physical line: its tokens, its indentation, and anything trailing after a `#`. */
export type Line = {
  indent: number;
  tokens: Token[];
  comment: string;
  line: number;
};

/** A line and the lines indented under it. */
export type Block = { head: Line; body: Block[] };

const PUNCT = [
  "as!", "as~", "as@", ">>>=", "<<=", ">>=", ">>>", "&&", "||", "==", "!=", "<=", ">=",
  "<<", ">>", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "->",
  "{", "}", "(", ")", "[", "]", ",", ";", ":", ".", "?", "!", "+", "-", "*", "/", "%",
  "<", ">", "=", "&", "|", "^", "~", "@",
];

/**
 * Words wapy spells differently from wac.
 *
 * The *kind* is wac's, so the shared expression parser matches on it unchanged; the *text*
 * stays as written, so a diagnostic quotes `and` rather than `&&`. Whether one of these is a
 * keyword or an ordinary identifier is decided by position in `wapyParse`, because every one of
 * them is also a legal wac identifier — `slice(a, from, to)` is real code in the packages.
 */
export const SPELLINGS = new Map<string, TokenKind>([
  ["and", "&&"], ["or", "||"], ["not", "!"],
  ["None", "null"], ["True", "true"], ["False", "false"],
]);

/**
 * **`self` was here until 2026-08-27, mapped to `this`.** wapy spells the receiver `this` now, the
 * same as wac, and `self` is an ordinary identifier again.
 *
 * It was the one respelling that cost something. A wac local named `self` had *no wapy rendering* —
 * `issues/lang/0077` — so `packages/wacc/src/check.wac` could not name a local `self`, and a comment
 * beside that local said why. The printer round-trips every file in the repository on each suite
 * run, which made a reserved word in one surface into a rule about identifiers in the other.
 *
 * `and`/`or`/`not`/`None`/`True`/`False` do not have that problem: each is a wapy *keyword* whose wac
 * form is punctuation or a literal, so no wac identifier collides with one. `self` was different
 * because both surfaces were spelling the same *keyword* two ways for the sake of looking Pythonic,
 * and the cost landed on wac.
 */

/**
 * Words wac reserves that wapy spells differently.
 *
 * Reserved in wapy too, so `return true` is a spelling mistake with a spelling mistake's
 * diagnostic rather than an unresolved identifier reported three phases later.
 */
const MISSPELLED = new Map<string, string>([
  ["true", "True"], ["false", "False"], ["null", "None"],
]);

/**
 * Kinds a token may take when it is a plain word, before position is considered.
 *
 * wapy's own spellings first, then wac's keywords — which wapy reserves unchanged, because the
 * two surfaces share a vocabulary. A word in neither set is an identifier; that includes
 * wapy's structural words (`def`, `class`, `elif`, `pass`, `from`), which are matched by text
 * where they mean something and are ordinary names everywhere else.
 */
function wordKind(text: string): TokenKind {
  return SPELLINGS.get(text) ?? ((KEYWORDS.has(text) ? text : "ident") as TokenKind);
}

export function wapyLex(src: string, file: string): { lines: Line[]; errors: WapyError[] } {
  const errors: WapyError[] = [];
  const lines: Line[] = [];

  src.split("\n").forEach((raw, i) => {
    const lineNo = i + 1;
    if (raw.trim() === "") return;

    const lead = raw.length - raw.trimStart().length;
    if (raw.slice(0, lead).includes("\t")) {
      errors.push({
        message: "a tab in the indentation",
        file, line: lineNo, col: 1,
        hint: "wapy measures indentation in columns, so a tab makes the depth depend on how it is displayed. Use spaces.",
      });
    }

    const { tokens, comment, errs } = lexLine(raw, lineNo, file);
    errors.push(...errs);
    lines.push({ indent: lead, tokens, comment, line: lineNo });
  });

  return { lines: joined(lines, errors, file), errors };
}

const OPEN = new Set<string>(["(", "[", "{"]);
const SHUT = new Set<string>([")", "]", "}"]);

/**
 * Join a line to the next while a bracket is still open.
 *
 * Python's implicit continuation, and for the same reason: the alternative is that a statement
 * is a physical line, which makes a multi-line match expression or a long argument list
 * unwritable. There is no backslash form — if the expression is not inside brackets there is
 * nothing to continue, and a statement that wants to wrap can always be parenthesised.
 *
 * Every token keeps the line and column it was written at, so a diagnostic inside a
 * continuation points at the physical line rather than at the one that opened the bracket.
 * Only the *statement* takes the first line's indent and number, which is what block grouping
 * needs.
 */
function joined(lines: Line[], errors: WapyError[], file: string): Line[] {
  const out: Line[] = [];
  for (let i = 0; i < lines.length; i++) {
    let cur = lines[i];
    let depth = bracketDepth(cur.tokens);
    while (depth > 0 && i + 1 < lines.length) {
      const next = lines[++i];
      cur = {
        ...cur,
        tokens: [...cur.tokens, ...next.tokens],
        // The last comment written wins, because it is the one nearest the statement's end.
        comment: next.comment || cur.comment,
      };
      depth += bracketDepth(next.tokens);
    }
    if (depth > 0) {
      const last = cur.tokens[cur.tokens.length - 1];
      errors.push({
        message: "a bracket is still open at the end of the file",
        file, line: last?.line ?? cur.line, col: last?.col ?? 1,
      });
    }
    out.push(cur);
  }
  return out;
}

function bracketDepth(tokens: Token[]): number {
  let d = 0;
  for (const t of tokens) {
    if (OPEN.has(t.kind)) d++;
    else if (SHUT.has(t.kind)) d--;
  }
  return d;
}

function lexLine(
  raw: string,
  lineNo: number,
  file: string,
): { tokens: Token[]; comment: string; errs: WapyError[] } {
  const tokens: Token[] = [];
  const errs: WapyError[] = [];
  let comment = "";
  let i = 0;
  const push = (kind: TokenKind, text: string, col: number) =>
    tokens.push({ kind, text, line: lineNo, col });

  while (i < raw.length) {
    const c = raw[i];
    const col = i + 1;
    if (c === " " || c === "\t") { i++; continue; }
    if (c === "#") { comment = raw.slice(i); break; }

    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < raw.length && raw[j] !== c) j += raw[j] === "\\" ? 2 : 1;
      if (j >= raw.length) {
        errs.push({ message: "unterminated string", file, line: lineNo, col });
        push("string", raw.slice(i + 1), col);
        i = raw.length;
        continue;
      }
      push("string", unescape(raw.slice(i + 1, j)), col);
      i = j + 1;
      continue;
    }

    if (/[0-9]/.test(c)) {
      const m = /^(0[xX][0-9a-fA-F_]+|[0-9][0-9_]*(\.[0-9_]+)?([eE][+-]?[0-9]+)?)/.exec(raw.slice(i))!;
      // Hex first: `0xEDB88320` has an `E` in it, and an exponent test alone calls it a float.
      const hex = /^0[xX]/.test(m[0]);
      push(!hex && (m[0].includes(".") || /[eE]/.test(m[0])) ? "float" : "int", m[0], col);
      i += m[0].length;
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(raw.slice(i))!;
      // A checked cast is a word glued to a sigil; the identifier rule would split it.
      if (m[0] === "as" && "!~@".includes(raw[i + 2] ?? "")) {
        push(`as${raw[i + 2]}` as TokenKind, `as${raw[i + 2]}`, col);
        i += 3;
        continue;
      }
      const spelled = MISSPELLED.get(m[0]);
      if (spelled) errs.push({ message: `wapy spells this \`${spelled}\``, file, line: lineNo, col });
      push(wordKind(m[0]), m[0], col);
      i += m[0].length;
      continue;
    }

    const p = PUNCT.find((q) => raw.startsWith(q, i));
    if (!p) {
      errs.push({ message: `unexpected character '${c}'`, file, line: lineNo, col });
      i++;
      continue;
    }
    push(p as TokenKind, p, col);
    i += p.length;
  }

  return { tokens, comment, errs };
}

/**
 * A string literal's escapes, undone.
 *
 * **`\uXXXX` is here because the printer writes it.** `wapyPrint` renders a string with
 * `JSON.stringify`, which escapes every control character that way — so a wac string holding a NUL
 * came back as the four letters `u0000`, silently, and only the round trip over the packages noticed
 * (wac 0077's neighbour: `packages/fs`'s image magic is `"wacimg\u0000"`). Dropping the backslash
 * from an escape nobody handled is the wrong default for exactly this reason: it turns a mistake into
 * different text rather than into an error.
 */
function unescape(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})|\\(.)/g, (_, hex: string | undefined, c: string) =>
    hex !== undefined
      ? String.fromCharCode(parseInt(hex, 16))
      : c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c === "0" ? "\0" : c);
}

/**
 * Group lines into a tree by indentation.
 *
 * A dedent must land on a column some enclosing block already sits at; anything else is a
 * mistake the author will not otherwise be told about, because the line would silently attach
 * to a level they did not intend.
 */
export function blocks(lines: Line[], file: string): { tree: Block[]; errors: WapyError[] } {
  const errors: WapyError[] = [];
  const roots: Block[] = [];
  const stack: { indent: number; block: Block }[] = [];

  for (const line of lines) {
    while (stack.length && stack[stack.length - 1].indent >= line.indent) stack.pop();

    const parent = stack[stack.length - 1];
    if (parent && line.indent <= parent.indent) {
      errors.push({ message: "inconsistent indentation", file, line: line.line, col: 1 });
    }
    const block: Block = { head: line, body: [] };
    (parent ? parent.block.body : roots).push(block);
    // A comment-only line never opens a block.
    if (line.tokens.length) stack.push({ indent: line.indent, block });
  }

  return { tree: roots, errors };
}
