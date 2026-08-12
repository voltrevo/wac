// wapy's parser.
//
// A second frontend for the same language, producing the same AST. wac and wapy differ in their
// *structure* — indentation against braces, `def f(x: i32) -> i32` against `i32 f(i32 x)` — and
// not at all below that, so this parses the structure itself and calls `wacParse`'s shared
// expression and type grammar for the rest.
//
// That split is the whole design. Structure is where the two surfaces disagree and therefore
// where wapy needs its own diagnostics; expressions are where they agree and therefore where a
// second implementation would only be a second thing to keep in step.
//
// ## Why it parses rather than rewrites
//
// The first attempt rewrote wapy tokens into wac's shape and let `wacParse` sort it out. It
// round-tripped 155 of 155 files, which made it look finished, and it was not:
//
//   def f(x: i32) ->        →  "expected function name" at the column of the name
//   def f(x i32) -> i32:    →  accepted silently
//   class P                 →  accepted silently
//   if x > 1                →  "expected expression, found ')'" — there is no ')' in the file
//
// A frontend that does not parse cannot diagnose, and a round-trip test cannot notice, because
// it only ever feeds the reader output from the printer — which is valid by construction. Both
// of those are fixed here: this validates wapy's own grammar, and `wapyParse.test.ts` feeds it
// malformed input on purpose.

import type { Token } from "./wacLex.ts";
import { blocks, SPELLINGS, type Block, type Line, wapyLex, type WapyError } from "./wapyLex.ts";
import {
  type ConstDecl, type EnumDecl, type Expr, type FieldDecl, type FuncDecl, type Import,
  type ImportItem, type Lvalue, type MethodDecl, type Param, type ParseError, type Program,
  type Stmt, type StructDecl, type TopLevel, type VariantDecl, type WacType,
  makeParser,
} from "./wacParse.ts";
import { CORE } from "./wacCore.ts";

type Pos = { line: number; col: number };

export type WapyResult = { program: Program; errors: ParseError[] };

export function wapyParse(src: string, file: string): WapyResult {
  const lexed = wapyLex(src, file);
  const grouped = blocks(lexed.lines, file);
  const p = new P(file, [...lexed.errors, ...grouped.errors]);
  const items: TopLevel[] = [];
  for (const b of withModifiers(grouped.tree, p)) {
    const item = p.topLevel(b.block, b.mods);
    if (item) items.push(item);
  }
  return { program: { items }, errors: p.errors };
}

/** `@export` and friends sit on their own lines above the thing they modify. */
type Modified = { block: Block; mods: Set<string> };

const MODIFIERS = new Set(["export", "const", "override"]);

function withModifiers(bs: Block[], p: P): Modified[] {
  const out: Modified[] = [];
  let mods = new Set<string>();
  let firstAt: Token | undefined;                  // where an unattached run of them started
  for (const block of bs) {
    const t = block.head.tokens;
    if (t.length && word(t[0]) === "@") {
      if (t.length !== 2 || !MODIFIERS.has(word(t[1]))) {
        p.err(t[0], `unknown decorator — expected one of ${[...MODIFIERS].map((m) => "@" + m).join(", ")}`);
      } else if (mods.has(word(t[1]))) {
        p.err(t[1], `duplicate @${t[1].text}`);
      } else { mods.add(word(t[1])); firstAt ??= t[0]; }
      if (block.body.length) p.err(t[0], "a decorator takes no indented body");
      continue;
    }
    if (!t.length) continue;                       // a comment-only line
    out.push({ block, mods });
    mods = new Set();
    firstAt = undefined;
  }
  if (mods.size && firstAt) p.err(firstAt, `@${[...mods][0]} does not modify anything`);
  return out;
}

class P {
  errors: ParseError[] = [];
  constructor(readonly file: string, seed: WapyError[]) {
    this.errors = seed.map((e) => ({ ...e, file: e.file }));
  }

  err(at: Token | Pos, message: string, hint?: string): void {
    this.errors.push({ message, file: this.file, line: at.line, col: at.col, hint });
  }
  errAt(at: Pos, message: string): void { this.err(at, message); }

  /** Every wapy block header ends in `:`; say so once, here. */
  private colon(l: Line, what: string): Token[] {
    const t = l.tokens;
    if (t.length && word(t[t.length - 1]) === ":") return t.slice(0, -1);
    this.err(t[t.length - 1] ?? { line: l.line, col: 1 }, `expected ':' after ${what}`);
    return t;
  }

  private needBody(b: Block, what: string): void {
    if (b.body.every((k) => !k.head.tokens.length)) {
      this.err(b.head.tokens[0], `${what} has no indented body`,
               "wapy uses indentation for blocks; an empty one is written `pass`.");
    }
  }

  // ── Delegated grammar ─────────────────────────────────────────────────────
  //
  // Expressions and types come from `wacParse`. Anything left over after one of them is a
  // mistake this reports, which is how a trailing `)` or a missing operator is caught.

  expr(toks: Token[], where: Pos): Expr {
    if (!toks.length) {
      this.errAt(where, "expected an expression");
      return { kind: "int", value: "0", ...where };
    }
    const prepared = pythonisms(toks);
    const m = makeParser([...prepared, eof(prepared)], this.file);
    const { expr, errors, consumed } = m.expression();
    this.errors.push(...errors);
    if (!errors.length && consumed < prepared.length) {
      this.err(prepared[consumed], `unexpected '${prepared[consumed].text}' after the expression`);
    }
    return expr;
  }

  type(toks: Token[], where: Pos): WacType {
    if (!toks.length) {
      this.errAt(where, "expected a type");
      return { kind: "prim", name: "void", ...where };
    }
    const prepared = typeTokens(toks);
    const m = makeParser([...prepared, eof(prepared)], this.file);
    const { type, errors, consumed } = m.type();
    this.errors.push(...errors);
    if (!errors.length && consumed < prepared.length) {
      this.err(prepared[consumed], `unexpected '${prepared[consumed].text}' in the type`);
    }
    return type;
  }

