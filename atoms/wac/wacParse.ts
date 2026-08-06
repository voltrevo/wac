// Parser for wac — converts a token array into an AST.
// Returns a Program node and any parse errors (partial AST on error).

import { type Token, type TokenKind } from "./wacLex.ts";
import { CORE } from "./wacCore.ts";

// ── AST node types ────────────────────────────────────────────────────────────

export type Pos = { line: number; col: number };

// Types -----------------------------------------------------------------------

export type WacType =
  | ({ kind: "prim";     name: string } & Pos)
  // `name` is the struct name as written (possibly an import alias) — struct
  // declarations are only unique within their own file, so two files can
  // declare the same bare name. `resolvedTypeIndex`, when known, is the
  // globally-unique StructEntry.typeIndex this reference actually points to;
  // consumers should prefer it over re-resolving `name` through a bare-name
  // map. It's optional because the parser can't know it (resolution happens
  // later) — set it wherever a WacType is reconstructed from an
  // already-resolved StructEntry/FuncEntry instead of from source text.
  // `typeArgs` are the arguments of a generic reference — `Vec<i32>` parses as a struct type
  // named `Vec` with one argument. The resolver substitutes them and registers a concrete
  // struct, so nothing after the resolver ever sees a non-empty `typeArgs`.
  | ({ kind: "struct";   name: string; resolvedTypeIndex?: number; typeArgs?: WacType[] } & Pos)
  | ({ kind: "array";    elem: WacType } & Pos)
  | ({ kind: "nullable"; inner: WacType } & Pos)
  | ({ kind: "funcref";  params: WacType[]; ret: WacType } & Pos);

// Expressions -----------------------------------------------------------------

export type Expr =
  // `resolved` is filled in by wacTypeCheck when the literal takes its type
  // from context (`u32 x = 5`). The emitter reads it rather than re-deciding,
  // so the two cannot disagree about a literal's width or signedness.
  | ({ kind: "int";      value: string; resolved?: WacType } & Pos)
  // `resolved` is filled in by the type checker when the literal took its type from
  // context rather than from its own notation — see the `int` case above; floats follow
  // the same rule, so they carry the same annotation.
  | ({ kind: "float";    value: string; resolved?: WacType } & Pos)
  | ({ kind: "string";   value: string } & Pos)
  | ({ kind: "bool";     value: boolean } & Pos)
  | ({ kind: "null" } & Pos)
  // `constRef` is set by wacTypeCheck when the name resolves to a module-level
  // constant. Recording the declaration here means neither typeOfExpr nor the
  // emitter needs to know which file it is in — the same reason `resolved`
  // exists on int literals.
  | ({ kind: "ident";    name: string; constRef?: ConstDecl } & Pos)
  | ({ kind: "unary";    op: string; expr: Expr } & Pos)
  | ({ kind: "binary";   op: string; left: Expr; right: Expr } & Pos)
  | ({ kind: "cast";     op: string; expr: Expr; type: WacType } & Pos)
  | ({ kind: "is";       expr: Expr; not: boolean; rhs: WacType | "null" | Expr } & Pos)
  /**
   * `resultType` is the unified branch type, filled in by the type checker and read by the
   * emitter — the same annotate-then-consume arrangement `matchExpr` uses, and for the same
   * reason: both used to derive it independently and drifted [issue 0051].
   */
  | ({ kind: "ternary";  cond: Expr; then: Expr; else_: Expr; resultType?: WacType } & Pos)
  | ({ kind: "call";     callee: Expr; args: Expr[]; variantTypeIndex?: number } & Pos)
  | ({ kind: "index";    expr: Expr; idx: Expr } & Pos)
  // `variantTypeIndex` is filled in by the type checker when this field access is
  // really a payload-less variant value (`Shape.Point`), and likewise on the `call`
  // node for `Shape.Circle(2.0)`. The emitter needs the *resolved* variant, and it
  // has no file scope to resolve a name in — it used to search the program's enums by
  // name, which picked the wrong enum whenever two files declared the same name.
  | ({ kind: "field";    expr: Expr; name: string; variantTypeIndex?: number } & Pos)
  | ({ kind: "unwrap";   expr: Expr } & Pos)
  | ({ kind: "construct"; ctype: WacType; args: Expr[]; named?: { name: string; val: Expr }[] } & Pos)
  // `size` is the sized form `T[n](...)`, `fixed` the literal form `T[](a, b)`; exactly
  // one is used. `fill` is the sized form's optional element value, written
  // `T[n](fill: v)` — named-argument syntax because `T[n](v)` would be ambiguous with
  // indexing a funcref array and calling it, `arr[i](5)`.
  | ({ kind: "arrNew";   elem: WacType; size: Expr | null; fixed: Expr[]; fill?: Expr } & Pos)
  // `match` in expression position: every arm gives a value rather than statements.
  // `enumBaseTypeIndex` is filled in by the checker, exactly as on the statement form.
  // `resultType` is the unified arm type, filled in by the checker so the emitter can
  // declare the block's result without re-deriving it.
  | ({ kind: "matchExpr"; subject: Expr; arms: MatchArm[]; enumBaseTypeIndex?: number;
       resultType?: WacType } & Pos)
  // ++/-- as an expression: postfix evaluates to the old value, prefix to the
  // new one. The operand must be an lvalue (variable, field, array element).
  | ({ kind: "incr-expr"; op: "++" | "--"; prefix: boolean; lval: Lvalue } & Pos);

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
  // `narrowName`/`narrowTypeIndex` are filled in by the type checker when the condition is
  // `ident is Type`: the name is shadowed at the narrower type inside the then-block, which
  // the emitter needs a local and a cast for [see issue 0029].
  | ({ kind: "if";       cond: Expr; then: Block; els: ElseBranch;
       narrowName?: string; narrowTypeIndex?: number } & Pos)
  | ({ kind: "while";    cond: Expr; body: Block } & Pos)
  | ({ kind: "for";      init: Stmt | null; cond: Expr | null; update: Stmt | null; body: Block } & Pos)
  | ({ kind: "dowhile";  body: Block; cond: Expr } & Pos)
  | ({ kind: "switch";   expr: Expr; cases: SwitchCase[] } & Pos)
  | ({ kind: "match";    subject: Expr; arms: MatchArm[];
        /** Type index of the enum's base struct; set by the type checker. */
        enumBaseTypeIndex?: number } & Pos)
  | ({ kind: "return";   value: Expr | null } & Pos)
  | ({ kind: "break" } & Pos)
  | ({ kind: "continue" } & Pos)
  | ({ kind: "trap"; value?: Expr } & Pos)
  | ({ kind: "block";    block: Block } & Pos)
  | ({ kind: "expr";     expr: Expr } & Pos);

