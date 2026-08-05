#!/usr/bin/env -S deno run --allow-read
// wapyRead — turn wapy back into wac source.
//
//   deno run --allow-read tools/wapyRead.ts file.wapy
//
// ## Why this is a source-to-source pass and not a second parser
//
// wapy is a *cosmetic* surface, so the only differences from wac are lexical and structural:
// indentation instead of braces, `name: T` instead of `T name`, a handful of substituted
// words. Nothing about scoping, typing or evaluation differs. That means the honest
// implementation reassembles wac *text* and hands it to `wacParse` — the real parser stays the
// only parser, and there is no second grammar to keep in step.
//
// The alternative would be a full recursive-descent parser producing the AST directly, which
// is roughly `wacParse`'s 1,573 lines duplicated. It would also be the thing that makes a
// second syntax expensive forever: two grammars, two sets of diagnostics, every new language
// feature implemented twice. A text pass cannot drift in that way, because it has no opinion
// about anything it does not rewrite.
//
// ## What makes the reverse direction possible
//
// Every word the printer substitutes is also a legal wac identifier, so the reversal has to be
// positional rather than a lookup. That works because wac's grammar is unambiguous about
// operand versus operator position:
//
//   `a and b`      `and` follows a complete operand, so it is the operator
//   `f(and)`       `and` is where an operand is expected, so it is an identifier
//   `case None:`   pattern position, so it is a variant name
//   `x = None`     operand position with no `.` before it, so it is the null literal
//
// Measured against wac-mono with comments and strings stripped: no bare use of `and`, `or`,
// `True`, `False` or `self`; every `not` belongs to `is not null`; `None` appears only as a
// variant name. The genuine collisions are `pass` and `range` used as ordinary variables, both
// of which only matter in positions the printer never emits them in.

import { wacLex } from "../atoms/wac/wacLex.ts";
import { wacParse, type Program } from "../atoms/wac/wacParse.ts";

// ── Tokens ───────────────────────────────────────────────────────────────────

type Tok = { t: string; kind: "id" | "num" | "str" | "punct" };

const PUNCT = [
  "as!", "as~", "as@", ">>>=", "<<=", ">>=", ">>>", "&&", "||", "==", "!=", "<=", ">=",
  "<<", ">>", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "->",
  "{", "}", "(", ")", "[", "]", ",", ";", ":", ".", "?", "!", "+", "-", "*", "/", "%",
  "<", ">", "=", "&", "|", "^", "~", "@",
];

/** Tokenise one line. `#` starts a comment, except inside a string. */
function lex(line: string): { toks: Tok[]; comment: string } {
  const toks: Tok[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c === "#") return { toks, comment: line.slice(i) };

    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== c) j += line[j] === "\\" ? 2 : 1;
      toks.push({ t: line.slice(i, j + 1), kind: "str" });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^(0[xXbBoO][0-9a-fA-F_]+|[0-9][0-9_]*(\.[0-9_]+)?([eE][+-]?[0-9]+)?)/.exec(line.slice(i))!;
      toks.push({ t: m[0], kind: "num" });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(i))!;
      // The checked casts are a word glued to a sigil, and the identifier rule would win the
      // race against PUNCT and split them.
      if (m[0] === "as" && "!~@".includes(line[i + 2] ?? "")) {
        toks.push({ t: `as${line[i + 2]}`, kind: "punct" });
        i += 3;
        continue;
      }
      toks.push({ t: m[0], kind: "id" });
      i += m[0].length;
      continue;
    }
    const p = PUNCT.find((q) => line.startsWith(q, i));
    if (p) { toks.push({ t: p, kind: "punct" }); i += p.length; continue; }
    toks.push({ t: c, kind: "punct" });
    i++;
  }
  return { toks, comment: "" };
}

// ── Lines and blocks ─────────────────────────────────────────────────────────

type Node = { indent: number; toks: Tok[]; comment: string; kids: Node[]; raw: string };