  // ── Declarations ──────────────────────────────────────────────────────────

  topLevel(b: Block, mods: Set<string>): TopLevel | null {
    const t = b.head.tokens;
    const head = t[0];
    switch (word(head)) {
      case "from":  return this.importDecl(b, mods);
      case "class": return this.classDecl(b, mods);
      case "def":   return this.funcDecl(b, mods);
      case "const": return this.constDecl(b, mods);
      default:
        this.err(head, `expected a declaration, found '${head.text}'`,
                 "At the top level wapy takes `from … import …`, `class`, `def` or `const`.");
        return null;
    }
  }

  private importDecl(b: Block, mods: Set<string>): Import | null {
    const t = b.head.tokens;
    if (mods.size) this.err(t[0], `an import takes no @${[...mods][0]}`);
    if (b.body.length) this.err(t[0], "an import takes no indented body");
    // `from core import Read` — unquoted, because core is not a file. Same reasoning as the wac
    // surface, and the same spelling, since it is one language with two ways to write it down.
    const fromCore = t[1]?.kind === "ident" && t[1].text === CORE.key;
    if (t[1]?.kind !== "string" && !fromCore) {
      this.err(t[1] ?? t[0], t[1]?.kind === "ident"
        ? `unknown module '${t[1].text}' — an unquoted import reads only from \`${CORE.key}\``
        : "expected a quoted path, or `core`, after `from`");
      return null;
    }
    const impAt = t.findIndex((x, i) => i > 1 && word(x) === "import");
    if (impAt < 0) {
      this.err(t[1], "expected `import` after the path");
      return null;
    }
    const items: ImportItem[] = [];
    for (const part of splitTop(t.slice(impAt + 1), ",")) {
      if (!part.length) continue;
      if (part.length === 3 && word(part[1]) === "as") {
        items.push({ name: part[0].text, alias: part[2].text, line: part[0].line, col: part[0].col });
      } else if (part.length === 1) {
        items.push({ name: part[0].text, alias: part[0].text, line: part[0].line, col: part[0].col });
      } else {
        this.err(part[0], "expected a name, or `name as alias`");
      }
    }
    if (!items.length) this.err(t[impAt], "expected at least one name to import");
    return fromCore
      ? { tag: "import", path: "", prefix: CORE.key, items, line: t[0].line, col: t[0].col }
      : { tag: "import", path: t[1].text, items, line: t[0].line, col: t[0].col };
  }

  private constDecl(b: Block, mods: Set<string>): ConstDecl | null {
    const t = b.head.tokens;                       // a const is one line, so no `:` and no body
    if (b.body.length) this.err(t[0], "a constant takes no indented body");
    const name = t[1];
    if (!name || name.kind !== "ident") {
      this.err(name ?? t[0], "expected a name after `const`");
      return null;
    }
    const colon = indexTop(t, ":");
    const eq = indexTop(t, "=");
    if (colon < 0 || eq < 0 || colon > eq) {
      this.err(name, "a constant is written `const NAME: Type = value`");
      return null;
    }
    return {
      tag: "const", exported: mods.has("export"), name: name.text,
      type: this.type(t.slice(colon + 1, eq), name),
      init: this.expr(t.slice(eq + 1), t[eq]),
      line: t[0].line, col: t[0].col,
    };
  }

  private classDecl(b: Block, mods: Set<string>): StructDecl | EnumDecl | null {
    const t = this.colon(b.head, "a class header");
    const name = t[1];
    if (!name || name.kind !== "ident") {
      this.err(name ?? t[0], "expected a name after `class`");
      return null;
    }
    let i = 2;
    let typeParams: string[] = [];
    if (word(t[i]) === "[") {
      const close = matching(t, i, "[", "]");
      if (close < 0) { this.err(t[i], "unclosed '[' in the type parameters"); return null; }
      typeParams = splitTop(t.slice(i + 1, close), ",").map((p) => p[0]?.text).filter(Boolean) as string[];
      if (!typeParams.length) this.err(t[i], "expected at least one type parameter");
      i = close + 1;
    }
    let parent: string | null = null;
    let isEnum = false;
    if (word(t[i]) === "(") {
      const close = matching(t, i, "(", ")");
      if (close < 0) { this.err(t[i], "unclosed '(' after the class name"); return null; }
      const inner = t.slice(i + 1, close);
      if (inner.length === 1 && word(inner[0]) === "enum") isEnum = true;
      else if (inner.length === 1 && inner[0].kind === "ident") parent = inner[0].text;
      else this.err(inner[0] ?? t[i], "expected a base class name, or `enum`");
      i = close + 1;
    }
    if (i < t.length) this.err(t[i], `unexpected '${t[i].text}' in the class header`);
    this.needBody(b, "a class");

    const pos = { line: t[0].line, col: t[0].col };
    return isEnum
      ? this.enumBody(b, name.text, typeParams, mods, pos)
      : this.structBody(b, name.text, typeParams, parent, mods, pos);
  }

  private structBody(
    b: Block, name: string, typeParams: string[], parent: string | null,
    mods: Set<string>, pos: Pos,
  ): StructDecl {
    const fields: FieldDecl[] = [];
    const methods: MethodDecl[] = [];
    for (const { block, mods: m } of withModifiers(this.members(b), this)) {
      const t = block.head.tokens;
      if (word(t[0]) === "def") {
        const fn = this.method(block, name, m);
        if (fn) methods.push(fn);
      } else {
        const f = this.field(block, m);
        if (f) fields.push(f);
      }
    }
    return {
      tag: "struct", isConst: mods.has("const"), exported: mods.has("export"), name, parent,
      fields, methods, typeParams, ...pos,
    };
  }