// else branch: another if, or a plain block (null = no else)
export type ElseBranch = ({ kind: "else-if"; stmt: Stmt } & Pos) | ({ kind: "else-block"; block: Block } & Pos) | null;

/**
 * One `match` arm.
 *
 * `variant` is null for the `else` arm. `bindings` names the payload fields
 * positionally; an empty array means the pattern omitted its parentheses, which
 * ignores every payload. A binding named `_` is a deliberate discard and may repeat.
 */
export type MatchArm = {
  variant: string | null;
  bindings: string[];
  body: Stmt[];
  /**
   * The arm's value, when the `match` is an expression rather than a statement. `body` is
   * empty in that case and this is set; the two forms share everything else, including the
   * annotations below, so the checker and emitter differ only in what they do with the
   * arm's contents.
   */
  value?: Expr;
  /**
   * Filled in by the type checker, consumed by the emitter — the same
   * annotate-then-consume arrangement the resolver uses for `resolvedTypeIndex`.
   *
   * The emitter cannot work these out for itself: local allocation runs over the AST
   * with no access to the enum table, so a payload's type has to be recorded here or
   * it is unavailable when locals are declared.
   */
  tag?: number;
  variantTypeIndex?: number;
  bindingTypes?: WacType[];
} & Pos;

export type Block      = { stmts: Stmt[] } & Pos;
export type SwitchCase = { value: Expr | "default"; body: Stmt[] } & Pos;

// Top-level -------------------------------------------------------------------

/**
 * `injected` marks an import the *compiler* added rather than the author.
 *
 * Monomorphisation puts a materialised struct in its template's file, so any type its arguments
 * mention has to resolve from there — and the author wrote the type argument at the use site, not
 * an import. `export` governs what one author may take from another's file; it has nothing to say
 * about the bookkeeping that makes a generated copy resolve, so an injected import is exempt from
 * it.
 */
export type ImportItem = { name: string; alias: string; injected?: boolean } & Pos;
/**
 * `prefix` names a provider rather than a directory: the sources it offers need not be files, and
 * `path` is then the module *inside* that provider (empty for a provider of one module, as `core`
 * is today). With no `prefix`, `path` is an ordinary relative file path and means what it always
 * did. Either way `importKey` in wacResolve is what turns the pair into the key a program is filed
 * under — nothing else should be joining paths.
 */
export type Import     = { tag: "import"; path: string; prefix?: string; items: ImportItem[] } & Pos;

/**
 * `isConst` records a leading `const` on the parameter, which forbids reassigning it and
 * — because const is deep — mutating anything reachable through it. It is the same
 * guarantee `const this` gives a method receiver, which was previously available to
 * methods and to nothing else.
 */
export type Param      = { isConst: boolean; type: WacType; name: string } & Pos;
export type FieldDecl  = { isConst: boolean; type: WacType; name: string } & Pos;
export type MethodDecl = {
  isOverride: boolean; returnType: WacType; name: string;
  hasThis: boolean; thisConst: boolean; params: Param[];
  body: Block;
} & Pos;

export type StructDecl = {
  tag: "struct"; isConst: boolean; exported: boolean; name: string; parent: string | null;
  fields: FieldDecl[]; methods: MethodDecl[];
  /**
   * Type parameter names, for a generic struct: `struct Vec<T>` has `["T"]`.
   *
   * A declaration with type parameters is a *template*. The resolver monomorphises it — one
   * concrete struct per distinct set of arguments — so the type checker and the emitter never
   * see one, exactly as they never see an `enum`.
   */
  typeParams: string[];
} & Pos;

export type FuncDecl = {
  tag: "func"; exported: boolean; returnType: WacType; name: string;
  params: Param[]; body: Block;
  /**
   * Type parameter names, for a generic function: `T max<T>(T a, T b)` has `["T"]`.
   *
   * As with a generic struct, a declaration with type parameters is a *template* — the resolver
   * monomorphises it and nothing downstream sees one. Unlike a struct, the arguments are never
   * written at the use site: they are inferred from the argument types.
   */
  typeParams: string[];
} & Pos;

/** One variant of an enum, with named payload fields. */
export type VariantDecl = {
  name: string;
  fields: Param[];
} & Pos;

export type EnumDecl = {
  tag: "enum"; exported: boolean; name: string;
  variants: VariantDecl[];
  /** `enum Option<T>` has ["T"]. Empty for an ordinary enum. */
  typeParams: string[];
  /**
   * Methods declared in the enum body, after the variants. They attach to the enum's
   * generated base struct, so `this` is the enum type and `match (this)` is how a method
   * reaches a variant.
   */
  methods: MethodDecl[];
} & Pos;

/**
 * A module-level constant. `init` must be a compile-time constant expression;
 * the type checker enforces that and the emitter substitutes it at each use,
 * so there is no storage and no initialisation order to worry about.
 */
export type ConstDecl = {
  tag: "const"; exported: boolean; type: WacType; name: string; init: Expr;
} & Pos;

export type TopLevel = Import | StructDecl | FuncDecl | EnumDecl | ConstDecl;
export type Program  = { items: TopLevel[] };