function readTree(src: string): Node[] {
  const flat: Node[] = [];
  for (const raw of src.split("\n")) {
    if (raw.trim() === "") continue;
    const indent = raw.length - raw.trimStart().length;
    const { toks, comment } = lex(raw);
    flat.push({ indent, toks, comment, kids: [], raw });
  }
  // Nest by indentation. A comment-only line does not open a block, so it never becomes a
  // parent — it attaches as a sibling and is emitted verbatim.
  const roots: Node[] = [];
  const stack: Node[] = [];
  for (const n of flat) {
    while (stack.length && stack[stack.length - 1].indent >= n.indent) stack.pop();
    (stack.length ? stack[stack.length - 1].kids : roots).push(n);
    if (n.toks.length) stack.push(n);
  }
  return roots;
}

// ── Token-level rewriting ────────────────────────────────────────────────────

const ENDS_OPERAND = new Set([")", "]", "!", "}"]);

/** Does the token before position `i` complete an operand? */
function afterOperand(toks: Tok[], i: number): boolean {
  if (i === 0) return false;
  const p = toks[i - 1];
  if (p.kind === "num" || p.kind === "str") return true;
  if (p.kind === "punct") return ENDS_OPERAND.has(p.t);
  // An identifier ends an operand unless it is itself one of the words we substitute.
  return !["and", "or", "not", "is", "in", "if", "else", "case", "return", "match", "switch",
           "while", "for", "trap", "scope"].includes(p.t);
}

/** Reverse the printer's word substitutions, positionally. */
function words(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const prevDot = i > 0 && toks[i - 1].t === ".";
    // After `case`, an identifier is a variant name, not a value — `case None:` in a match
    // expression is the `None` variant and must not become the null literal.
    const prevCase = i > 0 && toks[i - 1].t === "case";
    if (t.kind === "id" && !prevDot && !prevCase) {
      if (t.t === "and" && afterOperand(toks, i)) { out.push({ t: "&&", kind: "punct" }); continue; }
      if (t.t === "or" && afterOperand(toks, i)) { out.push({ t: "||", kind: "punct" }); continue; }
      // `not` is the prefix operator only where an operand is expected — and never when it is
      // the `not` of `is not`, which wac spells the same way.
      if (t.t === "not" && !afterOperand(toks, i) && !(i > 0 && toks[i - 1].t === "is")) {
        out.push({ t: "!", kind: "punct" });
        continue;
      }
      if (t.t === "None" && !afterOperand(toks, i)) { out.push({ t: "null", kind: "id" }); continue; }
      if (t.t === "True")  { out.push({ t: "true", kind: "id" }); continue; }
      if (t.t === "False") { out.push({ t: "false", kind: "id" }); continue; }
      if (t.t === "self")  { out.push({ t: "this", kind: "id" }); continue; }
    }
    out.push(t);
  }
  return out;
}

/** `(X if C else Y)` → `(C ? X : Y)`, innermost first. The printer always parenthesises. */
function ternaries(toks: Tok[]): Tok[] {
  for (let open = toks.length - 1; open >= 0; open--) {
    if (toks[open].t !== "(") continue;
    let depth = 0, close = -1;
    for (let j = open; j < toks.length; j++) {
      if (toks[j].t === "(") depth++;
      else if (toks[j].t === ")") { depth--; if (depth === 0) { close = j; break; } }
    }
    if (close < 0) continue;
    // Find `if` and `else` at depth 1 inside this group.
    let d = 0, ifAt = -1, elseAt = -1;
    for (let j = open + 1; j < close; j++) {
      const s = toks[j].t;
      if (s === "(" || s === "[") d++;
      else if (s === ")" || s === "]") d--;
      else if (d === 0 && s === "if" && ifAt < 0) ifAt = j;
      else if (d === 0 && s === "else" && ifAt >= 0 && elseAt < 0) elseAt = j;
    }
    if (ifAt < 0 || elseAt < 0) continue;
    const then = toks.slice(open + 1, ifAt);
    const cond = toks.slice(ifAt + 1, elseAt);
    const els = toks.slice(elseAt + 1, close);
    const rebuilt: Tok[] = [
      toks[open], ...cond, { t: "?", kind: "punct" }, ...then, { t: ":", kind: "punct" },
      ...els, toks[close],
    ];
    return ternaries([...toks.slice(0, open), ...rebuilt, ...toks.slice(close + 1)]);
  }
  return toks;
}