  /**
   * A class body, with `pass` recognised as "deliberately empty".
   *
   * A struct with no fields and no methods is legal wac, and indentation cannot express an
   * empty block, so wapy needs the same word Python uses for it.
   */
  private members(b: Block): Block[] {
    const real = b.body.filter((k) => k.head.tokens.length);
    const pass = real.filter((k) => word(k.head.tokens[0]) === "pass" && k.head.tokens.length === 1);
    if (!pass.length) return real;
    if (real.length > 1) this.err(pass[0].head.tokens[0], "`pass` is the whole body or none of it");
    for (const k of pass) if (k.body.length) this.err(k.head.tokens[0], "`pass` takes no body");
    return real.filter((k) => !pass.includes(k));
  }

  private field(b: Block, mods: Set<string>): FieldDecl | null {
    const t = b.head.tokens;
    if (b.body.length) this.err(t[0], "a field takes no indented body");
    let ts = t, isConst = mods.has("const");
    if (word(ts[0]) === "const") { isConst = true; ts = ts.slice(1); }
    const colon = indexTop(ts, ":");
    if (colon !== 1 || ts[0].kind !== "ident") {
      this.err(ts[0] ?? t[0], "a field is written `name: Type`");
      return null;
    }
    return {
      isConst, name: ts[0].text, type: this.type(ts.slice(colon + 1), ts[0]),
      line: t[0].line, col: t[0].col,
    };
  }

  private enumBody(
    b: Block, name: string, typeParams: string[], mods: Set<string>, pos: Pos,
  ): EnumDecl {
    const variants: VariantDecl[] = [];
    const methods: MethodDecl[] = [];
    for (const { block, mods: m } of withModifiers(this.members(b), this)) {
      const t = block.head.tokens;
      if (word(t[0]) === "def") {
        const fn = this.method(block, name, m);
        if (fn) methods.push(fn);
        continue;
      }
      if (t[0].kind !== "ident" && t[0].kind !== "null" && t[0].kind !== "bool") {
        this.err(t[0], "expected a variant name");
        continue;
      }
      if (t.length === 1) {
        variants.push({ name: t[0].text, fields: [], line: t[0].line, col: t[0].col });
        continue;
      }
      if (word(t[1]) !== "(") {
        this.err(t[1], "a variant is written `Name` or `Name(field: Type, …)`");
        continue;
      }
      const close = matching(t, 1, "(", ")");
      if (close < 0) { this.err(t[1], "unclosed '(' in the variant"); continue; }
      variants.push({
        name: t[0].text,
        fields: splitTop(t.slice(2, close), ",").filter((p) => p.length).map((p) => this.param(p)),
        line: t[0].line, col: t[0].col,
      });
    }
    if (!variants.length) this.err({ line: pos.line, col: pos.col }, "an enum needs at least one variant");
    return { tag: "enum", exported: mods.has("export"), name, variants, typeParams, methods, ...pos };
  }

  private param(toks: Token[]): Param {
    let ts = toks, isConst = false;
    if (word(ts[0]) === "const") { isConst = true; ts = ts.slice(1); }
    const colon = indexTop(ts, ":");
    if (colon !== 1 || ts[0]?.kind !== "ident") {
      this.err(ts[0] ?? toks[0], "a parameter is written `name: Type`",
               "wapy annotates every parameter; there is no inference here.");
      return {
        isConst, name: ts[0]?.text ?? "_",
        type: { kind: "prim", name: "void", line: toks[0].line, col: toks[0].col },
        line: toks[0].line, col: toks[0].col,
      };
    }
    return {
      isConst, name: ts[0].text, type: this.type(ts.slice(colon + 1), ts[0]),
      line: toks[0].line, col: toks[0].col,
    };
  }

  /** A receiver may only be annotated with the type it is a receiver of. */
  private receiver(recv: Token[] | null, owner: string): void {
    if (!recv) return;
    const rest = word(recv[0]) === "const" ? recv.slice(1) : recv;
    if (rest.length === 1) return;                   // bare `self`, which cannot be wrong
    if (word(rest[1]) !== ":") {
      this.err(rest[1] ?? rest[0], "`self` takes either no annotation or `: " + owner + "`");
    } else if (rest.length !== 3 || rest[2].text !== owner) {
      this.err(rest[2] ?? rest[1], `\`self\` in ${owner} is a ${owner}, not ` +
               `'${rest.slice(2).map((x) => x.text).join(" ")}'`);
    }
  }

  private signature(b: Block): {
    name: Token; typeParams: string[]; params: Token[][]; ret: Token[]; recv: Token[] | null;
  } | null {
    const t = this.colon(b.head, "a def");
    const name = t[1];
    if (!name || name.kind !== "ident") {
      this.err(name ?? t[0], "expected a name after `def`");
      return null;
    }
    let i = 2;
    let typeParams: string[] = [];
    if (word(t[i]) === "[") {
      const close = matching(t, i, "[", "]");
      if (close < 0) { this.err(t[i], "unclosed '[' in the type parameters"); return null; }
      typeParams = splitTop(t.slice(i + 1, close), ",").map((p) => p[0]?.text).filter(Boolean) as string[];
      i = close + 1;
    }
    if (word(t[i]) !== "(") {
      this.err(t[i] ?? name, "expected '(' after the name");
      return null;
    }
    const close = matching(t, i, "(", ")");
    if (close < 0) { this.err(t[i], "unclosed '(' in the parameter list"); return null; }
    const parts = splitTop(t.slice(i + 1, close), ",").filter((p) => p.length);

    let recv: Token[] | null = null;
    if (parts.length && isReceiver(parts[0])) recv = parts.shift()!;

    let ret: Token[] = [];
    if (word(t[close + 1]) === "->") ret = t.slice(close + 2);
    else if (close + 1 < t.length) this.err(t[close + 1], `unexpected '${t[close + 1].text}' after the parameters`);
    else {
      this.err(t[close], "expected '-> Type' after the parameters",
               "Every wapy function states its return type; use `-> void` for none.");
    }
    return { name, typeParams, params: parts, ret, recv };
  }

