// Parser for wac — converts a token array into an AST.
// Returns a Program node and any parse errors (partial AST on error).

import { type Token, type TokenKind } from "./wacLex.ts";

// ── AST node types ────────────────────────────────────────────────────────────

export type Pos = { line: number; col: number };

// Types -----------------------------------------------------------------------

export type WacType =
  | ({ kind: "prim";     name: string } & Pos)
  | ({ kind: "struct";   name: string } & Pos)
  | ({ kind: "array";    elem: WacType } & Pos)
  | ({ kind: "nullable"; inner: WacType } & Pos)
  | ({ kind: "funcref";  params: WacType[]; ret: WacType } & Pos);

// Expressions -----------------------------------------------------------------

export type Expr =
  | ({ kind: "int";      value: string } & Pos)
  | ({ kind: "float";    value: string } & Pos)
  | ({ kind: "string";   value: string } & Pos)
  | ({ kind: "bool";     value: boolean } & Pos)
  | ({ kind: "null" } & Pos)
  | ({ kind: "ident";    name: string } & Pos)
  | ({ kind: "unary";    op: string; expr: Expr } & Pos)
  | ({ kind: "binary";   op: string; left: Expr; right: Expr } & Pos)
  | ({ kind: "cast";     op: string; expr: Expr; type: WacType } & Pos)
  | ({ kind: "is";       expr: Expr; not: boolean; rhs: WacType | "null" | Expr } & Pos)
  | ({ kind: "ternary";  cond: Expr; then: Expr; else_: Expr } & Pos)
  | ({ kind: "call";     callee: Expr; args: Expr[] } & Pos)
  | ({ kind: "index";    expr: Expr; idx: Expr } & Pos)
  | ({ kind: "field";    expr: Expr; name: string } & Pos)
  | ({ kind: "unwrap";   expr: Expr } & Pos)
  | ({ kind: "construct"; ctype: WacType; args: Expr[]; named?: { name: string; val: Expr }[] } & Pos)
  | ({ kind: "arrNew";   elem: WacType; size: Expr | null; fixed: Expr[] } & Pos);

// lvalue — restricted subset used in assignments
export type Lvalue =
  | ({ kind: "lv-ident";   name: string } & Pos)
  | ({ kind: "lv-field";   base: Lvalue; field: string } & Pos)
  | ({ kind: "lv-index";   base: Lvalue; idx: Expr } & Pos)
  | ({ kind: "lv-unwrap";  base: Lvalue } & Pos);

// Statements ------------------------------------------------------------------

export type Stmt =
  | ({ kind: "var";      isConst: boolean; type: WacType; name: string; init: Expr } & Pos)
  | ({ kind: "assign";   op: string; lval: Lvalue; rhs: Expr } & Pos)
  | ({ kind: "incr";     op: "++" | "--"; lval: Lvalue } & Pos)
  | ({ kind: "if";       cond: Expr; then: Block; els: ElseBranch } & Pos)
  | ({ kind: "while";    cond: Expr; body: Block } & Pos)
  | ({ kind: "for";      init: Stmt | null; cond: Expr | null; update: Stmt | null; body: Block } & Pos)
  | ({ kind: "dowhile";  body: Block; cond: Expr } & Pos)
  | ({ kind: "switch";   expr: Expr; cases: SwitchCase[] } & Pos)
  | ({ kind: "return";   value: Expr | null } & Pos)
  | ({ kind: "break" } & Pos)
  | ({ kind: "continue" } & Pos)
  | ({ kind: "trap" } & Pos)
  | ({ kind: "block";    block: Block } & Pos)
  | ({ kind: "expr";     expr: Expr } & Pos);

// else branch: another if, or a plain block (null = no else)
export type ElseBranch = ({ kind: "else-if"; stmt: Stmt } & Pos) | ({ kind: "else-block"; block: Block } & Pos) | null;

export type Block      = { stmts: Stmt[] } & Pos;
export type SwitchCase = { value: Expr | "default"; body: Stmt[] } & Pos;

// Top-level -------------------------------------------------------------------

export type ImportItem = { name: string; alias: string } & Pos;
export type Import     = { tag: "import"; path: string; items: ImportItem[] } & Pos;

export type Param      = { type: WacType; name: string } & Pos;
export type FieldDecl  = { isConst: boolean; type: WacType; name: string } & Pos;
export type MethodDecl = {
  isOverride: boolean; returnType: WacType; name: string;
  hasThis: boolean; thisConst: boolean; params: Param[];
  body: Block;
} & Pos;