/** A match *expression* keeps its braces but wac parenthesises the subject. */
function matchExprs(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].t === "match" && !afterOperand(toks, i)) {
      // `match SUBJ {` → `match (SUBJ) {`
      let j = i + 1, d = 0;
      while (j < toks.length && !(d === 0 && toks[j].t === "{")) {
        if ("([".includes(toks[j].t)) d++;
        else if (")]".includes(toks[j].t)) d--;
        j++;
      }
      if (j < toks.length) {
        out.push(toks[i], { t: "(", kind: "punct" }, ...toks.slice(i + 1, j),
                 { t: ")", kind: "punct" });
        i = j - 1;
        continue;
      }
    }
    out.push(toks[i]);
  }
  return out;
}

function text(toks: Tok[]): string {
  let s = "";
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i].t, prev = i > 0 ? toks[i - 1].t : "";
    const tight = t === "," || t === ";" || t === ")" || t === "]" || t === "." || t === "!" ||
      t === "(" && (toks[i - 1]?.kind === "id" || prev === ")" || prev === "]") ||
      t === "[" && (toks[i - 1]?.kind === "id" || prev === ")" || prev === "]");
    const prevTight = prev === "" || prev === "(" || prev === "[" || prev === "." ||
      prev === "!" || prev === "~" || prev === "@";
    s += (tight || prevTight ? "" : " ") + t;
  }
  return s;
}

/**
 * Named arguments: wapy writes `Point(y=4.0)` and `i32[3](fill=-1)`; wac spells both with a
 * colon. Recognised by position rather than by name — inside a bracket, an identifier that
 * follows `(` or `,` and is followed by a bare `=` is a named argument. Statement-level
 * assignments are at depth zero, so they cannot be confused with one.
 */
function namedArgs(toks: Tok[]): Tok[] {
  let out = [...toks];
  // Innermost-first, so nested constructions are rewritten before their enclosing one.
  for (let open = out.length - 1; open >= 0; open--) {
    if (out[open].t !== "(") continue;
    let d = 0, close = -1;
    for (let j = open; j < out.length; j++) {
      if (out[j].t === "(") d++;
      else if (out[j].t === ")") { d--; if (!d) { close = j; break; } }
    }
    if (close < 0 || close === open + 1) continue;

    const parts = splitTop(out.slice(open + 1, close));
    const allNamed = parts.length > 0 && parts.every((p) =>
      p.length >= 2 && p[0].kind === "id" && p[1].t === "=");
    if (!allNamed) continue;

    const colonised = parts.map((p) =>
      [p[0], { t: ":", kind: "punct" as const }, ...p.slice(2)]);
    const joined: Tok[] = [];
    colonised.forEach((p, i) => { if (i) joined.push({ t: ",", kind: "punct" }); joined.push(...p); });

    // A sized array is `T[n](fill: v)` and keeps its parentheses; a struct literal is
    // `Point { y: 4.0 }` and takes braces. The `]` before the paren is what tells them apart.
    const isArray = out[open - 1]?.t === "]";
    const openTok: Tok = { t: isArray ? "(" : "{", kind: "punct" };
    const closeTok: Tok = { t: isArray ? ")" : "}", kind: "punct" };
    out = [...out.slice(0, open), openTok, ...joined, closeTok, ...out.slice(close + 1)];
  }
  return out;
}

/** Rewrite an expression token run into wac. */
function ex(toks: Tok[]): string {
  return text(namedArgs(matchExprs(ternaries(words(toks)))));
}

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A type token run into wac: `T | None` → `T?`, and `Name[args]` → `Name<args>` for a generic
 * (but not for `fn[...]`, and not for the empty `[]` of an array).
 */