  private funcDecl(b: Block, mods: Set<string>): FuncDecl | null {
    const sig = this.signature(b);
    if (!sig) return null;
    if (sig.recv) this.err(sig.recv[0], "`self` is only a parameter of a method");
    this.needBody(b, "a def");
    const t = b.head.tokens;
    return {
      tag: "func", exported: mods.has("export"), name: sig.name.text,
      returnType: this.type(sig.ret, sig.name),
      params: sig.params.map((p) => this.param(p)),
      body: { stmts: this.stmts(b.body), line: t[0].line, col: t[0].col },
      typeParams: sig.typeParams,
      line: t[0].line, col: t[0].col,
    };
  }

  private method(b: Block, owner: string, mods: Set<string>): MethodDecl | null {
    const sig = this.signature(b);
    if (!sig) return null;
    if (sig.typeParams.length) this.err(sig.name, "a method takes no type parameters of its own");
    this.receiver(sig.recv, owner);
    this.needBody(b, "a def");
    const t = b.head.tokens;
    return {
      isOverride: mods.has("override"),
      returnType: this.type(sig.ret, sig.name),
      name: sig.name.text,
      hasThis: sig.recv !== null,
      thisConst: word(sig.recv?.[0]) === "const",
      params: sig.params.map((p) => this.param(p)),
      body: { stmts: this.stmts(b.body), line: t[0].line, col: t[0].col },
      line: t[0].line, col: t[0].col,
    };
  }

  // ── Statements ────────────────────────────────────────────────────────────

  stmts(bs: Block[]): Stmt[] {
    const out: Stmt[] = [];
    const items = bs.filter((b) => b.head.tokens.length);
    for (let i = 0; i < items.length; i++) {
      const s = this.stmt(items[i], items, i);
      if (s) out.push(s);
      i = this.extent(items, i);
    }
    return out;
  }

  /**
   * The last sibling a statement reads.
   *
   * Some statements span several blocks — an `if` and its `elif`/`else`, a `do:` and its
   * `while` tail. Indentation makes those siblings; only the grammar knows they are one
   * statement, so the loop steps over the continuation rather than the statement marking it
   * consumed. Emptying a block to claim it, which is what this replaced, leaves the tree
   * saying something the file does not.
   */
  private extent(items: Block[], i: number): number {
    const head = word(items[i].head.tokens[0]);
    if (head === "do") return isDoTail(items[i + 1]) ? i + 1 : i;
    if (head !== "if") return i;
    while (i + 1 < items.length && isChained(items[i + 1])) i++;
    return i;
  }

  private stmt(b: Block, siblings: Block[], i: number): Stmt | null {
    const t = b.head.tokens;
    const head = t[0];
    const pos = { line: head.line, col: head.col };
    const body = (): Stmt[] => this.stmts(b.body);

    switch (word(head)) {
      case "pass":
        if (t.length === 1) { if (b.body.length) this.err(head, "`pass` takes no body"); return null; }
        break;                                       // otherwise it is a variable named `pass`

      case "if": {
        const cond = this.expr(this.colon(b.head, "an `if`").slice(1), head);
        this.needBody(b, "an `if`");
        return { kind: "if", cond, then: { stmts: body(), ...pos }, els: this.elseOf(siblings, i), ...pos };
      }
      case "elif":
      case "else":
        // Consumed by the `if` above; reaching here means there was none. Unless the line does
        // not open a block at all, in which case `elif` is just a variable someone named that.
        if (!opensBlock(t)) break;
        this.err(head, `\`${word(head)}\` without a matching \`if\``);
        return null;

      case "while": {
        const cond = this.expr(this.colon(b.head, "a `while`").slice(1), head);
        this.needBody(b, "a `while`");
        return { kind: "while", cond, body: { stmts: body(), ...pos }, ...pos };
      }

      case "do": {
        this.colon(b.head, "a `do`");
        if (b.head.tokens.length > 2) this.err(t[1], "`do:` takes nothing else on its line");
        this.needBody(b, "a `do`");
        const tail = siblings[i + 1];
        if (!isDoTail(tail)) {
          this.err(head, "a `do:` block must be followed by `while <condition>`",
                   "Written without a colon, so it reads as the tail of the loop rather than a new one.");
          return { kind: "dowhile", body: { stmts: body(), ...pos }, cond: { kind: "bool", value: false, ...pos }, ...pos };
        }
        const tt = tail.head.tokens;
        return { kind: "dowhile", body: { stmts: body(), ...pos }, cond: this.expr(tt.slice(1), tt[0]), ...pos };
      }

      case "for":   return this.forStmt(b, pos);
      case "match":
      case "switch": return this.matchStmt(b, word(head) as "match" | "switch", pos);

      case "return": {
        if (b.body.length) this.err(head, "`return` takes no indented body");
        return { kind: "return", value: t.length > 1 ? this.expr(t.slice(1), head) : null, ...pos };
      }
      case "break":
      case "continue":
        if (t.length > 1) this.err(t[1], `\`${head.text}\` takes nothing else on its line`);
        return { kind: word(head) as "break" | "continue", ...pos };

      case "trap":
        if (t.length === 1) return { kind: "trap", ...pos };
        if (word(t[1]) === "(" && word(t[t.length - 1]) === ")") {
          const inner = t.slice(2, -1);
          return { kind: "trap", value: inner.length ? this.expr(inner, head) : undefined, ...pos };
        }
        this.err(t[1], "`trap` is written `trap()` or `trap(value)`");
        return { kind: "trap", ...pos };

      case "scope":
        // `scope:` and nothing else on the line. `scope: i32 = 1` is a declaration of a
        // variable called `scope`, which is a legal name because wac reserves no such word.
        if (t.length !== 2 || !opensBlock(t)) break;
        this.needBody(b, "a `scope`");
        return { kind: "block", block: { stmts: body(), ...pos }, ...pos };
    }

    if (b.body.length) {
      this.err(head, `'${head.text}' does not take an indented body`,
               "Only `if`, `elif`, `else`, `while`, `do`, `for`, `match`, `switch`, `scope`, `def` and `class` do.");
    }
    return this.simple(t, pos);
  }