export type StructDecl = {
  tag: "struct"; isConst: boolean; name: string; parent: string | null;
  fields: FieldDecl[]; methods: MethodDecl[];
} & Pos;

export type FuncDecl = {
  tag: "func"; exported: boolean; returnType: WacType; name: string;
  params: Param[]; body: Block;
} & Pos;

export type TopLevel = Import | StructDecl | FuncDecl;
export type Program  = { items: TopLevel[] };

export type ParseError = { message: string; file: string; line: number; col: number; span?: number; annotation?: string; hint?: string };
export type ParseResult = { program: Program; errors: ParseError[] };

// ── Parser ────────────────────────────────────────────────────────────────────

const PRIM_TYPES = new Set([
  "i32", "i64", "f32", "f64", "bool", "void", "string",
  "anyref", "i31ref", "i8", "i16",
]);

const COMPOUND_OPS = new Set([
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=",
]);

export function wacParse(tokens: Token[], file: string): ParseResult {
  let cur = 0;
  const errors: ParseError[] = [];

  // ── Token access helpers ──────────────────────────────────────────────────

  function tok(offset = 0): Token {
    const i = cur + offset;
    return tokens[i] ?? tokens[tokens.length - 1];
  }

  function pos(offset = 0): Pos {
    const t = tok(offset);
    return { line: t.line, col: t.col };
  }

  function at(k: string, offset = 0): boolean {
    const t = tok(offset);
    // For literal tokens, only match by kind (so a string "!" doesn't match the "!" operator)
    if (t.kind === "string" || t.kind === "int" || t.kind === "float") return t.kind === k;
    return t.kind === k || t.text === k;
  }

  function advance(): Token { return tokens[cur++] ?? tokens[tokens.length - 1]; }

  function expect(k: string): Token {
    if (at(k)) return advance();
    const t = tok();
    errors.push({ message: `expected '${k}', found '${t.text}'`, file, line: t.line, col: t.col });
    return t;
  }

  function consume(k: string): boolean {
    if (at(k)) { advance(); return true; }
    return false;
  }

  function err(msg: string, offset = 0): void {
    const t = tok(offset);
    errors.push({ message: msg, file, line: t.line, col: t.col });
  }

  // ── Type parsing ──────────────────────────────────────────────────────────

  function isPrimType(): boolean {
    return (at("ident") && PRIM_TYPES.has(tok().text)) || at("void");
  }

  function parseType(): WacType {
    const p = pos();

    // fn[R(P,...)] — funcref type
    if (at("fn")) {
      advance();
      expect("[");
      const ret = parseType();
      expect("(");
      const params: WacType[] = [];
      if (!at(")")) {
        params.push(parseType());
        while (consume(",")) params.push(parseType());
      }
      expect(")");
      expect("]");
      let fnBase: WacType = { kind: "funcref", params, ret, ...p };
      // Handle [] and ? suffixes: fn[R(P)][] = array of funcref, fn[R(P)]? = nullable funcref
      while (true) {
        if (at("[") && at("]", 1)) {
          const arrP = pos(); advance(); advance();
          fnBase = { kind: "array", elem: fnBase, ...arrP };
        } else if (at("?")) {
          const nP = pos(); advance();
          fnBase = { kind: "nullable", inner: fnBase, ...nP };
        } else break;
      }
      return fnBase;
    }

    // Primitive or struct name
    let name: string;
    if (isPrimType()) {
      name = tok().text; advance();
    } else if (at("ident")) {
      name = tok().text; advance();
    } else {
      err(`expected type, found '${tok().text}'`);
      name = "i32";
    }

    let base: WacType = PRIM_TYPES.has(name)
      ? { kind: "prim", name, ...p }
      : { kind: "struct", name, ...p };

    // Interleave ? (nullable) and [] (array) suffixes in order.
    // e.g. Node?[] = array(nullable(Node)), i32[]? = nullable(array(i32))
    while (true) {
      if (at("[") && at("]", 1)) {
        const arrP = pos(); advance(); advance(); // [ ]
        base = { kind: "array", elem: base, ...arrP };
      } else if (at("?")) {
        const nP = pos(); advance();
        base = { kind: "nullable", inner: base, ...nP };
      } else {
        break;
      }
    }

    return base;
  }

  // ── Lookahead: var decl vs expression statement ───────────────────────────

  function looksLikeVarDeclAt(i: number): boolean {
    if (tokens[i]?.kind === "const" && tokens[i+1]?.kind !== "this") i++;
    const t = tokens[i];
    if (!t || t.kind === "eof") return false;
    // fn[...] type — always a type
    if (t.kind === "fn") return true;
    // Primitive type keyword or struct name
    if (t.kind !== "ident" && t.kind !== "void") return false;
    let j = i + 1;
    // Skip interleaved ? and [] suffixes (matching parseType's suffix logic)
    while (true) {
      if (tokens[j]?.kind === "[" && tokens[j+1]?.kind === "]") { j += 2; }
      else if (tokens[j]?.kind === "?") { j++; }
      else break;
    }
    // Expect an identifier (variable name) next
    return tokens[j]?.kind === "ident";
  }

  function looksLikeVarDecl(): boolean { return looksLikeVarDeclAt(cur); }

  // Check if position i starts a type (for is-expr RHS disambiguation)
  function looksLikeTypeHere(): boolean {
    const t = tok();
    if (t.kind === "fn") return true;
    if ((t.kind === "ident" && PRIM_TYPES.has(t.text)) || t.kind === "void") return true;
    if (t.kind !== "ident") return false;
    // Struct name in `is Type` context: check what follows
    const next = tok(1);
    // If followed by [ or ?, it's an array/nullable type
    if (next.kind === "[" || next.kind === "?") return true;
    // Single identifier only treated as a type if PascalCase (struct naming convention).
    // Lowercase identifiers like `a is b` are reference equality checks.
    if (t.text.charAt(0) !== t.text.charAt(0).toUpperCase()) return false;
    // Anything else (paren, ident, binary op) — treat as expression for `is y` (identity)
    const isExprFollow = ["(", "ident", "+", "-", "*", "/", "%", "==", "!=",
      "<", ">", "<=", ">=", "&&", "||", ".", "[", "!", "~"].includes(next.kind as string);
    // If followed by end-of-expression tokens, it's a type
    const isTypeFollow = [")", ";", "}", ",", ":"].includes(next.kind as string) || next.kind === "eof";
    return !isExprFollow || isTypeFollow;
  }

  // ── Expression parsing ────────────────────────────────────────────────────

  function parseExpr(): Expr { return parseTernary(); }

  function parseTernary(): Expr {
    let e = parseIsExpr();
    if (at("?")) {
      const p = pos(); advance();
      const then = parseExpr();
      expect(":");
      const else_ = parseExpr();
      e = { kind: "ternary", cond: e, then, else_, ...p };
    }
    return e;
  }

  function parseIsExpr(): Expr {
    let e = parseOr();
    if (at("is")) {
      const p = pos(); advance();
      const notFlag = consume("not");
      if (at("null")) { advance(); return { kind: "is", expr: e, not: notFlag, rhs: "null", ...p }; }
      if (looksLikeTypeHere()) {
        const t = parseType();
        // If parseType() consumed a trailing ? as a nullable suffix but it is actually the
        // ternary operator (e.g. `s is Circle ? 1 : 0`), back up and use the inner type.
        // Detection: last consumed token was ? AND current token looks like an expression start.
        const isTernaryQ = t.kind === "nullable" && tokens[cur - 1]?.kind === "?" &&
          (at("int") || at("float") || at("bool") || at("string") ||
           at("(") || at("!") || at("~") || at("-"));
        if (isTernaryQ) {
          cur--; // put the ? back so parseTernary can find it
          return { kind: "is", expr: e, not: notFlag, rhs: (t as { kind: "nullable"; inner: WacType }).inner, ...p };
        }
        return { kind: "is", expr: e, not: notFlag, rhs: t, ...p };
      }
      const rhs = parseOr();
      return { kind: "is", expr: e, not: notFlag, rhs, ...p };
    }
    return e;
  }

  function parseOr(): Expr {
    let e = parseAnd();
    while (at("||")) { const p = pos(); const op = advance().text; e = { kind: "binary", op, left: e, right: parseAnd(), ...p }; }
    return e;
  }

  function parseAnd(): Expr {
    let e = parseBitor();
    while (at("&&")) { const p = pos(); const op = advance().text; e = { kind: "binary", op, left: e, right: parseBitor(), ...p }; }
    return e;
  }

  function parseBitor(): Expr {
    let e = parseXor();
    while (at("|")) { const p = pos(); const op = advance().text; e = { kind: "binary", op, left: e, right: parseXor(), ...p }; }
    return e;
  }

  function parseXor(): Expr {
    let e = parseBitand();
    while (at("^")) { const p = pos(); const op = advance().text; e = { kind: "binary", op, left: e, right: parseBitand(), ...p }; }
    return e;
  }

  function parseBitand(): Expr {
    let e = parseEq();
    while (at("&")) { const p = pos(); const op = advance().text; e = { kind: "binary", op, left: e, right: parseEq(), ...p }; }
    return e;
  }

  function parseEq(): Expr {
    let e = parseRel();
    while (at("==") || at("!=")) { const p = pos(); const op = advance().text; e = { kind: "binary", op, left: e, right: parseRel(), ...p }; }
    return e;
  }

  function parseRel(): Expr {
    let e = parseShift();
    while (at("<") || at("<=") || at(">") || at(">=")) { const p = pos(); const op = advance().text; e = { kind: "binary", op, left: e, right: parseShift(), ...p }; }
    return e;
  }

  function parseShift(): Expr {
    let e = parseAdd();
    while (at("<<") || at(">>")) { const p = pos(); const op = advance().text; e = { kind: "binary", op, left: e, right: parseAdd(), ...p }; }
    return e;
  }

  function parseAdd(): Expr {
    let e = parseMul();
    while (at("+") || at("-")) { const p = pos(); const op = advance().text; e = { kind: "binary", op, left: e, right: parseMul(), ...p }; }
    return e;
  }

  function parseMul(): Expr {
    let e = parseCast();
    while (at("*") || at("/") || at("%")) { const p = pos(); const op = advance().text; e = { kind: "binary", op, left: e, right: parseCast(), ...p }; }
    return e;
  }

  function parseCast(): Expr {
    let e = parseUnary();
    while (at("as") || at("as!") || at("as~") || at("as@")) {
      const p = pos(); const op = advance().text; const type = parseType();
      e = { kind: "cast", op, expr: e, type, ...p };
    }
    return e;
  }

  function parseUnary(): Expr {
    const p = pos();
    if (at("-") || at("!") || at("~")) {
      const op = advance().text;
      return { kind: "unary", op, expr: parseUnary(), ...p };
    }
    return parsePostfix();
  }

  function parsePostfix(): Expr {
    let e = parsePrimary();
    while (true) {
      const p = pos();
      if (at(".")) {
        advance();
        const name = at("ident") ? advance().text : (err("expected field name"), "?");
        if (at("(")) {
          advance();
          const args = parseArgList();
          expect(")");
          e = { kind: "call", callee: { kind: "field", expr: e, name, ...p }, args, ...p };
        } else {
          e = { kind: "field", expr: e, name, ...p };
        }
      } else if (at("[")) {
        advance();
        const idx = parseExpr();
        expect("]");
        e = { kind: "index", expr: e, idx, ...p };
      } else if (at("!") && !at("=", 1)) {
        // Null unwrap: expr!  (but not expr!=)
        advance();
        e = { kind: "unwrap", expr: e, ...p };
      } else if (at("(")) {
        // Indirect call: expr(args) — for funcref calls and inline method refs
        advance();
        const args = parseArgList();
        expect(")");
        e = { kind: "call", callee: e, args, ...p };
      } else {
        break;
      }
    }
    return e;
  }

  function parseArgList(): Expr[] {
    const args: Expr[] = [];
    if (!at(")")) { args.push(parseExpr()); while (consume(",")) args.push(parseExpr()); }
    return args;
  }

  function parsePrimary(): Expr {
    const p = pos();
    if (at("null"))  { advance(); return { kind: "null", ...p }; }
    if (at("true"))  { advance(); return { kind: "bool", value: true, ...p }; }
    if (at("false")) { advance(); return { kind: "bool", value: false, ...p }; }
    if (at("int"))   { const v = advance().text; return { kind: "int", value: v, ...p }; }
    if (at("float")) { const v = advance().text; return { kind: "float", value: v, ...p }; }
    if (at("string")){ const v = advance().text; return { kind: "string", value: v, ...p }; }
    // `this` keyword as expression (inside method bodies)
    if (at("this"))  { advance(); return { kind: "ident", name: "this", ...p }; }

    // Grouping: ( expr )
    if (at("(")) {
      advance();
      const e = parseExpr();
      expect(")");
      return e;
    }

    // fn[R(P)][](args) — array of funcref construction
    if (at("fn")) {
      const fnType = parseType();
      if (fnType.kind === "array" && at("(")) {
        advance();
        const args = parseArgList();
        expect(")");
        return { kind: "arrNew", elem: fnType.elem, size: null, fixed: args, ...p };
      }
      err(`expected '(' for fn type array construction`);
      return { kind: "null", ...p };
    }

    // Construction or function call with a type or struct name prefix
    if (looksLikeConstructionOrCall()) {
      return parseConstructionOrCall(p);
    }

    // Simple identifier (variable reference)
    if (at("ident")) {
      const name = advance().text;
      return { kind: "ident", name, ...p };
    }

    err(`expected expression, found '${tok().text}'`);
    if (!at("eof") && !at(";") && !at("}")) advance();
    return { kind: "null", ...p };
  }

  // Check if current position starts a construction or static-call expression
  function looksLikeConstructionOrCall(): boolean {
    const t = tok();
    if (!at("ident")) return false;
    // Primitive type names: only for array construction (e.g. i32[N]() or i32[]())
    if (PRIM_TYPES.has(t.text)) {
      return at("(", 1) || at("[", 1);
    }
    // i31ref / anyref as construction (anyref used for i31ref casts etc.)
    if (t.text === "anyref" || t.text === "i31ref") return false;
    // Struct name: followed by (, {, or . (static call/ref)
    const next = tok(1);
    if (next.kind === ".") return true;
    if (next.kind === "(" || next.kind === "{") return true;
    // Struct name followed by [ or ?: only construction if () comes after the size bracket
    // Skip element-type suffix [] and ? pairs first, then check for [N]() or []()
    // e.g. Node[5]() → construction; arr[i] → indexing; Node[][3]() → construction
    if (next.kind === "[" || next.kind === "?") {
      let j = cur + 1; // point to [ or ?
      // Skip element-type suffix [] and ? pairs
      while (j < tokens.length) {
        if (tokens[j]?.kind === "[" && tokens[j + 1]?.kind === "]") { j += 2; }
        else if (tokens[j]?.kind === "?") { j++; }
        else break;
      }
      // Now j should point to the construction [ (size bracket)
      if (tokens[j]?.kind !== "[") return false;
      j++; // past [
      let depth = 1;
      while (j < tokens.length && depth > 0 && tokens[j].kind !== "eof") {
        if (tokens[j].kind === "[") depth++;
        else if (tokens[j].kind === "]") depth--;
        j++;
      }
      // For sized array construction T[N](), the () must be empty.
      // If () has args (like arr[i](5)), it's an index+funcref-call, not construction.
      return tokens[j]?.kind === "(" && tokens[j + 1]?.kind === ")";
    }
    return false;
  }

  function parseConstructionOrCall(p: Pos): Expr {
    // Parse element/struct type name (just the ident part, not array suffix yet)
    const name = advance().text; // struct or prim type name

    // Static method call or struct method ref: TypeName.methodName(...)
    if (at(".")) {
      advance(); // .
      const method = at("ident") ? advance().text : (err("expected method name"), "?");
      if (at("(")) {
        advance();
        const args = parseArgList();
        expect(")");
        return {
          kind: "call",
          callee: { kind: "field", expr: { kind: "ident", name, ...p }, name: method, ...p },
          args, ...p,
        };
      }
      // Funcref: TypeName.methodName without call = method reference value
      return { kind: "field", expr: { kind: "ident", name, ...p }, name: method, ...p };
    }

    // Array construction: elemType[N]() or elemType[]()
    // Element type may include [] and ? suffixes: i32[][3](), Node?[5]()
    if (at("[") || at("?")) {
      let elemType: WacType = PRIM_TYPES.has(name)
        ? { kind: "prim", name, ...p }
        : { kind: "struct", name, ...p };
      // Handle nullable element type: T? before the array brackets
      if (at("?")) {
        const nP = pos(); advance();
        elemType = { kind: "nullable", inner: elemType, ...nP };
      }
      // Consume [] pairs that are element type suffixes (not the final construction brackets)
      // Rule: [] followed by another [ (not followed by )) is an element type suffix
      while (at("[") && at("]", 1) && !at("(", 2)) {
        const arrP = pos(); advance(); advance(); // [ ]
        elemType = { kind: "array", elem: elemType, ...arrP };
      }
      advance(); // [
      if (!at("]")) {
        // T[N]() — sized default array
        const size = parseExpr();
        expect("]");
        expect("(");
        expect(")");
        return { kind: "arrNew", elem: elemType, size, fixed: [], ...p };
      } else {
        // T[]() — fixed array literal
        advance(); // ]
        expect("(");
        const args = parseArgList();
        expect(")");
        return { kind: "arrNew", elem: elemType, size: null, fixed: args, ...p };
      }
    }

    // Struct named construction: TypeName { field: val, ... }
    if (at("{")) {
      advance();
      const named: { name: string; val: Expr }[] = [];
      if (!at("}")) {
        do {
          const fn = at("ident") ? advance().text : (err("expected field name"), "?");
          expect(":");
          named.push({ name: fn, val: parseExpr() });
        } while (consume(","));
      }
      expect("}");
      const t: WacType = { kind: "struct", name, ...p };
      return { kind: "construct", ctype: t, args: [], named, ...p };
    }

    // Struct positional construction: TypeName(args)
    if (at("(")) {
      advance();
      const args = parseArgList();
      expect(")");
      const t: WacType = PRIM_TYPES.has(name)
        ? { kind: "prim", name, ...p }
        : { kind: "struct", name, ...p };
      return { kind: "construct", ctype: t, args, ...p };
    }

    err(`expected '(' or '{' after type name '${name}'`);
    return { kind: "ident", name, ...p };
  }

  // ── Lvalue parsing ────────────────────────────────────────────────────────

  function parseLvalue(): Lvalue {
    const p = pos();
    // `this` is a valid lvalue root in method bodies
    const name = (at("ident") || at("this")) ? advance().text : (err("expected identifier"), "?");
    let lv: Lvalue = { kind: "lv-ident", name, ...p };
    while (true) {
      const pp = pos();
      if (at(".")) {
        advance();
        const field = at("ident") ? advance().text : (err("expected field name"), "?");
        lv = { kind: "lv-field", base: lv, field, ...pp };
      } else if (at("[")) {
        advance();
        const idx = parseExpr();
        expect("]");
        lv = { kind: "lv-index", base: lv, idx, ...pp };
      } else if (at("!")) {
        advance();
        lv = { kind: "lv-unwrap", base: lv, ...pp };
      } else {
        break;
      }
    }
    return lv;
  }

  // ── Statement parsing ─────────────────────────────────────────────────────

  function parseBlock(): Block {
    const p = pos();
    expect("{");
    const stmts: Stmt[] = [];
    while (!at("}") && !at("eof")) stmts.push(parseStatement());
    expect("}");
    return { stmts, ...p };
  }

  function parseStatement(): Stmt {
    const p = pos();

    if (at("if"))       return parseIfStmt();
    if (at("while"))    return parseWhileStmt();
    if (at("for"))      return parseForStmt();
    if (at("do"))       return parseDoWhileStmt();
    if (at("switch"))   return parseSwitchStmt();
    if (at("return")) {
      advance();
      const value = at(";") ? null : parseExpr();
      expect(";");
      return { kind: "return", value, ...p };
    }
    if (at("break"))    { advance(); expect(";"); return { kind: "break", ...p }; }
    if (at("continue")) { advance(); expect(";"); return { kind: "continue", ...p }; }
    if (at("trap"))     { advance(); expect(";"); return { kind: "trap", ...p }; }
    if (at("{"))        return { kind: "block", block: parseBlock(), ...p };

    // Variable declaration
    if (looksLikeVarDecl()) return parseVarDecl();

    // Assignment / compound / incr — or expression statement
    // Try to parse lvalue then check for assignment operator
    // `this` can be an lvalue root in method bodies
    if (at("ident") || at("this")) {
      const savedCur = cur;
      const lv = parseLvalue();
      if (at("=")) {
        advance(); const rhs = parseExpr(); expect(";");
        return { kind: "assign", op: "=", lval: lv, rhs, ...p };
      }
      if (COMPOUND_OPS.has(tok().text)) {
        const op = advance().text; const rhs = parseExpr(); expect(";");
        return { kind: "assign", op, lval: lv, rhs, ...p };
      }
      if (at("++") || at("--")) {
        const op = advance().text as "++" | "--"; expect(";");
        return { kind: "incr", op, lval: lv, ...p };
      }
      // Not an assignment — restore and parse as expression
      cur = savedCur;
    }

    const expr = parseExpr();
    expect(";");
    return { kind: "expr", expr, ...p };
  }

  function parseVarDecl(noSemi = false): Stmt {
    const p = pos();
    const isConst = at("const") ? (advance(), true) : false;
    const type = parseType();
    const name = at("ident") ? advance().text : (err("expected variable name"), "?");
    expect("=");
    const init = parseExpr();
    if (!noSemi) expect(";");
    return { kind: "var", isConst, type, name, init, ...p };
  }

  function parseIfStmt(): Stmt {
    const p = pos(); advance(); // if
    expect("("); const cond = parseExpr(); expect(")");
    const then = parseBlock();
    let els: ElseBranch = null;
    if (consume("else")) {
      const ep = pos();
      if (at("if")) {
        els = { kind: "else-if", stmt: parseIfStmt(), ...ep };
      } else {
        els = { kind: "else-block", block: parseBlock(), ...ep };
      }
    }
    return { kind: "if", cond, then, els, ...p };
  }

  function parseWhileStmt(): Stmt {
    const p = pos(); advance();
    expect("("); const cond = parseExpr(); expect(")");
    return { kind: "while", cond, body: parseBlock(), ...p };
  }

  function parseForStmt(): Stmt {
    const p = pos(); advance(); // for
    expect("(");

    let init: Stmt | null = null;
    if (!at(";")) {
      if (looksLikeVarDecl()) {
        init = parseVarDecl(true);
      } else {
        const ip = pos();
        if (at("ident")) {
          const lv = parseLvalue();
          if (at("=")) { advance(); init = { kind: "assign", op: "=", lval: lv, rhs: parseExpr(), ...ip }; }
          else if (COMPOUND_OPS.has(tok().text)) { const op = advance().text; init = { kind: "assign", op, lval: lv, rhs: parseExpr(), ...ip }; }
          else if (at("++") || at("--")) { const op = advance().text as "++" | "--"; init = { kind: "incr", op, lval: lv, ...ip }; }
          else err("expected assignment in for init");
        }
      }
    }
    expect(";");
    const cond = at(";") ? null : parseExpr();
    expect(";");

    let update: Stmt | null = null;
    if (!at(")")) {
      const up = pos();
      if (at("ident")) {
        const lv = parseLvalue();
        if (at("=")) { advance(); update = { kind: "assign", op: "=", lval: lv, rhs: parseExpr(), ...up }; }
        else if (COMPOUND_OPS.has(tok().text)) { const op = advance().text; update = { kind: "assign", op, lval: lv, rhs: parseExpr(), ...up }; }
        else if (at("++") || at("--")) { const op = advance().text as "++" | "--"; update = { kind: "incr", op, lval: lv, ...up }; }
        else err("expected assignment in for update");
      }
    }
    expect(")");
    return { kind: "for", init, cond, update, body: parseBlock(), ...p };
  }

  function parseDoWhileStmt(): Stmt {
    const p = pos(); advance(); // do
    const body = parseBlock();
    expect("while"); expect("("); const cond = parseExpr(); expect(")"); expect(";");
    return { kind: "dowhile", body, cond, ...p };
  }

  function parseSwitchBody(): Stmt[] {
    // Case bodies can be wrapped in { } or just bare statements
    if (at("{")) {
      // Check if this is a block wrapper (case 0: { stmts... })
      // vs a block statement (case 0: { } { })
      // Convention: treat single { } as the case body block
      advance(); // {
      const stmts: Stmt[] = [];
      while (!at("}") && !at("eof")) stmts.push(parseStatement());
      expect("}");
      return stmts;
    }
    const stmts: Stmt[] = [];
    while (!at("case") && !at("default") && !at("}") && !at("eof")) stmts.push(parseStatement());
    return stmts;
  }

  function parseSwitchStmt(): Stmt {
    const p = pos(); advance(); // switch
    expect("("); const expr = parseExpr(); expect(")"); expect("{");
    const cases: SwitchCase[] = [];
    while (!at("}") && !at("eof")) {
      const cp = pos();
      if (at("case")) {
        advance();
        const value = parseExpr(); expect(":");
        const body = parseSwitchBody();
        cases.push({ value, body, ...cp });
      } else if (at("default")) {
        advance(); expect(":");
        const body = parseSwitchBody();
        cases.push({ value: "default", body, ...cp });
      } else {
        err(`expected 'case' or 'default', found '${tok().text}'`); advance();
      }
    }
    expect("}");
    return { kind: "switch", expr, cases, ...p };
  }

  // ── Top-level parsing ─────────────────────────────────────────────────────

  function parseImport(): Import {
    const p = pos(); advance(); // import
    expect("{");
    const items: ImportItem[] = [];
    do {
      const ip = pos();
      const name = at("ident") ? advance().text : (err("expected identifier"), "?");
      const alias = consume("as") ? (at("ident") ? advance().text : (err("expected alias"), "?")) : name;
      items.push({ name, alias, ...ip });
    } while (consume(","));
    expect("}"); expect("from");
    const path = at("string") ? advance().text : (err("expected file path string"), "?");
    expect(";");
    return { tag: "import", path, items, ...p };
  }

  function parseParam(): Param {
    const p = pos();
    const type = parseType();
    const name = at("ident") ? advance().text : (err("expected parameter name"), "?");
    return { type, name, ...p };
  }

  function parseStructDecl(): StructDecl {
    const p = pos();
    const isConst = consume("const");
    advance(); // struct
    const name = at("ident") ? advance().text : (err("expected struct name"), "?");
    const parent = consume(":") ? (at("ident") ? advance().text : (err("expected parent name"), "?")) : null;
    expect("{");

    const fields: FieldDecl[] = [];
    const methods: MethodDecl[] = [];

    while (!at("}") && !at("eof")) {
      const mp = pos();
      const isOverride = consume("override");
      // const field vs non-const: "const type name;" — but not "const this"
      const fieldConst = !isOverride && at("const") && tok(1).kind !== "this";
      if (fieldConst) advance(); // consume const

      const memberType = parseType();
      const memberName = at("ident") ? advance().text : (err("expected member name"), "?");

      if (at(";")) {
        // Field declaration
        advance();
        if (isOverride) err(`'override' not valid on field`);
        fields.push({ isConst: fieldConst, type: memberType, name: memberName, ...mp });
      } else if (at("(")) {
        // Method declaration
        advance();
        let hasThis = false;
        let thisConst = false;
        const params: Param[] = [];

        if (!at(")")) {
          if (at("const") && tok(1).text === "this") {
            thisConst = true; advance(); hasThis = true; advance(); // const this
            if (consume(",")) { do { params.push(parseParam()); } while (consume(",")); }
          } else if (at("this")) {
            hasThis = true; advance();
            if (consume(",")) { do { params.push(parseParam()); } while (consume(",")); }
          } else {
            do { params.push(parseParam()); } while (consume(","));
          }
        }
        expect(")");
        methods.push({ isOverride, returnType: memberType, name: memberName, hasThis, thisConst, params, body: parseBlock(), ...mp });
      } else {
        err(`expected ';' or '(' after member '${memberName}'`);
        while (!at("}") && !at(";") && !at("eof")) advance();
        consume(";");
      }
    }
    expect("}");
    return { tag: "struct", isConst, name, parent, fields, methods, ...p };
  }

  function parseFuncDecl(): FuncDecl {
    const p = pos();
    const exported = consume("export");
    const returnType = parseType();
    const name = at("ident") ? advance().text : (err("expected function name"), "?");
    expect("(");
    const params: Param[] = [];
    if (!at(")")) { do { params.push(parseParam()); } while (consume(",")); }
    expect(")");
    const body = parseBlock();
    return { tag: "func", exported, returnType, name, params, body, ...p };
  }

  // ── Main parse loop ───────────────────────────────────────────────────────

  const items: TopLevel[] = [];
  while (!at("eof")) {
    if (at("import")) {
      items.push(parseImport());
    } else if (at("struct") || (at("const") && at("struct", 1))) {
      items.push(parseStructDecl());
    } else if (at("export") && at("struct", 1)) {
      // export struct — consume 'export' then parse struct (export is cosmetic at top level for structs)
      advance(); // skip 'export'
      items.push(parseStructDecl());
    } else if (at("export") || at("fn") || at("void") || (at("ident"))) {
      items.push(parseFuncDecl());
    } else {
      err(`unexpected token '${tok().text}' at top level`);
      advance();
    }
  }

  return { program: { items }, errors };
}