function typ(toks: Tok[]): string {
  let ts = [...toks];
  let nullable = false;
  if (ts.length >= 2 && ts[ts.length - 1].t === "None" && ts[ts.length - 2].t === "|") {
    ts = ts.slice(0, -2);
    nullable = true;
  }
  // `Name[args]` is a generic reference and becomes `Name<args>`; `T[]` is an array and stays;
  // `fn[...]` is wac's own funcref syntax and stays. Every depth, because generics nest —
  // `Map[string, Vec[i32]]`.
  const out: Tok[] = ts.map((t) => ({ ...t }));
  for (let i = 0; i < out.length; i++) {
    if (out[i].t !== "[") continue;
    const prev = out[i - 1];
    if (!prev || prev.kind !== "id" || prev.t === "fn") continue;
    if (out[i + 1]?.t === "]") continue;                     // an array, not a generic
    let d = 0, j = i;
    for (; j < out.length; j++) {
      if (out[j].t === "[") d++;
      else if (out[j].t === "]") { d--; if (!d) break; }
    }
    if (j >= out.length) continue;
    out[i] = { t: "<", kind: "punct" };
    out[j] = { t: ">", kind: "punct" };
  }
  return text(out) + (nullable ? "?" : "");
}

// ── Statements and declarations ──────────────────────────────────────────────

// `@export` lexes as `@` then `export`, so the lookup is on the word after the at-sign.
const MODIFIERS = new Map([["export", "export "], ["const", "const "], ["override", "override "]]);

function modifierOf(n: Node): string | undefined {
  return n.toks.length === 2 && n.toks[0].t === "@" ? MODIFIERS.get(n.toks[1].t) : undefined;
}

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

/** `name: T` / `const name: T` → `T name` / `const T name`. Also `self` forms. */
function param(toks: Tok[]): string {
  let ts = toks, pre = "";
  if (ts[0]?.t === "const") { pre = "const "; ts = ts.slice(1); }
  if (ts.length === 1 && ts[0].t === "self") return pre + "this";
  const colon = idx(ts, ":");
  if (colon < 0) return pre + text(ts);
  return `${pre}${typ(ts.slice(colon + 1))} ${text(ts.slice(0, colon))}`;
}

function splitTop(toks: Tok[]): Tok[][] {
  const parts: Tok[][] = [];
  let cur: Tok[] = [], d = 0;
  for (const t of toks) {
    if ("([{".includes(t.t)) d++;
    else if (")]}".includes(t.t)) d--;
    if (d === 0 && t.t === ",") { parts.push(cur); cur = []; continue; }
    cur.push(t);
  }
  if (cur.length) parts.push(cur);
  return parts;
}

/** `#` was a line comment and `##` a doc comment; restore wac's spelling. */
function commentLine(c: string, pad: string): string[] {
  if (c.startsWith("##")) return [`${pad}/** ${c.slice(2).trim()} */`];
  return [`${pad}// ${c.slice(1).trim()}`.trimEnd()];
}