  private elseOf(siblings: Block[], i: number): Stmt extends { els: infer E } ? E : never {
    const next = siblings[i + 1];
    const t = next?.head.tokens ?? [];
    if (!t.length) return null as never;
    const pos = { line: t[0].line, col: t[0].col };
    if (word(t[0]) === "elif") {
      const cond = this.expr(this.colon(next.head, "an `elif`").slice(1), t[0]);
      this.needBody(next, "an `elif`");
      const inner: Stmt = {
        kind: "if", cond, then: { stmts: this.stmts(next.body), ...pos },
        els: this.elseOf(siblings, i + 1), ...pos,
      };
      return { kind: "else-if", stmt: inner, ...pos } as never;
    }
    if (word(t[0]) === "else") {
      this.colon(next.head, "an `else`");
      if (next.head.tokens.length > 2) this.err(t[1], "`else:` takes nothing else on its line");
      this.needBody(next, "an `else`");
      const block = { stmts: this.stmts(next.body), ...pos };
      const after = siblings[i + 2]?.head.tokens[0];
      if (after && CHAINED.has(after.text)) this.err(after, `\`${after.text}\` after an \`else\``);
      return { kind: "else-block", block, ...pos } as never;
    }
    return null as never;
  }

  private forStmt(b: Block, pos: Pos): Stmt {
    const t = this.colon(b.head, "a `for`");
    const rest = t.slice(1);
    this.needBody(b, "a `for`");
    const body = { stmts: this.stmts(b.body), ...pos };
    const inAt = indexTop(rest, "in");

    if (inAt >= 0) {
      // `for name[: T] in range(a, b[, step])`
      const colon = indexTop(rest.slice(0, inAt), ":");
      const nameToks = colon >= 0 ? rest.slice(0, colon) : rest.slice(0, inAt);
      if (nameToks.length !== 1 || nameToks[0].kind !== "ident") {
        this.err(rest[0] ?? t[0], "expected a single loop variable before `in`");
        return { kind: "while", cond: { kind: "bool", value: false, ...pos }, body, ...pos };
      }
      const name = nameToks[0];
      const type: WacType = colon >= 0
        ? this.type(rest.slice(colon + 1, inAt), name)
        : { kind: "prim", name: "i32", ...pos };
      const call = rest.slice(inAt + 1);
      if (word(call[0]) !== "range" || word(call[1]) !== "(" ||
          word(call[call.length - 1]) !== ")") {
        this.err(call[0] ?? name, "expected `range(start, end)` after `in`",
                 "wapy iterates a counted range; to loop over something else use `for init; cond; step:`.");
        return { kind: "while", cond: { kind: "bool", value: false, ...pos }, body, ...pos };
      }
      const args = splitTop(call.slice(2, -1), ",").filter((a) => a.length);
      if (args.length < 2 || args.length > 3) {
        this.err(call[0], "`range` takes a start, an end and an optional step");
        return { kind: "while", cond: { kind: "bool", value: false, ...pos }, body, ...pos };
      }
      const ident: Expr = { kind: "ident", name: name.text, ...pos };
      const lval = { kind: "lv-ident" as const, name: name.text, ...pos };
      return {
        kind: "for",
        init: { kind: "var", isConst: false, type, name: name.text, init: this.expr(args[0], name), ...pos },
        cond: { kind: "binary", op: "<", left: ident, right: this.expr(args[1], name), ...pos },
        update: args[2]
          ? { kind: "assign", op: "+=", lval, rhs: this.expr(args[2], name), ...pos }
          : { kind: "incr", op: "++", lval, ...pos },
        body, ...pos,
      };
    }

    // `for init; cond; step:` — the loop shapes a range cannot express.
    const parts = splitTop(rest, ";");
    if (parts.length !== 3) {
      this.err(rest[0] ?? t[0], "a `for` is `for x in range(a, b):` or `for init; cond; step:`");
      return { kind: "while", cond: { kind: "bool", value: false, ...pos }, body, ...pos };
    }
    return {
      kind: "for",
      init: parts[0].length ? this.simple(parts[0], pos) : null,
      cond: parts[1].length ? this.expr(parts[1], t[0]) : null,
      update: parts[2].length ? this.simple(parts[2], pos) : null,
      body, ...pos,
    };
  }