export type ParseError = { message: string; file: string; line: number; col: number; span?: number; annotation?: string; hint?: string };
export type ParseResult = { program: Program; errors: ParseError[] };

// ── Parser ────────────────────────────────────────────────────────────────────

const PRIM_TYPES = new Set([
  "i32", "i64", "u32", "u64", "f32", "f64", "bool", "void", "string",
  "anyref", "i31ref", "i8", "i16", "u8", "u16",
]);

const COMPOUND_OPS = new Set([
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=", ">>>=",
]);

/**
 * The parser, as an object with several entry points.
 *
 * wac is no longer the only surface syntax — `wapyParse` reads an indentation-based one — and
 * the two differ in their *structure*, not in their expressions. So the expression and type
 * grammar is shared rather than reimplemented, and this is where the sharing happens: a second
 * frontend parses its own declarations and statements, and calls `expression` and `type` for
 * everything below that.
 *
 * The alternative was for the other frontend to rewrite its tokens into wac's shape and let
 * this parse the result. That works and it was the first attempt; it is also why malformed
 * input in the other surface produced messages about tokens nobody had written, and in two
 * cases produced none at all. A frontend that does not parse cannot diagnose.
 */
export function makeParser(tokens: Token[], file: string) {
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

  /**
   * Rewrite the current token, for splitting a munched `>>` or `>>>` in a type argument list.
   *
   * `Vec<Vec<i32>>` ends in what the lexer read as a single shift operator. Rather than make the
   * lexer track nesting — which would mean it could no longer be a pure token stream — the
   * parser consumes one `>` worth and leaves the rest in place.
   */
  function replaceCurrent(text: string): void {
    const t = tokens[cur];
    tokens[cur] = { ...t, kind: text as typeof t.kind, text, col: t.col + 1 };
  }

  function consume(k: string): boolean {
    if (at(k)) { advance(); return true; }
    return false;
  }

  function err(msg: string, offset = 0): void {
    const t = tok(offset);
    errors.push({ message: msg, file, line: t.line, col: t.col });
  }

  /**
   * A keyword token, told apart from an identifier without importing the lexer's set.
   *
   * The lexer gives a keyword a `kind` equal to its own text, which no identifier has —
   * an identifier is always kind `"ident"`. Punctuation shares that property, so the text
   * has to look like a word as well.
   */
  function isKeyword(t: Token | undefined): boolean {
    return t !== undefined && t.kind === t.text && /^[a-z]+$/.test(t.text);
  }

  /**
   * The name in a declaration, or a diagnostic that says why there isn't one.
   *
   * Worth its own function because of what the message used to be. `from` was once a
   * keyword, and a parameter named `from` — in `slice(a, from, to)`, which is where such a
   * name naturally goes — reported a missing semicolon at the *next* declaration, a
   * hundred lines further on. Naming the keyword at the place it appears is the whole
   * difference between a five-second fix and a bisect.
   */
  function declName(what: string): string {
    if (at("ident")) return advance().text;
    const t = tok();
    if (isKeyword(t)) {
      err(`'${t.text}' is a keyword and cannot be used as a ${what}`);
      // Consumed, so the rest of the declaration still parses and one mistake yields one
      // error rather than a cascade of them.
      advance();
      return t.text;
    }
    err(`expected ${what}`);
    return "?";
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

    // `Vec<i32>` — type arguments. Only in *type* position, never in an expression, because
    // `IDENT <` is ambiguous with less-than there. wac can afford the restriction because every
    // declaration is explicitly typed, so a generic construction always has an expected type to
    // take its arguments from [see the design note and generics.md].
    const typeArgs = PRIM_TYPES.has(name) ? undefined : parseTypeArgs();

    let base: WacType = PRIM_TYPES.has(name)
      ? { kind: "prim", name, ...p }
      : { kind: "struct", name, typeArgs, ...p };

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
    // Skip a type-argument list: `Vec<i32> v = ...` is a declaration, and without this the
    // statement parsed as the expression `Vec < i32` and failed at the `=`.
    //
    // This is where the classic C++ ambiguity would live, and wac gets off lightly: the scan
    // requires a balanced `<...>` *followed by an identifier*, so `a < b;` and `f(a < b)` are
    // unaffected. It does claim `a < b > c` as a declaration of `c`, which in expression terms
    // would be `(a < b) > c` — comparing a bool, which wac rejects anyway.
    if (tokens[j]?.kind === "<") {
      let depth = 0;
      // A type argument can contain parentheses and brackets — `Box<fn[i32(i32)]>` — so the scan
      // tracks those too. Bailing on any `)` was wrong for exactly that case: the funcref's own
      // `)` ended the scan, the declaration was read as an expression, and `fn` then failed in
      // expression position with a message about array construction.
      let group = 0;
      let k = j;
      while (k < tokens.length && tokens[k]?.kind !== "eof") {
        const kind = tokens[k].kind as string;
        if (kind === "(" || kind === "[") group++;
        else if (kind === ")" || kind === "]") {
          if (group === 0) break;        // a closer we never opened: not a type list
          group--;
        } else if (kind === "<") depth++;
        else if (kind === ">") { depth--; if (depth === 0) { k++; break; } }
        // `Vec<Vec<i32>>` closes with a munched `>>`; parseType splits it, and the scan has to
        // account for both halves here or the depth never reaches zero.
        else if (kind === ">>") { depth -= 2; if (depth <= 0) { k++; break; } }
        else if (kind === ">>>") { depth -= 3; if (depth <= 0) { k++; break; } }
        else if (kind === ";" || kind === "{") break;   // not a type list
        k++;
      }
      if (depth <= 0 && k > j) j = k;
    }
    // Skip interleaved ? and [] suffixes (matching parseType's suffix logic)
    while (true) {
      if (tokens[j]?.kind === "[" && tokens[j+1]?.kind === "]") { j += 2; }
      else if (tokens[j]?.kind === "?") { j++; }
      else break;
    }
    // Expect an identifier (variable name) next
    if (tokens[j]?.kind === "ident") return true;
    // ...or a keyword where the name should be, but only when an `=` follows it. Without
    // that guard `x as i32;` would be read as a declaration named `as`; with it, only
    // `i32 match = ...` is claimed, and `parseVarDecl` can then say which word is the
    // problem instead of reporting a missing semicolon further down the file.
    return isKeyword(tokens[j]) && tokens[j + 1]?.kind === "=";
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
           at("(") || at("!") || at("~") || at("-") ||
           at("ident") || at("true") || at("false") || at("this"));
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
    while (at("||")) { const p = pos(); const op = advance().kind; e = { kind: "binary", op, left: e, right: parseAnd(), ...p }; }
    return e;
  }

  function parseAnd(): Expr {
    let e = parseBitor();
    while (at("&&")) { const p = pos(); const op = advance().kind; e = { kind: "binary", op, left: e, right: parseBitor(), ...p }; }
    return e;
  }

  function parseBitor(): Expr {
    let e = parseXor();
    while (at("|")) { const p = pos(); const op = advance().kind; e = { kind: "binary", op, left: e, right: parseXor(), ...p }; }
    return e;
  }

  function parseXor(): Expr {
    let e = parseBitand();
    while (at("^")) { const p = pos(); const op = advance().kind; e = { kind: "binary", op, left: e, right: parseBitand(), ...p }; }
    return e;
  }

  function parseBitand(): Expr {
    let e = parseEq();
    while (at("&")) { const p = pos(); const op = advance().kind; e = { kind: "binary", op, left: e, right: parseEq(), ...p }; }
    return e;
  }

  function parseEq(): Expr {
    let e = parseRel();
    while (at("==") || at("!=")) { const p = pos(); const op = advance().kind; e = { kind: "binary", op, left: e, right: parseRel(), ...p }; }
    return e;
  }

  function parseRel(): Expr {
    let e = parseShift();
    while (at("<") || at("<=") || at(">") || at(">=")) { const p = pos(); const op = advance().kind; e = { kind: "binary", op, left: e, right: parseShift(), ...p }; }
    return e;
  }

  function parseShift(): Expr {
    let e = parseAdd();
    while (at("<<") || at(">>") || at(">>>")) { const p = pos(); const op = advance().kind; e = { kind: "binary", op, left: e, right: parseAdd(), ...p }; }
    return e;
  }

  function parseAdd(): Expr {
    let e = parseMul();
    while (at("+") || at("-")) { const p = pos(); const op = advance().kind; e = { kind: "binary", op, left: e, right: parseMul(), ...p }; }
    return e;
  }

  function parseMul(): Expr {
    let e = parseCast();
    while (at("*") || at("/") || at("%")) { const p = pos(); const op = advance().kind; e = { kind: "binary", op, left: e, right: parseCast(), ...p }; }
    return e;
  }

  function parseCast(): Expr {
    let e = parseUnary();
    while (at("as") || at("as!") || at("as~") || at("as@")) {
      const p = pos(); const op = advance().kind; const type = parseType();
      e = { kind: "cast", op, expr: e, type, ...p };
    }
    return e;
  }

  /** Convert an already-parsed expression to an Lvalue (for ++/-- operands),
   *  or null if it isn't one. */
  function exprToLvalue(e: Expr): Lvalue | null {
    const pp = { line: e.line, col: e.col };
    switch (e.kind) {
      case "ident": return { kind: "lv-ident", name: e.name, ...pp };
      case "field": {
        const base = exprToLvalue(e.expr);
        return base && { kind: "lv-field", base, field: e.name, ...pp };
      }
      case "index": {
        const base = exprToLvalue(e.expr);
        return base && { kind: "lv-index", base, idx: e.idx, ...pp };
      }
      case "unwrap": {
        const base = exprToLvalue(e.expr);
        return base && { kind: "lv-unwrap", base, ...pp };
      }
      default: return null;
    }
  }

  // Operators are recorded by *kind*, not by the text the author wrote. For wac the two are the
  // same string; for wapy they are not — `and` is a `&&` — and the AST records which operator
  // this is, not how it was spelled.
  function parseUnary(): Expr {
    const p = pos();
    if (at("-") || at("!") || at("~")) {
      const op = advance().kind;
      return { kind: "unary", op, expr: parseUnary(), ...p };
    }
    if (at("++") || at("--")) {
      const op = advance().kind as "++" | "--";
      const operand = parseUnary();
      const lval = exprToLvalue(operand);
      if (!lval) {
        err(`'${op}' requires a variable, field, or array element`);
        return operand;
      }
      return { kind: "incr-expr", op, prefix: true, lval, ...p };
    }
    return parsePostfix();
  }

  function parsePostfix(): Expr {
    let e = parsePrimary();
    while (true) {
      const p = pos();
      if (at(".")) {
        advance();
        const name = declName("field name");
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
      } else if (at("++") || at("--")) {
        const op = advance().kind as "++" | "--";
        const lval = exprToLvalue(e);
        if (!lval) {
          err(`'${op}' requires a variable, field, or array element`);
          break;
        }
        e = { kind: "incr-expr", op, prefix: false, lval, ...p };
      } else {
        break;
      }
    }
    return e;
  }

  function parseArgList(): Expr[] {
    const args: Expr[] = [];
    if (at(")")) return args;
    do {
      if (at(")")) break;   // trailing comma
      args.push(parseExpr());
    } while (consume(","));
    return args;
  }

  function parsePrimary(): Expr {
    const p = pos();
    if (at("null"))  { advance(); return { kind: "null", ...p }; }
    if (at("true"))  { advance(); return { kind: "bool", value: true, ...p }; }
    if (at("false")) { advance(); return { kind: "bool", value: false, ...p }; }
    if (at("int"))   { const v = advance().text; return { kind: "int", value: v, ...p }; }
    if (at("float")) { const v = advance().text; return { kind: "float", value: v, ...p }; }
    // Matched on kind, not through at(): at() falls back to comparing token text,
    // so at("string") also matches the *identifier* `string` and would turn a
    // bare `string` in an expression into the literal "string".
    if (tok().kind === "string") { const v = advance().text; return { kind: "string", value: v, ...p }; }
    // `this` keyword as expression (inside method bodies)
    if (at("this"))  { advance(); return { kind: "ident", name: "this", ...p }; }

    // Grouping: ( expr )
    if (at("(")) {
      advance();
      const e = parseExpr();
      expect(")");
      return e;
    }

    // `match (subject) { case P: value, ... }` as an expression. Reuses `case P:` from the
    // statement form so there is one arm syntax in the language; what follows the colon is
    // an expression, and arms are comma-separated. Which form is being parsed is decided by
    // position, not by syntax, so nothing is ambiguous.
    if (at("match")) return parseMatchExpr();

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
      // `?` as well as `[`: `i32?[3]()` is an array of nullable primitives, which is the same
      // shape as `Node?[3]()` and was accepted only for the named case.
      return at("(", 1) || at("[", 1) || (at("?", 1) && at("[", 2));
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
    // `Vec<i32>[0]()` — an array whose element type is generic. Skip the argument list so the
    // scan below sees the construction brackets.
    if (next.kind === "<") {
      let depth = 0;
      let k = cur + 1;
      while (k < tokens.length && tokens[k]?.kind !== "eof") {
        const kind = tokens[k].kind as string;
        if (kind === "<") depth++;
        else if (kind === ">") { depth--; if (depth === 0) { k++; break; } }
        else if (kind === ">>") { depth -= 2; if (depth <= 0) { k++; break; } }
        else if (kind === ">>>") { depth -= 3; if (depth <= 0) { k++; break; } }
        else if (kind === ";" || kind === "{") break;
        k++;
      }
      if (depth <= 0 && k > cur + 1) {
        const after = tokens[k]?.kind;
        // `?` belongs here as much as `[`: `MapEntry<K, V>?[8]()` is an array of nullable
        // instantiations, which is how a hash table represents an empty slot.
        return after === "[" || after === "(" || after === "{" || after === "?";
      }
      return false;
    }
    if (next.kind === "[" || next.kind === "?") {
      let j = cur + 1; // point to [ or ?
      // Skip element-type suffix [] and ? pairs
      let lastWasBracketPair = false;
      while (j < tokens.length) {
        if (tokens[j]?.kind === "[" && tokens[j + 1]?.kind === "]") { j += 2; lastWasBracketPair = true; }
        else if (tokens[j]?.kind === "?") { j++; lastWasBracketPair = false; }
        else break;
      }
      // A fixed literal with a named element type: `S[](S(1), S(2))`. The final `[]`
      // pair is the construction bracket rather than an element-type suffix, so the
      // scan lands on `(` with no size bracket to find. Only the sized form was
      // recognised here, which is why `i32[](1, 2)` parsed and `S[](S(1))` did not —
      // a primitive element type takes an earlier, simpler path. `parseConstructionOrCall`
      // already handles this shape; nothing but the lookahead was missing.
      // An empty `[]` cannot be an index expression, so there is no ambiguity.
      if (lastWasBracketPair && tokens[j]?.kind === "(") return true;
      // Now j should point to the construction [ (size bracket)
      if (tokens[j]?.kind !== "[") return false;
      j++; // past [
      let depth = 1;
      while (j < tokens.length && depth > 0 && tokens[j].kind !== "eof") {
        if (tokens[j].kind === "[") depth++;
        else if (tokens[j].kind === "]") depth--;
        j++;
      }
      // For sized array construction T[N](), the () must be empty — if it has args, as
      // in `arr[i](5)`, that is an index followed by a funcref call.
      //
      // The one exception is `T[N](fill: v)`, whose named-argument form no call can
      // take: `arr[i](fill: v)` would be a function call with a named argument, which
      // is rejected outright. That is exactly why the fill value is written this way
      // rather than as a bare `T[N](v)`, which would be genuinely ambiguous here.
      if (tokens[j]?.kind === "(" && tokens[j + 1]?.kind === "ident" &&
          tokens[j + 1]?.text === "fill" && tokens[j + 2]?.kind === ":") {
        return true;
      }
      return tokens[j]?.kind === "(" && tokens[j + 1]?.kind === ")";
    }
    return false;
  }

  function parseConstructionOrCall(p: Pos): Expr {
    // Parse element/struct type name (just the ident part, not array suffix yet)
    const name = advance().text; // struct or prim type name
    // `Vec<i32>[2](fill: ...)` — a generic *element* type. This is the one place type arguments
    // appear in something that reads like an expression, and it is unambiguous because what
    // follows is a construction bracket rather than an operand.
    const nameArgs = PRIM_TYPES.has(name) ? undefined : parseTypeArgs();

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
        : { kind: "struct", name, typeArgs: nameArgs, ...p };
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
        // `T[n]()` — sized, each element the element type's default.
        // `T[n](fill: v)` — sized, every element `v`.
        const size = parseExpr();
        expect("]");
        expect("(");
        let fill: Expr | undefined;
        if (!at(")")) {
          // The only thing allowed here is `fill:`. A bare expression would be
          // ambiguous with `arr[i](5)`, so it is refused rather than guessed at.
          if (at("ident") && tok().text === "fill" && at(":", 1)) {
            advance();
            advance();
            fill = parseExpr();
          } else {
            err(`expected ')' or 'fill:' — a sized array takes its element value as 'fill:'`);
          }
        }
        expect(")");
        return { kind: "arrNew", elem: elemType, size, fixed: [], fill, ...p };
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
          const fn = declName("field name");
          expect(":");
          named.push({ name: fn, val: parseExpr() });
          if (!consume(",")) break;
        } while (!at("}"));   // trailing comma
      }
      expect("}");
      const t: WacType = { kind: "struct", name, typeArgs: nameArgs, ...p };
      return { kind: "construct", ctype: t, args: [], named, ...p };
    }

    // Struct positional construction: TypeName(args)
    if (at("(")) {
      advance();
      const args = parseArgList();
      expect(")");
      const t: WacType = PRIM_TYPES.has(name)
        ? { kind: "prim", name, ...p }
        : { kind: "struct", name, typeArgs: nameArgs, ...p };
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
        const field = declName("field name");
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
    if (at("match"))    return parseMatchStmt();
    if (at("return")) {
      advance();
      const value = at(";") ? null : parseExpr();
      expect(";");
      return { kind: "return", value, ...p };
    }
    if (at("break"))    { advance(); expect(";"); return { kind: "break", ...p }; }
    if (at("continue")) { advance(); expect(";"); return { kind: "continue", ...p }; }
    if (at("trap")) {
      // `trap;` or `trap <expr>;`, shaped like `return` — the message is what the host
      // is told, instead of the bare "unreachable" a trap otherwise reports.
      advance();
      if (at(";")) { expect(";"); return { kind: "trap", ...p }; }
      const value = parseExpr();
      expect(";");
      return { kind: "trap", value, ...p };
    }
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
      if (COMPOUND_OPS.has(tok().kind)) {
        const op = advance().kind; const rhs = parseExpr(); expect(";");
        return { kind: "assign", op, lval: lv, rhs, ...p };
      }
      if ((at("++") || at("--")) && at(";", 1)) {
        const op = advance().kind as "++" | "--"; expect(";");
        return { kind: "incr", op, lval: lv, ...p };
      }
      // Not an assignment — restore and parse as expression
      // (including `x++ * 2;`, where ++ is an expression, not a statement)
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
    const name = declName("variable name");
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
          else if (COMPOUND_OPS.has(tok().kind)) { const op = advance().kind; init = { kind: "assign", op, lval: lv, rhs: parseExpr(), ...ip }; }
          else if (at("++") || at("--")) { const op = advance().kind as "++" | "--"; init = { kind: "incr", op, lval: lv, ...ip }; }
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
        else if (COMPOUND_OPS.has(tok().kind)) { const op = advance().kind; update = { kind: "assign", op, lval: lv, rhs: parseExpr(), ...up }; }
        else if (at("++") || at("--")) { const op = advance().kind as "++" | "--"; update = { kind: "incr", op, lval: lv, ...up }; }
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

  /**
   * `match (subject) { case Variant(a, b): ... else: ... }`
   *
   * Arms reuse `case ...:` with statement bodies, exactly like `switch`, so there is
   * one arm syntax in the language. Exhaustiveness, duplicate arms and the reachability
   * of `else` are all checked later — the parser's job is only to record what was
   * written, so that one malformed arm does not derail the arms after it.
   */
  function parseMatchStmt(): Stmt {
    const p = pos();
    expect("match");
    expect("(");
    const subject = parseExpr();
    expect(")");
    expect("{");

    const arms: MatchArm[] = [];
    while (!at("}") && !at("eof")) {
      const ap = pos();
      if (consume("else")) {
        expect(":");
        arms.push({ variant: null, bindings: [], body: parseArmBody(), ...ap });
        continue;
      }
      if (!consume("case")) {
        err(`expected 'case' or 'else' in match`);
        advance();
        continue;
      }
      const variant = at("ident") ? advance().text : (err("expected variant name"), "?");
      const bindings: string[] = [];
      if (consume("(")) {
        if (!at(")")) {
          do {
            if (at(")")) break;   // trailing comma
            bindings.push(at("ident") ? advance().text : (err("expected binding name"), "?"));
          } while (consume(","));
        }
        expect(")");
      }
      expect(":");
      arms.push({ variant, bindings, body: parseArmBody(), ...ap });
    }
    expect("}");
    return { kind: "match", subject, arms, ...p };
  }

  /**
   * `match` as an expression.
   *
   * Deliberately close to `parseMatchStmt`: the arm header is identical, so a reader who
   * knows one knows the other, and the checker shares its arm handling between them. The
   * only difference is what follows the colon.
   */
  function parseMatchExpr(): Expr {
    const p = pos();
    expect("match");
    expect("(");
    const subject = parseExpr();
    expect(")");
    expect("{");

    const arms: MatchArm[] = [];
    while (!at("}") && !at("eof")) {
      const ap = pos();
      if (consume("else")) {
        expect(":");
        arms.push({ variant: null, bindings: [], body: [], value: parseExpr(), ...ap });
      } else if (consume("case")) {
        const variant = at("ident") ? advance().text : (err("expected variant name"), "?");
        const bindings: string[] = [];
        if (consume("(")) {
          if (!at(")")) {
            do {
              if (at(")")) break;   // trailing comma
              bindings.push(at("ident") ? advance().text : (err("expected binding name"), "?"));
            } while (consume(","));
          }
          expect(")");
        }
        expect(":");
        arms.push({ variant, bindings, body: [], value: parseExpr(), ...ap });
      } else {
        err(`expected 'case' or 'else' in match`);
        advance();
        continue;
      }
      // A trailing comma after the last arm is allowed, as in every other list.
      if (!consume(",")) break;
    }
    expect("}");
    return { kind: "matchExpr", subject, arms, ...p };
  }

  /** An arm body runs to the next `case`, `else` or the closing brace. */
  function parseArmBody(): Stmt[] {
    const body: Stmt[] = [];
    while (!at("case") && !at("else") && !at("}") && !at("eof")) {
      body.push(parseStatement());
    }
    return body;
  }

  function parseSwitchStmt(): Stmt {
    const p = pos(); advance(); // switch
    expect("("); const expr = parseExpr(); expect(")"); expect("{");
    const cases: SwitchCase[] = [];
    let sawDefault = false;
    while (!at("}") && !at("eof")) {
      const cp = pos();
      if (at("case")) {
        if (sawDefault) err(`'case' cannot appear after 'default'`);
        advance();
        const value = parseExpr(); expect(":");
        const body = parseSwitchBody();
        cases.push({ value, body, ...cp });
      } else if (at("default")) {
        if (sawDefault) err(`switch may have at most one 'default' clause`);
        sawDefault = true;
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
      if (!consume(",")) break;
    } while (!at("}"));   // trailing comma
    // `expect` matches a token by text as well as by kind, so this still reads the
    // `from` even though it lexes as an ordinary identifier now.
    expect("}"); expect("from");
    // A quoted specifier means *a file lives at this path*. `core` is not a file — it ships inside
    // the compiler and cannot be pointed anywhere else — so it is spelled without quotes, which
    // makes the difference visible instead of something a reader has to know.
    if (!at("string")) {
      const name = at("ident") ? advance().text : (err("expected a quoted file path, or `core`"), "?");
      if (name !== "?" && name !== CORE.key) {
        err(`unknown module '${name}' — an unquoted import reads only from \`${CORE.key}\``);
      }
      expect(";");
      return { tag: "import", path: "", prefix: CORE.key, items, ...p };
    }
    const path = advance().text;
    expect(";");
    return { tag: "import", path, items, ...p };
  }

  /**
   * Parse a comma-separated parameter list, allowing one trailing comma before
   * the closing paren. Multi-line signatures read better with it, and every
   * comma-separated list in the language accepts one for consistency.
   */
  function parseParams(params: Param[]): void {
    do {
      if (at(")")) break;   // trailing comma
      params.push(parseParam());
    } while (consume(","));
  }

  function parseParam(): Param {
    const p = pos();
    const isConst = consume("const");
    const type = parseType();
    const name = declName("parameter name");
    return { isConst, type, name, ...p };
  }

  /**
   * `<i32>` or `<string, Vec<i32>>` after a type name in *type* position; undefined when absent.
   *
   * Shared by `parseType` and `parseConstructionOrCall`, since `Vec<i32>[2]()` names a generic
   * element type in what is otherwise an expression.
   */
  function parseTypeArgs(): WacType[] | undefined {
    if (!at("<")) return undefined;
    advance();
    const args: WacType[] = [];
    if (!at(">") && !at(">>") && !at(">>>")) {
      args.push(parseType());
      while (consume(",")) {
        if (at(">") || at(">>") || at(">>>")) break;    // trailing comma, as in every other list
        args.push(parseType());
      }
    }
    // `Vec<Vec<i32>>` closes with `>>`, which the lexer has already munched into one token.
    // Consuming one `>` worth and leaving the rest is cheaper than teaching the lexer about
    // nesting depth, and is what a hand-written parser normally does.
    if (at(">>")) replaceCurrent(">");
    else if (at(">>>")) replaceCurrent(">>");
    else expect(">");
    return args;
  }

  /** `<T>` or `<T, U>` after a declaration's name; empty when there are none. */
  function parseTypeParams(): string[] {
    if (!at("<")) return [];
    advance();
    const params: string[] = [];
    if (!at(">")) {
      do {
        if (at(">")) break;              // trailing comma
        params.push(at("ident") ? advance().text : (err("expected type parameter name"), "?"));
      } while (consume(","));
    }
    expect(">");
    return params;
  }

  function parseStructDecl(exported: boolean): StructDecl {
    const p = pos();
    const isConst = consume("const");
    advance(); // struct
    const name = declName("struct name");
    const typeParams = parseTypeParams();
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
      const memberName = declName("member name");

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
            if (consume(",")) { parseParams(params); }
          } else if (at("this")) {
            hasThis = true; advance();
            if (consume(",")) { parseParams(params); }
          } else {
            parseParams(params);
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
    return { tag: "struct", isConst, exported, name, parent, fields, methods, typeParams, ...p };
  }

  /**
   * `enum Name { Variant, Variant(T field), ... }`
   *
   * A variant with no payload takes no parentheses. A trailing comma after the last
   * variant is allowed, like every other comma-separated list.
   */
  function parseEnumDecl(exported: boolean): EnumDecl {
    const p = pos();
    expect("enum");
    const name = declName("enum name");
    // As on a struct, and for the same reason: the parameters are in scope for every variant's
    // payload types and every method below.
    const typeParams = parseTypeParams();
    expect("{");

    // Variants first, comma-separated, then methods. A method is recognised by its shape —
    // `type name(this, ...) { ... }` — which a variant can never have, so the two are
    // distinguishable without a separator keyword. The variant list ends at the first thing
    // that is not `IDENT` or `IDENT(...)` followed by a comma.
    const variants: VariantDecl[] = [];
    const methods: MethodDecl[] = [];
    while (!at("}") && !at("eof")) {
      if (looksLikeEnumMethod()) break;
      const vp = pos();
      const vname = at("ident") ? advance().text : (err("expected variant name"), "?");
      const fields: Param[] = [];
      if (consume("(")) {
        if (!at(")")) parseParams(fields);
        expect(")");
      }
      variants.push({ name: vname, fields, ...vp });
      if (!consume(",")) break;
    }

    while (!at("}") && !at("eof")) {
      const mp = pos();
      // `override` has no meaning here: the variants are compiler-generated subtypes of the
      // base, so an override would be per-variant virtual dispatch — a different feature
      // with its own design questions. Rejected rather than quietly accepted.
      if (at("override")) {
        err(`'override' is not allowed on an enum method`);
        advance();
      }
      const returnType = parseType();
      const mname = at("ident") ? advance().text : (err("expected method name"), "?");
      expect("(");
      let hasThis = false;
      let thisConst = false;
      const params: Param[] = [];
      if (!at(")")) {
        if (at("const") && tok(1).text === "this") {
          thisConst = true; advance(); hasThis = true; advance();
          if (consume(",")) parseParams(params);
        } else if (at("this")) {
          hasThis = true; advance();
          if (consume(",")) parseParams(params);
        } else {
          parseParams(params);
        }
      }
      expect(")");
      // A static method on an enum would be written `Shape.make()`, which is already how a
      // variant is constructed. Allowing both would make that spelling ambiguous, so a
      // method here must take `this` until that ambiguity is decided deliberately.
      if (!hasThis) {
        err(`an enum method must take 'this' — 'Shape.name()' is how a variant is constructed`);
      }
      methods.push({
        isOverride: false, returnType, name: mname, hasThis, thisConst, params,
        body: parseBlock(), ...mp,
      });
    }

    expect("}");
    return { tag: "enum", exported, name, variants, methods, typeParams, ...p };
  }

  /**
   * Does a method declaration start here, rather than another variant?
   *
   * A variant is `IDENT` or `IDENT(...)`; a method is a *type* followed by a name and a
   * parameter list. The distinguishing shape is what follows the first identifier: a
   * variant is followed by `,`, `}` or `(`, a method by another identifier (its name) or by
   * a type suffix. `override` is unambiguous on its own.
   */
  function looksLikeEnumMethod(): boolean {
    if (at("override")) return true;
    if (at("void") || at("fn")) return true;
    if (!at("ident")) return false;
    // Skip the type's own suffixes: `i32[] name(...)`, `Node? name(...)`.
    let j = cur + 1;
    while (j < tokens.length) {
      if (tokens[j]?.kind === "[" && tokens[j + 1]?.kind === "]") { j += 2; }
      else if (tokens[j]?.kind === "?") { j++; }
      else break;
    }
    // A second identifier followed by `(` is a method; anything else is a variant.
    return tokens[j]?.kind === "ident" && tokens[j + 1]?.kind === "(";
  }

  function parseFuncDecl(): FuncDecl {
    const p = pos();
    const exported = consume("export");
    const returnType = parseType();
    const name = declName("function name");
    // `T max<T>(T a, T b)` — after the name, as on a struct. The return type is parsed first and may
    // itself mention `T`, which reads oddly but matches how every other declaration in wac is
    // written: type, then name.
    const typeParams = parseTypeParams();
    expect("(");
    const params: Param[] = [];
    if (!at(")")) { parseParams(params); }
    expect(")");
    const body = parseBlock();
    return { tag: "func", exported, returnType, name, params, body, typeParams, ...p };
  }

  /** `[export] const <type> <name> = <expr>;` at top level. */
  function parseConstDecl(exported: boolean): ConstDecl {
    const p = pos();
    expect("const");
    const type = parseType();
    const name = at("ident") ? advance().text : (err("expected constant name"), "?");
    expect("=");
    const init = parseExpr();
    expect(";");
    return { tag: "const", exported, type, name, init, ...p };
  }

  // ── Main parse loop ───────────────────────────────────────────────────────
  //
  // Inside `program()`, not at construction. `makeParser` is a set of entry points into one
  // grammar, and which one the caller wants is not known until they ask: wapy's frontend takes
  // `expression` and `type` and never `program`, and a parser that had already consumed the
  // token stream would hand it an empty one.

  function parseProgram(): TopLevel[] {
    const items: TopLevel[] = [];
    while (!at("eof")) {
      if (at("import")) {
        items.push(parseImport());
      } else if (at("struct") || (at("const") && at("struct", 1))) {
        items.push(parseStructDecl(false));
      } else if (at("export") && (at("struct", 1) || (at("const", 1) && at("struct", 2)))) {
        // `export const struct` as well as `export struct` — parseStructDecl reads
        // the `const` itself, so only the `export` is consumed here.
        advance(); // skip 'export'
        items.push(parseStructDecl(true));
      } else if (at("const")) {
        // `const struct` was matched above, so any other `const` is a constant.
        items.push(parseConstDecl(false));
      } else if (at("export") && at("const", 1)) {
        advance(); // skip 'export'
        items.push(parseConstDecl(true));
      } else if (at("enum")) {
        items.push(parseEnumDecl(false));
      } else if (at("export") && at("enum", 1)) {
        advance(); // skip 'export'
        items.push(parseEnumDecl(true));
      } else if (at("export") || at("fn") || at("void") || (at("ident"))) {
        items.push(parseFuncDecl());
      } else {
        err(`unexpected token '${tok().text}' at top level`);
        advance();
      }
    }
    return items;
  }

  return {
    /** The whole file. */
    program(): ParseResult {
      return { program: { items: parseProgram() }, errors };
    },
    /** One expression, for a frontend that has isolated the tokens of one. */
    expression(): { expr: Expr; errors: ParseError[]; consumed: number } {
      const expr = parseExpr();
      return { expr, errors, consumed: cur };
    },
    /** One type, likewise. */
    type(): { type: WacType; errors: ParseError[]; consumed: number } {
      const type = parseType();
      return { type, errors, consumed: cur };
    },
    /** One statement, for a frontend that delimits statements itself. */
    statement(): { stmt: Stmt; errors: ParseError[]; consumed: number } {
      const stmt = parseStatement();
      return { stmt, errors, consumed: cur };
    },
  };
}

export function wacParse(tokens: Token[], file: string): ParseResult {
  return makeParser(tokens, file).program();
}

/** Parse exactly one expression from `tokens`, for another frontend's use. */
export function parseExpression(tokens: Token[], file: string): { expr: Expr; errors: ParseError[] } {
  const { expr, errors } = makeParser(tokens, file).expression();
  return { expr, errors };
}

/** Parse exactly one type from `tokens`, likewise. */
export function parseTypeOnly(tokens: Token[], file: string): { type: WacType; errors: ParseError[] } {
  const { type, errors } = makeParser(tokens, file).type();
  return { type, errors };
}