function emit(n: Node, out: string[], ind: string, mods: string): void {
  const T = n.toks;
  // A comment-only line.
  if (T.length === 0) {
    if (n.comment) out.push(...commentLine(n.comment, ind));
    return;
  }
  const head = T[0].t;
  const pad = ind;

  switch (head) {
    // `from` is also an ordinary identifier in wac — `slice(a, from, to)` is real code — so a
    // line beginning with it is an import only when it has the whole shape.
    case "from": {
      const imp = idx(T, "import");
      if (!(T[1]?.kind === "str" && imp === 2)) break;
      const items = splitTop(T.slice(imp + 1)).map((p) => text(p));
      out.push(`${pad}import { ${items.join(", ")} } from ${T[1].t};`);
      return;
    }

    case "class": {
      const name = T[1].t;
      let i = 2, gen = "", base = "", isEnum = false;
      if (T[i]?.t === "[") {
        let d = 0, j = i;
        for (; j < T.length; j++) { if (T[j].t === "[") d++; else if (T[j].t === "]") { d--; if (!d) break; } }
        gen = `<${text(T.slice(i + 1, j))}>`;
        i = j + 1;
      }
      if (T[i]?.t === "(") {
        let d = 0, j = i;
        for (; j < T.length; j++) { if (T[j].t === "(") d++; else if (T[j].t === ")") { d--; if (!d) break; } }
        const inner = text(T.slice(i + 1, j));
        if (inner === "enum") isEnum = true; else base = ` : ${inner}`;
      }
      out.push(`${pad}${mods}${isEnum ? "enum" : "struct"} ${name}${gen}${base} {`);
      if (isEnum) {
        // Variants are the leading children that are not `def`; wac wants them comma-joined.
        const vs = n.kids.filter((k) => k.toks.length && k.toks[0].t !== "def" && !modifierOf(k));
        const ms = n.kids.filter((k) => !k.toks.length || k.toks[0].t === "def" || modifierOf(k));
        if (vs.length) {
          out.push(`${pad}  ${vs.map((v) => variant(v)).join(", ")}`);
        }
        emitAll(ms, out, pad + "  ");
      } else {
        emitAll(n.kids, out, pad + "  ");
      }
      out.push(`${pad}}`);
      return;
    }

    case "def": {
      const name = T[1].t;
      let i = 2, gen = "";
      if (T[i]?.t === "[") {
        let d = 0, j = i;
        for (; j < T.length; j++) { if (T[j].t === "[") d++; else if (T[j].t === "]") { d--; if (!d) break; } }
        gen = `<${text(T.slice(i + 1, j))}>`;
        i = j + 1;
      }
      // params
      let d = 0, close = i;
      for (; close < T.length; close++) {
        if (T[close].t === "(") d++;
        else if (T[close].t === ")") { d--; if (!d) break; }
      }
      const ps = splitTop(T.slice(i + 1, close)).map(param);
      const arrow = idx(T, "->", close + 1);
      const colon = T.length - 1;
      const ret = arrow >= 0 ? typ(T.slice(arrow + 1, colon)) : "void";
      out.push(`${pad}${mods}${ret} ${name}${gen}(${ps.join(", ")}) {`);
      emitAll(n.kids, out, pad + "  ");
      out.push(`${pad}}`);
      return;
    }

    // `const` also heads a const *field* and a const *local*, which have no initialiser and
    // no module-level `export`. Only the form with a top-level `=` is a module constant.
    case "const": {
      const eq = idx(T, "=");
      if (eq < 0) break;
      const colon = idx(T, ":");
      out.push(`${pad}${mods}const ${typ(T.slice(colon + 1, eq))} ${T[1].t} = ${ex(T.slice(eq + 1))};`);
      return;
    }

    case "if":
    case "elif": {
      const kw = head === "if" ? "if" : "} else if";
      out.push(`${pad}${kw} (${ex(T.slice(1, T.length - 1))}) {`);
      emitAll(n.kids, out, pad + "  ");
      // The closing brace is emitted by the next elif/else, or here if there is none.
      return;
    }
    case "else":
      out.push(`${pad}} else {`);
      emitAll(n.kids, out, pad + "  ");
      return;

    case "do":
      out.push(`${pad}do {`);
      emitAll(n.kids, out, pad + "  ");
      // The closer needs the condition, which lives on the next sibling; `emitAll` supplies it.
      return;

    case "while":
      // A `while` with no trailing colon is the tail of a `do`, and its brace was already
      // opened. One with a colon is an ordinary loop.
      if (T[T.length - 1].t !== ":") {
        out.push(`${pad}} while (${ex(T.slice(1))});`);
        return;
      }
      out.push(`${pad}while (${ex(T.slice(1, T.length - 1))}) {`);
      emitAll(n.kids, out, pad + "  ");
      out.push(`${pad}}`);
      return;

    case "for": {
      const body = T.slice(1, T.length - 1);   // drop `for` and the trailing `:`
      const inAt = idx(body, "in");
      if (inAt >= 0 && body[inAt + 1]?.t === "range") {
        let nm = text(body.slice(0, inAt)), ty0 = "i32";
        const c = idx(body.slice(0, inAt), ":");
        if (c >= 0) { ty0 = typ(body.slice(c + 1, inAt)); nm = text(body.slice(0, c)); }
        let d = 0, close = inAt + 2;
        for (; close < body.length; close++) {
          if (body[close].t === "(") d++;
          else if (body[close].t === ")") { d--; if (!d) break; }
        }
        const args = splitTop(body.slice(inAt + 3, close)).map(ex);
        const step = args[2] ? `${nm} += ${args[2]}` : `${nm}++`;
        out.push(`${pad}for (${ty0} ${nm} = ${args[0]}; ${nm} < ${args[1]}; ${step}) {`);
      } else {
        // The explicit three-clause form.
        const parts = splitSemis(body);
        const init = parts[0].length ? stmtText(parts[0]) : "";
        const cond = parts[1]?.length ? ex(parts[1]) : "";
        const upd = parts[2]?.length ? stmtText(parts[2]) : "";
        out.push(`${pad}for (${init}; ${cond}; ${upd}) {`);
      }
      emitAll(n.kids, out, pad + "  ");
      out.push(`${pad}}`);
      return;
    }

    case "match":
    case "switch": {
      out.push(`${pad}${head} (${ex(T.slice(1, T.length - 1))}) {`);
      for (const c of n.kids) {
        const pat = c.toks.slice(1, c.toks.length - 1);
        const label = head === "switch"
          ? (pat.length === 1 && pat[0].t === "_" ? "default" : `case ${ex(pat)}`)
          : (pat.length === 1 && pat[0].t === "else" ? "else" : `case ${text(pat)}`);
        // A switch case needs a block; a match arm takes bare statements.
        if (head === "switch") {
          out.push(`${pad}  ${label}: {`);
          emitAll(c.kids, out, pad + "    ");
          out.push(`${pad}  }`);
        } else {
          out.push(`${pad}  ${label}:`);
          emitAll(c.kids, out, pad + "    ");
        }
      }
      out.push(`${pad}}`);
      return;
    }

    case "return":
      out.push(`${pad}return${T.length > 1 ? " " + ex(T.slice(1)) : ""};`);
      return;
    case "break":    out.push(`${pad}break;`); return;
    case "continue": out.push(`${pad}continue;`); return;
    // An empty wac block needs nothing — but only when `pass` is the whole line. It is also
    // an ordinary variable name in `url` and `ssh`.
    case "pass":
      if (T.length === 1) return;
      break;
    case "trap":
      out.push(`${pad}trap${T.length > 3 ? " " + ex(T.slice(2, T.length - 1)) : ""};`);
      return;

    // A bare block, which Python cannot express and wac uses for scoping.
    case "scope":
      out.push(`${pad}{`);
      emitAll(n.kids, out, pad + "  ");
      out.push(`${pad}}`);
      return;
  }

  out.push(`${pad}${stmtText(T)};`);
}