  private matchStmt(b: Block, kw: "match" | "switch", pos: Pos): Stmt {
    const t = this.colon(b.head, `a \`${kw}\``);
    const subject = this.expr(t.slice(1), t[0]);
    this.needBody(b, `a \`${kw}\``);

    if (kw === "switch") {
      const cases = [];
      for (const c of b.body) {
        const ct = c.head.tokens;
        if (!ct.length) continue;
        if (word(ct[0]) !== "case") { this.err(ct[0], "expected `case` inside a `switch`"); continue; }
        const pat = this.colon(c.head, "a `case`").slice(1);
        const isDefault = pat.length === 1 && word(pat[0]) === "_";
        cases.push({
          value: isDefault ? "default" as const : this.expr(pat, ct[0]),
          body: this.stmts(c.body),
          line: ct[0].line, col: ct[0].col,
        });
      }
      if (!cases.length) this.err(t[0], "a `switch` needs at least one `case`");
      return { kind: "switch", expr: subject, cases, ...pos };
    }

    const arms = [];
    for (const c of b.body) {
      const ct = c.head.tokens;
      if (!ct.length) continue;
      const isElse = word(ct[0]) === "case" && word(ct[1]) === "else";
      if (word(ct[0]) !== "case") { this.err(ct[0], "expected `case` inside a `match`"); continue; }
      const pat = this.colon(c.head, "a `case`").slice(1);
      arms.push({
        ...this.pattern(isElse ? [] : pat, ct[0]),
        body: this.stmts(c.body),
        line: ct[0].line, col: ct[0].col,
      });
    }
    if (!arms.length) this.err(t[0], "a `match` needs at least one `case`");
    return { kind: "match", subject, arms, ...pos };
  }

  /** `Variant`, `Variant(a, b)`, or nothing for the `else` arm. */
  private pattern(pat: Token[], at: Token): { variant: string | null; bindings: string[] } {
    if (!pat.length) return { variant: null, bindings: [] };
    if (pat[0].kind !== "ident" && pat[0].kind !== "null" && pat[0].kind !== "bool") {
      this.err(pat[0], "expected a variant name");
      return { variant: null, bindings: [] };
    }
    if (pat.length === 1) return { variant: pat[0].text, bindings: [] };
    if (word(pat[1]) !== "(" || word(pat[pat.length - 1]) !== ")") {
      this.err(pat[1], "a pattern is `Variant` or `Variant(a, b)`");
      return { variant: pat[0].text, bindings: [] };
    }
    const bindings = splitTop(pat.slice(2, -1), ",").filter((p) => p.length).map((p) => {
      if (p.length !== 1) this.err(p[0] ?? at, "each binding is a single name");
      return p[0]?.text ?? "_";
    });
    return { variant: pat[0].text, bindings };
  }

  /** A declaration, assignment, or bare expression. */
  private simple(t: Token[], pos: Pos): Stmt {
    let ts = t, isConst = false;
    if (word(ts[0]) === "const") { isConst = true; ts = ts.slice(1); }

    const colon = indexTop(ts, ":");
    const eq = indexTop(ts, "=");
    if (colon > 0 && ts[colon - 1].kind === "ident" && (eq < 0 || colon < eq)) {
      if (colon !== 1) this.err(ts[0], "a declaration names one variable");
      if (eq < 0) {
        this.err(ts[ts.length - 1], "a declaration needs an initialiser",
                 "wapy has no default-initialised locals; write `x: i32 = 0`.");
        return { kind: "var", isConst, type: this.type(ts.slice(colon + 1), ts[0]),
                 name: ts[0].text, init: { kind: "int", value: "0", ...pos }, ...pos };
      }
      return {
        kind: "var", isConst, type: this.type(ts.slice(colon + 1, eq), ts[0]),
        name: ts[0].text, init: this.expr(ts.slice(eq + 1), ts[eq]), ...pos,
      };
    }
    if (isConst) this.err(t[0], "`const` here needs a type — `const x: i32 = 1`");

    // `x++` / `x--`
    const lastTok = ts[ts.length - 1];
    if (ts.length >= 2 && (word(lastTok) === "++" || word(lastTok) === "--")) {
      const lv = this.lvalue(ts.slice(0, -1), pos);
      if (lv) return { kind: "incr", op: lastTok.text as "++" | "--", lval: lv, ...pos };
    }

    const assignAt = ts.findIndex((x, i) =>
      depthAt(ts, i) === 0 && (word(x) === "=" || COMPOUND.has(word(x))));
    if (assignAt > 0) {
      const lv = this.lvalue(ts.slice(0, assignAt), pos);
      if (lv) {
        return { kind: "assign", op: ts[assignAt].text, lval: lv,
                 rhs: this.expr(ts.slice(assignAt + 1), ts[assignAt]), ...pos };
      }
    }
    return { kind: "expr", expr: this.expr(ts, pos), ...pos };
  }

  /**
   * The assignable subset.
   *
   * Parsed with the shared expression grammar and then narrowed, rather than given a grammar of
   * its own — so `a.b[i]!` is accepted or rejected by the same rules everywhere, and only the
   * final shape check is here.
   */
  private lvalue(toks: Token[], pos: Pos): Lvalue | null {
    const e = this.expr(toks, pos);
    const conv = (x: Expr): Lvalue | null => {
      switch (x.kind) {
        case "ident": return { kind: "lv-ident", name: x.name, line: x.line, col: x.col };
        case "field": {
          const b = conv(x.expr);
          return b ? { kind: "lv-field", base: b, field: x.name, line: x.line, col: x.col } : null;
        }
        case "index": {
          const b = conv(x.expr);
          return b ? { kind: "lv-index", base: b, idx: x.idx, line: x.line, col: x.col } : null;
        }
        case "unwrap": {
          const b = conv(x.expr);
          return b ? { kind: "lv-unwrap", base: b, line: x.line, col: x.col } : null;
        }
        default: return null;
      }
    };
    const lv = conv(e);
    if (!lv) this.err(toks[0] ?? pos, "cannot assign to this");
    return lv;
  }
}

// ── Token-level shapes ───────────────────────────────────────────────────────

const COMPOUND = new Set(["+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=", ">>>="]);

function eof(toks: Token[]): Token {
  const l = toks[toks.length - 1];
  return { kind: "eof", text: "", line: l?.line ?? 1, col: (l?.col ?? 0) + (l?.text.length ?? 1) };
}