function splitSemis(toks: Tok[]): Tok[][] {
  const parts: Tok[][] = [];
  let cur: Tok[] = [], d = 0;
  for (const t of toks) {
    if ("([{".includes(t.t)) d++;
    else if (")]}".includes(t.t)) d--;
    if (d === 0 && t.t === ";") { parts.push(cur); cur = []; continue; }
    cur.push(t);
  }
  parts.push(cur);
  return parts;
}

/** A declaration, assignment or expression statement, without its terminator. */
function stmtText(T: Tok[]): string {
  let pre = "", ts = T;
  if (ts[0]?.t === "const") { pre = "const "; ts = ts.slice(1); }
  const colon = idx(ts, ":");
  const eq = idx(ts, "=");
  // `name: T = e` is a declaration; a bare `:` with no `=` is a field.
  if (colon > 0 && ts[colon - 1].kind === "id" && (eq < 0 || colon < eq)) {
    const name = text(ts.slice(0, colon));
    const t = typ(ts.slice(colon + 1, eq < 0 ? ts.length : eq));
    return eq < 0 ? `${pre}${t} ${name}` : `${pre}${t} ${name} = ${ex(ts.slice(eq + 1))}`;
  }
  return pre + ex(ts);
}

function variant(n: Node): string {
  const T = n.toks;
  if (T.length === 1) return T[0].t;
  let d = 0, close = 1;
  for (; close < T.length; close++) {
    if (T[close].t === "(") d++;
    else if (T[close].t === ")") { d--; if (!d) break; }
  }
  return `${T[0].t}(${splitTop(T.slice(2, close)).map(param).join(", ")})`;
}

/** Decorators sit on their own lines above a declaration; fold them into it. */
function foldMods(nodes: Node[]): { node: Node; mods: string }[] {
  const out: { node: Node; mods: string }[] = [];
  let mods = "";
  for (const n of nodes) {
    const m = modifierOf(n);
    if (m) { mods += m; continue; }
    out.push({ node: n, mods });
    mods = "";
  }
  return out;
}

/**
 * Emit a run of siblings.
 *
 * The one subtlety is the if/elif/else chain: `emit` opens a brace for each arm and leaves it
 * open, because only the *next* sibling knows whether the chain continues. So the closer is
 * emitted here, where the lookahead is.
 */
function emitAll(nodes: Node[], out: string[], ind: string): void {
  const items = foldMods(nodes);
  let skipTo = -1;
  items.forEach(({ node, mods }, i) => {
    if (i < skipTo) return;
    // A run of `##` lines was one `/** … */` block. Rebuild it as one, or a five-line doc
    // comment comes back as five one-line ones.
    if (!node.toks.length && node.comment.startsWith("##")) {
      let j = i;
      while (j < items.length && !items[j].node.toks.length &&
             items[j].node.comment.startsWith("##")) j++;
      const body = items.slice(i, j).map((x) => x.node.comment.slice(2).trim());
      if (body.length === 1) out.push(`${ind}/** ${body[0]} */`);
      else out.push(`${ind}/**`, ...body.map((b) => `${ind} *${b ? " " + b : ""}`), `${ind} */`);
      skipTo = j;
      return;
    }
    const at = out.length;
    emit(node, out, ind, mods);
    // A comment that shared a line with code goes back on the end of the line it produced.
    if (node.comment && node.toks.length && out.length > at) {
      out[at] += `  // ${node.comment.replace(/^#+/, "").trim()}`;
    }
    const h = node.toks[0]?.t;
    if (h === "if" || h === "elif" || h === "else") {
      const nh = items[i + 1]?.node.toks[0]?.t;
      if (nh !== "elif" && nh !== "else") out.push(`${ind}}`);
    }
  });
}

export function wacOf(src: string): string {
  const out: string[] = [];
  emitAll(readTree(src), out, "");
  return out.join("\n") + "\n";
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export function parseWapy(src: string, path: string): Program {
  const wac = wacOf(src);
  const parsed = wacParse(wacLex(wac).tokens, path);
  if (parsed.errors.length) {
    throw new Error(
      `wapy reassembled to wac that does not parse (${path}):\n` +
        parsed.errors.slice(0, 4).map((e) => `  ${e.line}:${e.col} ${e.message}`).join("\n") +
        `\n--- reassembled ---\n${wac}`,
    );
  }
  return parsed.program;
}

if (import.meta.main) {
  if (Deno.args.length === 0) { console.error("usage: wapyRead.ts <file.wapy>"); Deno.exit(2); }
  for (const p of Deno.args) console.log(wacOf(await Deno.readTextFile(p)));
}