/**
 * A method's first parameter, `self: Point` or `const self: Point`.
 *
 * The annotation is redundant — a method's receiver can only be the enclosing type — but wapy
 * annotates every parameter, and one that silently permitted a different type there would be
 * lying. `method` checks it names the class.
 */
function isReceiver(part: Token[]): boolean {
  const head = word(part[0]) === "const" ? part[1] : part[0];
  return head?.kind === "this";
}

/**
 * The word a token acts as: its text if it is an identifier, its kind otherwise.
 *
 * Every keyword and punctuation test goes through this. Comparing `.text` instead reads a
 * *string literal* as the word it contains — `w == "if" or …` had its `"if"` taken for the
 * ternary keyword — and reads wapy's `and` as `and` rather than the `&&` it is. An identifier
 * is the one case where the text is the word, which is what wapy's structural words (`def`,
 * `class`, `elif`, `pass`, `from`) are.
 */
function word(t: Token | undefined): string {
  return t === undefined ? "" : t.kind === "ident" ? t.text : t.kind;
}

/** Block heads that continue an `if` rather than starting a statement of their own. */
const CHAINED = new Set(["elif", "else"]);

/** A line ending in `:`, which is what makes a block header a block header. */
function opensBlock(t: Token[]): boolean {
  return t.length > 0 && word(t[t.length - 1]) === ":";
}

/** An `elif`/`else` block continuing the `if` before it, rather than a variable named that. */
function isChained(b: Block): boolean {
  return CHAINED.has(word(b.head.tokens[0])) && opensBlock(b.head.tokens);
}

/**
 * `while cond` with no colon and no body, closing a `do:`.
 *
 * The colon is what separates it from a `while` loop of its own: a loop opens a block, a tail
 * does not.
 */
function isDoTail(b: Block | undefined): boolean {
  const t = b?.head.tokens ?? [];
  return t.length > 1 && word(t[0]) === "while" && !opensBlock(t);
}

function depthAt(toks: Token[], i: number): number {
  let d = 0;
  for (let j = 0; j < i; j++) {
    if (OPENERS.has(toks[j].kind)) d++;
    else if (CLOSERS.has(toks[j].kind)) d--;
  }
  return d;
}

function indexTop(toks: Token[], text: string): number {
  for (let i = 0; i < toks.length; i++) {
    if (word(toks[i]) === text && depthAt(toks, i) === 0) return i;
  }
  return -1;
}

function matching(toks: Token[], i: number, open: string, close: string): number {
  let d = 0;
  for (let j = i; j < toks.length; j++) {
    if (toks[j].kind === open) d++;
    else if (toks[j].kind === close) { d--; if (!d) return j; }
  }
  return -1;
}

function splitTop(toks: Token[], sep: string): Token[][] {
  const parts: Token[][] = [];
  let cur: Token[] = [], d = 0;
  for (const t of toks) {
    if (OPENERS.has(t.kind)) d++;
    else if (CLOSERS.has(t.kind)) d--;
    if (d === 0 && word(t) === sep) { parts.push(cur); cur = []; continue; }
    cur.push(t);
  }
  parts.push(cur);
  return parts;
}

/**
 * The two places wapy's *expression* grammar differs from wac's, resolved before delegating.
 *
 * Everything else — precedence, associativity, calls, indexing, casts — is identical, which is
 * why the rest of the grammar is shared rather than rewritten.
 */
function pythonisms(toks: Token[]): Token[] {
  return namedArgs(matchSubjects(ternaries(isNot(names(toks)))));
}

/** The words wapy respells, all of which are ordinary wac identifiers. */
const RESPELLED = new Set(SPELLINGS.keys());

/**
 * `Option.None`, `case None:` — a respelled word used as a name.
 *
 * wapy calls wac's `null` `None`, and the packages have an `Option` enum whose absent variant is
 * called `None`. Both are right, and neither has to give way: after a `.` or a `case` the
 * grammar wants a name, so that is what the word is. This is the same position rule that lets
 * `slice(a, from, to)` keep its parameter.
 */
function names(toks: Token[]): Token[] {
  return toks.map((t, i) => {
    const prev = toks[i - 1]?.kind;
    return RESPELLED.has(t.text) && (prev === "." || prev === "case")
      ? { ...t, kind: "ident" as const }
      : t;
  });
}

/**
 * `x is not null` — the one place `not` is not a negation.
 *
 * wapy spells `!` as `not`, and wac happens to use the same word for the negated form of `is`.
 * Position decides, as it does for every other word wapy shares with an identifier.
 */
function isNot(toks: Token[]): Token[] {
  return toks.map((t, i) =>
    word(t) === "not" && toks[i - 1]?.kind === "is" ? { ...t, kind: "not" as const } : t
  );
}

/**
 * `match x { … }` → `match (x) { … }`.
 *
 * wac parenthesises the subject of a match expression. wapy does not — nothing else in wapy
 * parenthesises the thing a keyword is about, and `match self { … }` beside `if x > 1:` is the
 * point. The subject runs to the `{` that opens the arms, which is not simply the first `{`:
 * a subject may itself be a match, and that one's arms come first.
 *
 * Runs before `namedArgs`, so the only braces present are match arms.
 */
function matchSubjects(toks: Token[]): Token[] {
  const i = toks.findIndex((t) => t.kind === "match");
  if (i < 0) return toks;
  let depth = 0, nested = 0, brace = -1;
  for (let j = i + 1; j < toks.length; j++) {
    const x = toks[j].kind;
    if (x === "(" || x === "[") depth++;
    else if (x === ")" || x === "]") depth--;
    else if (x === "match") nested++;
    else if (x === "{" && depth === 0) {
      if (!nested) { brace = j; break; }
      const end = matching(toks, j, "{", "}");      // a nested match's arms, stepped over whole
      if (end < 0) break;
      nested--;
      j = end;
    }
  }
  if (brace < 0 || brace === i + 1) return toks;
  return [
    ...toks.slice(0, i + 1),
    { ...toks[i + 1], kind: "(", text: "(" } as Token,
    ...matchSubjects(toks.slice(i + 1, brace)),
    { ...toks[brace], kind: ")", text: ")" } as Token,
    ...matchSubjects(toks.slice(brace)),
  ];
}

const CLOSER = new Map([["(", ")"], ["[", "]"], ["{", "}"]]);

/**
 * Bracket tests by kind, not by `"([{".includes(text)`.
 *
 * An empty string literal has the text `""`, and `String.includes("")` is true — so a token
 * for `""` counted as an open bracket, and `br.broken == "" ? a : b` looked like it was inside
 * one. Kinds cannot be empty.
 */
const OPENERS = new Set<string>(["(", "[", "{"]);
const CLOSERS = new Set<string>([")", "]", "}"]);

/**
 * `X if C else Y` → `C ? X : Y`.
 *
 * Bracket groups are rewritten first, then the outermost level: a conditional inside a call
 * argument or a parenthesised sub-expression is at a depth the outer scan steps over, and
 * `return (a if c else b)` is ordinary wapy.
 */
function ternaries(toks: Token[]): Token[] {
  const inner: Token[] = [];
  for (let i = 0; i < toks.length; i++) {
    const shut = CLOSER.get(toks[i].kind);
    const close = shut ? matching(toks, i, toks[i].kind, shut) : -1;
    if (close < 0) { inner.push(toks[i]); continue; }
    inner.push(toks[i], ...ternaries(toks.slice(i + 1, close)), toks[close]);
    i = close;
  }
  return segments(inner);
}

/**
 * Apply `topTernary` between separators rather than across them.
 *
 * A conditional's operands stop at the nearest `,` or `:` — in `f(a, 1 if c else b, d)` the
 * `then` arm is `1`, not `a, 1`. Scanning the whole level at once swallowed the argument list.
 */
function segments(toks: Token[]): Token[] {
  const out: Token[] = [];
  let seg: Token[] = [];
  for (const t of toks) {
    if (depthOf(seg) === 0 && (t.kind === "," || t.kind === ":")) {
      out.push(...topTernary(seg), t);
      seg = [];
    } else seg.push(t);
  }
  return [...out, ...topTernary(seg)];
}

/** The bracket depth after `toks` — zero when every group opened in it has closed. */
function depthOf(toks: Token[]): number {
  return depthAt(toks, toks.length);
}

/** One level, on tokens whose bracket groups are already rewritten. */
function topTernary(toks: Token[]): Token[] {
  const ifAt = toks.findIndex((t, i) => word(t) === "if" && depthAt(toks, i) === 0);
  if (ifAt < 0) return toks;
  const elseAt = toks.findIndex((t, i) => i > ifAt && word(t) === "else" && depthAt(toks, i) === 0);
  if (elseAt < 0) return toks;
  return [
    ...topTernary(toks.slice(ifAt + 1, elseAt)), { ...toks[ifAt], kind: "?", text: "?" } as Token,
    ...topTernary(toks.slice(0, ifAt)), { ...toks[elseAt], kind: ":", text: ":" } as Token,
    // Right-associative, as Python is: `a if c else b if d else e` groups to the right.
    ...topTernary(toks.slice(elseAt + 1)),
  ];
}

/** `Point(y=4.0)` → `Point { y: 4.0 }`, and `i32[3](fill=v)` → `i32[3](fill: v)`. */
function namedArgs(toks: Token[]): Token[] {
  let out = [...toks];
  for (let open = out.length - 1; open >= 0; open--) {
    if (word(out[open]) !== "(") continue;
    const close = matching(out, open, "(", ")");
    if (close < 0 || close === open + 1) continue;
    const parts = splitTop(out.slice(open + 1, close), ",");
    if (!parts.length || !parts.every((p) => p.length >= 2 && p[0].kind === "ident" && word(p[1]) === "=")) {
      continue;
    }
    const joined: Token[] = [];
    parts.forEach((p, i) => {
      if (i) joined.push({ ...p[0], kind: ",", text: "," });
      joined.push(p[0], { ...p[1], kind: ":", text: ":" }, ...p.slice(2));
    });
    const arr = word(out[open - 1]) === "]";
    out = [
      ...out.slice(0, open),
      { ...out[open], kind: arr ? "(" : "{", text: arr ? "(" : "{" },
      ...joined,
      { ...out[close], kind: arr ? ")" : "}", text: arr ? ")" : "}" },
      ...out.slice(close + 1),
    ];
  }
  return out;
}

/** `T | None` → `T?`, and `Name[args]` → `Name<args>` for a generic reference. */
function typeTokens(toks: Token[]): Token[] {
  let ts = [...toks];
  let q: Token | null = null;
  if (ts.length >= 2 && ts[ts.length - 1].kind === "null" && word(ts[ts.length - 2]) === "|") {
    q = { ...ts[ts.length - 1], kind: "?", text: "?" };
    ts = ts.slice(0, -2);
  }
  const out = ts.map((t) => ({ ...t }));
  for (let i = 0; i < out.length; i++) {
    if (word(out[i]) !== "[") continue;
    const prev = out[i - 1];
    if (!prev || prev.kind !== "ident" || word(prev) === "fn" || word(out[i + 1]) === "]") continue;
    const close = matching(out, i, "[", "]");
    if (close < 0) continue;
    out[i] = { ...out[i], kind: "<", text: "<" };
    out[close] = { ...out[close], kind: ">", text: ">" };
  }
  return q ? [...out, q] : out;
}
