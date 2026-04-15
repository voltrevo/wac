// Recursive descent parser for the wac language.
// Consumes a Token[] from wacLex and produces a Program AST with error list.
// Pure TypeScript — no platform APIs.

import type {
  Program, ImportDecl, ImportItem, StructDecl, FieldDecl, MethodDecl,
  FuncDecl, Param, Block, Stmt, IfStmt, CaseClause, CompoundOp,
  ForInit, ForUpdate, LVal, LValOp, Expr, FieldInit, WacType, BinOp,
} from "./ast.ts";
import type { Token, TokenKind } from "./wacLex.ts";

export type ParseError = {
  message: string;
  line: number;
  col: number;
  span: number;
  annotation?: string;
  hint?: string;
};

export type ParseResult = {
  program: Program;
  errors: ParseError[];
};

export function wacParse(tokens: Token[]): ParseResult {
  const p = new Parser(tokens);
  const program = p.parseProgram();
  return { program, errors: p.errors };
}

// ---- Parser internals ----

const COMPOUND_OPS = new Set([
  "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", "&=", "|=", "^=",
]);

class Parser {
  pos = 0;
  errors: ParseError[] = [];

  constructor(private tokens: Token[]) {}

  private peek(n = 0): Token {
    return this.tokens[Math.min(this.pos + n, this.tokens.length - 1)];
  }

  private advance(): Token {
    const t = this.tokens[this.pos];
    if (t.kind !== "eof") this.pos++;
    return t;
  }

  private eat(kind: TokenKind): Token | null {
    if (this.peek().kind === kind) return this.advance();
    return null;
  }

  private expect(kind: TokenKind, hint?: string): Token {
    if (this.peek().kind === kind) return this.advance();
    const t = this.peek();
    if (kind === ";") {
      // Report at the end of the last token, not the start of the next one.
      const prev = this.pos > 0 ? this.tokens[this.pos - 1]! : t;
      const endTok: Token = { ...prev, col: prev.col + prev.value.length };
      this.pushError("expected ';'", endTok, 1, "expected ';' after statement", hint);
      return t;
    }
    if (kind === "}") { this.pushError("expected '}'", t, 1, undefined, hint); return t; }
    if (kind === ")") { this.pushError("expected ')'", t, 1, "expected ')' to close argument list", hint); return t; }
    this.pushError(`expected '${kind}'`, t, 1, undefined, hint);
    return t; // don't consume — error recovery
  }

  private expectIdent(): string {
    const t = this.peek();
    if (t.kind === "ident") { this.advance(); return t.value; }
    this.pushError("expected identifier", t, t.value.length || 1);
    return "<error>";
  }

  // Import items can rename any exportable identifier
  private expectName(): string {
    const t = this.peek();
    if (t.kind === "ident") { this.advance(); return t.value; }
    this.pushError("expected name", t, 1);
    return "<error>";
  }

  private pushError(
    message: string, tok: Token, span = 1,
    annotation?: string, hint?: string,
  ): void {
    this.errors.push({ message, line: tok.line, col: tok.col, span, annotation, hint });
  }

  // Skip tokens until we reach a likely recovery point
  private sync(): void {
    while (!["eof", ";", "}", "{"].includes(this.peek().kind)) this.advance();
    this.eat(";");
  }

  // ---- Program ----

  parseProgram(): Program {
    const imports: ImportDecl[] = [];
    const structs: StructDecl[] = [];
    const funcs: FuncDecl[] = [];

    while (this.peek().kind !== "eof") {
      if (this.peek().kind === "import") {
        imports.push(this.parseImport());
        continue;
      }
      // struct or const struct
      if (this.peek().kind === "struct" ||
          (this.peek().kind === "const" && this.peek(1).kind === "struct")) {
        structs.push(this.parseStructDecl());
        continue;
      }
      // export struct, export const struct, or export func
      if (this.peek().kind === "export") {
        const { line, col } = this.peek();
        this.advance(); // consume export
        if (this.peek().kind === "struct" ||
            (this.peek().kind === "const" && this.peek(1).kind === "struct")) {
          structs.push(this.parseStructDecl()); // export is implicit for all here
        } else {
          funcs.push(this.parseFuncRemainder(true, line, col));
        }
        continue;
      }
      // plain function
      if (this.looksLikeType()) {
        const { line, col } = this.peek();
        funcs.push(this.parseFuncRemainder(false, line, col));
        continue;
      }
      this.pushError("expected declaration", this.peek(), 1);
      this.advance();
    }

    return { imports, structs, funcs };
  }

  // ---- Imports ----

  private parseImport(): ImportDecl {
    const { line, col } = this.peek();
    this.advance(); // import
    this.expect("{");
    const items: ImportItem[] = [];
    if (this.peek().kind !== "}") {
      items.push(this.parseImportItem());
      while (this.eat(",")) {
        if (this.peek().kind === "}") break;
        items.push(this.parseImportItem());
      }
    }
    this.expect("}");
    // 'from' is an identifier in wac (not reserved keyword)
    if (this.peek().kind === "ident" && this.peek().value === "from") {
      this.advance();
    } else {
      this.pushError("expected 'from'", this.peek(), 1);
    }
    let from = "";
    if (this.peek().kind === "str") {
      from = decodeStrLiteral(this.peek().value);
      this.advance();
    } else {
      this.pushError("expected file path string", this.peek(), 1);
    }
    this.expect(";");
    return { items, from, line, col };
  }

  private parseImportItem(): ImportItem {
    const { line, col } = this.peek();
    const name = this.expectName();
    let as_ = name;
    if (this.eat("as")) as_ = this.expectName();
    return { name, as: as_, line, col };
  }

  // ---- Structs ----

  private parseStructDecl(): StructDecl {
    const { line, col } = this.peek();
    const isConst = !!this.eat("const");
    this.expect("struct");
    const name = this.expectIdent();
    let parent: string | undefined;
    if (this.eat(":")) parent = this.expectIdent();
    this.expect("{");

    const fields: FieldDecl[] = [];
    const methods: MethodDecl[] = [];

    while (this.peek().kind !== "}" && this.peek().kind !== "eof") {
      const mLine = this.peek().line, mCol = this.peek().col;
      const isOverride = !!this.eat("override");
      const isFieldConst = !isOverride && !!this.eat("const");

      if (!this.looksLikeType()) {
        this.pushError(
          "expected field or method declaration", this.peek(), 1,
          "expected type name",
        );
        this.sync();
        continue;
      }

      const retType = this.parseType();
      const memberName = this.expectIdent();

      if (this.peek().kind === "(") {
        // Method
        this.advance();
        let thisParam: "mutable" | "const" | undefined;
        const params: Param[] = [];

        if (this.peek().kind !== ")") {
          if (this.peek().kind === "const" && this.peek(1).kind === "ident" && this.peek(1).value === "this") {
            this.advance(); this.advance(); thisParam = "const";
            if (this.eat(",")) this.parseParamList(params);
          } else if (this.peek().kind === "ident" && this.peek().value === "this") {
            this.advance(); thisParam = "mutable";
            if (this.eat(",")) this.parseParamList(params);
          } else {
            this.parseParamList(params);
          }
        }
        this.expect(")");
        const body = this.parseBlock();
        methods.push({ name: memberName, returnType: retType, thisParam, params, body, isOverride, line: mLine, col: mCol });
      } else {
        if (isOverride) this.pushError("'override' not valid on field", this.peek(), 1);
        this.expect(";");
        fields.push({ name: memberName, type: retType, isConst: isFieldConst, line: mLine, col: mCol });
      }
    }

    this.expect("}");
    return { name, isConst, parent, fields, methods, line, col };
  }

  // ---- Functions ----

  private parseFuncRemainder(isExport: boolean, line: number, col: number): FuncDecl {
    const returnType = this.parseType();
    const name = this.expectIdent();
    this.expect("(");
    const params: Param[] = [];
    if (this.peek().kind !== ")") this.parseParamList(params);
    this.expect(")");
    const body = this.parseBlock();
    return { name, returnType, params, body, isExport, line, col };
  }

  private parseParamList(params: Param[]): void {
    params.push(this.parseParam());
    while (this.eat(",")) {
      if (this.peek().kind === ")") break;
      params.push(this.parseParam());
    }
  }

  private parseParam(): Param {
    const { line, col } = this.peek();
    const type = this.parseType();
    const name = this.expectIdent();
    return { name, type, line, col };
  }

  // ---- Types ----

  private looksLikeType(): boolean {
    const k = this.peek().kind;
    if (k === "fn") return true;
    if (k === "ident") return true;
    return ["i8","i16","i32","i64","f32","f64","bool","string","void"].includes(k);
  }

  private parseType(): WacType {
    let t = this.parseCoreType();
    // Eat interleaved [] and ? suffixes: Point?[] = array(nullable(Point))
    for (;;) {
      if (this.peek().kind === "[" && this.peek(1).kind === "]") {
        this.advance(); this.advance();
        t = { tag: "array", elem: t };
      } else if (this.peek().kind === "?") {
        this.advance();
        t = { tag: "nullable", inner: t };
      } else {
        break;
      }
    }
    return t;
  }

  // Like parseType() but does NOT consume trailing `?`, used in `is`/`is not` context
  // where `?` is likely the ternary operator.
  private parseTypeNoNullable(): WacType {
    let t = this.parseCoreType();
    while (this.peek().kind === "[" && this.peek(1).kind === "]") {
      this.advance(); this.advance();
      t = { tag: "array", elem: t };
    }
    return t;
  }

  private parseCoreType(): WacType {
    const t = this.peek();
    const primitiveMap: Partial<Record<TokenKind, WacType>> = {
      "i8":  { tag: "i8" },  "i16": { tag: "i16" }, "i32": { tag: "i32" },
      "i64": { tag: "i64" }, "f32": { tag: "f32" }, "f64": { tag: "f64" },
      "bool": { tag: "bool" }, "string": { tag: "string" }, "void": { tag: "void" },
    };
    const prim = primitiveMap[t.kind];
    if (prim) { this.advance(); return prim; }

    if (t.kind === "ident") {
      const name = t.value;
      this.advance();
      if (name === "anyref") return { tag: "anyref" };
      if (name === "i31ref") return { tag: "i31ref" };
      return { tag: "named", name };
    }

    if (t.kind === "fn") {
      this.advance();
      this.expect("[");
      const ret = this.parseType();
      this.expect("(");
      const params: WacType[] = [];
      if (this.peek().kind !== ")") {
        params.push(this.parseType());
        while (this.eat(",")) {
          if (this.peek().kind === ")") break;
          params.push(this.parseType());
        }
      }
      this.expect(")");
      this.expect("]");
      return { tag: "funcref", ret, params };
    }

    this.pushError("expected type", t, t.value.length || 1, `unknown type '${t.value}'`);
    this.advance();
    return { tag: "i32" }; // error recovery
  }

  // ---- Blocks & statements ----

  private parseBlock(): Block {
    const { line, col } = this.peek();
    // Record where block opened for error reporting
    const openTok = this.peek();
    this.expect("{");
    const stmts: Stmt[] = [];
    while (this.peek().kind !== "}" && this.peek().kind !== "eof") {
      stmts.push(this.parseStmt());
    }
    if (this.peek().kind === "eof") {
      this.pushError(
        "expected '}'", this.peek(), 1, undefined,
        `block opened at ${openTok.line}:${openTok.col}`,
      );
    } else {
      this.advance(); // }
    }
    return { stmts, line, col };
  }

  private parseStmt(): Stmt {
    const t = this.peek();
    const { line, col } = t;

    // return
    if (t.kind === "return") {
      this.advance();
      let value: Expr | undefined;
      if (this.peek().kind !== ";") value = this.parseExpr();
      this.expect(";");
      return { tag: "return", value, line, col };
    }

    // break
    if (t.kind === "break") {
      this.advance(); this.expect(";");
      return { tag: "break", line, col };
    }

    // continue
    if (t.kind === "continue") {
      this.advance(); this.expect(";");
      return { tag: "continue", line, col };
    }

    // trap
    if (t.kind === "trap") {
      this.advance(); this.expect(";");
      return { tag: "trap", line, col };
    }

    // if
    if (t.kind === "if") return this.parseIf();

    // while
    if (t.kind === "while") {
      this.advance();
      this.expect("(");
      const cond = this.parseExpr();
      this.expect(")");
      const body = this.parseBlock();
      return { tag: "while", cond, body, line, col };
    }

    // for
    if (t.kind === "for") return this.parseFor();

    // do-while
    if (t.kind === "do") {
      this.advance();
      const body = this.parseBlock();
      this.expect("while");
      this.expect("(");
      const cond = this.parseExpr();
      this.expect(")");
      this.expect(";");
      return { tag: "dowhile", body, cond, line, col };
    }

    // switch
    if (t.kind === "switch") return this.parseSwitch();

    // scoped block: { ... }
    if (t.kind === "{") {
      const block = this.parseBlock();
      return { tag: "block", block, line, col };
    }

    // var declaration: [const] type IDENT = expr;
    if (this.looksLikeVarDecl()) {
      return this.parseVarDecl();
    }

    // assign, compound, incr, or expr-stmt
    // All start with an expression (lvalue or otherwise)
    return this.parseAssignOrExprStmt();
  }

  private parseIf(): Stmt {
    const { line, col } = this.peek();
    this.advance(); // if
    this.expect("(");
    const cond = this.parseExpr();
    this.expect(")");
    const then = this.parseBlock();
    if (this.eat("else")) {
      if (this.peek().kind === "if") {
        return { tag: "if", cond, then, else_: this.parseIf() as IfStmt, line, col };
      }
      return { tag: "if", cond, then, else_: this.parseBlock(), line, col };
    }
    return { tag: "if", cond, then, line, col };
  }

  private parseFor(): Stmt {
    const { line, col } = this.peek();
    this.advance(); // for
    this.expect("(");
    let init: ForInit | undefined;
    if (this.peek().kind !== ";") {
      if (this.looksLikeVarDecl()) {
        const v = this.parseVarDeclNoSemi();
        init = { tag: "var", isConst: v.isConst, type: v.type, name: v.name, init: v.init, line: v.line, col: v.col };
      } else {
        const lv = this.parseLVal();
        if (this.peek().kind === "=") {
          this.advance();
          init = { tag: "assign", lval: lv, rhs: this.parseExpr(), line: lv.line, col: lv.col };
        } else {
          this.pushError("expected '=' in for-init", this.peek());
        }
      }
    }
    this.expect(";");
    let cond: Expr | undefined;
    if (this.peek().kind !== ";") cond = this.parseExpr();
    this.expect(";");
    let update: ForUpdate | undefined;
    if (this.peek().kind !== ")") {
      update = this.parseForUpdate();
    }
    this.expect(")");
    const body = this.parseBlock();
    return { tag: "for", init, cond, update, body, line, col };
  }

  private parseForUpdate(): ForUpdate {
    const lv = this.parseLVal();
    const { line, col } = lv;
    if (this.peek().kind === "++" || this.peek().kind === "--") {
      const op = this.advance().kind as "++" | "--";
      return { tag: "incr", lval: lv, op, line, col };
    }
    if (COMPOUND_OPS.has(this.peek().kind)) {
      const op = this.advance().kind as CompoundOp;
      return { tag: "compound", lval: lv, op, rhs: this.parseExpr(), line, col };
    }
    if (this.eat("=")) {
      return { tag: "assign", lval: lv, rhs: this.parseExpr(), line, col };
    }
    this.pushError("expected assignment or increment in for-update", this.peek());
    return { tag: "assign", lval: lv, rhs: { tag: "int", value: 0, line, col }, line, col };
  }

  private parseSwitch(): Stmt {
    const { line, col } = this.peek();
    this.advance(); // switch
    this.expect("(");
    const expr = this.parseExpr();
    this.expect(")");
    this.expect("{");
    const cases: CaseClause[] = [];
    let default_: Stmt[] | undefined;
    while (this.peek().kind !== "}" && this.peek().kind !== "eof") {
      if (this.peek().kind === "case") {
        const { line: cl, col: cc } = this.peek();
        this.advance();
        const value = this.parseExpr();
        this.expect(":");
        const body: Stmt[] = [];
        while (!["case", "default", "}", "eof"].includes(this.peek().kind)) {
          body.push(this.parseStmt());
        }
        cases.push({ value, body, line: cl, col: cc });
      } else if (this.peek().kind === "default") {
        this.advance();
        this.expect(":");
        default_ = [];
        while (!["case", "}", "eof"].includes(this.peek().kind)) {
          default_.push(this.parseStmt());
        }
      } else {
        this.pushError("expected 'case' or 'default'", this.peek());
        this.advance();
      }
    }
    this.expect("}");
    return { tag: "switch", expr, cases, default_, line, col };
  }

  // Detect: [const] type IDENT = expr;
  // i.e., a token sequence that starts a variable declaration
  private looksLikeVarDecl(): boolean {
    let i = 0;
    if (this.peek(i).kind === "const") i++;
    if (!this.looksLikeTypeAt(i)) return false;
    // Skip over the full type (handles i32[], P?, P[]?, fn[...], etc.)
    const after = this.skipTypeTokens(i);
    if (this.peek(after).kind !== "ident") return false;
    const next = this.peek(after + 1).kind;
    // Match `type ident = expr;` (normal) or `type ident;` (missing initializer — we'll error).
    return next === "=" || next === ";";
  }

  private looksLikeTypeAt(i: number): boolean {
    const k = this.peek(i).kind;
    if (k === "fn") return true;
    if (k === "ident") return true;
    return ["i8","i16","i32","i64","f32","f64","bool","string","void"].includes(k);
  }

  // Skip over type tokens starting at offset i, return offset after
  private skipTypeTokens(i: number): number {
    const k = this.peek(i).kind;
    if (["i8","i16","i32","i64","f32","f64","bool","string","void","ident"].includes(k)) {
      i++;
    } else if (k === "fn") {
      // fn[T(A,B)] - skip matching []
      i++; // fn
      if (this.peek(i).kind === "[") {
        let depth = 1; i++;
        while (depth > 0 && this.peek(i).kind !== "eof") {
          if (this.peek(i).kind === "[") depth++;
          else if (this.peek(i).kind === "]") depth--;
          i++;
        }
      }
    } else {
      return i;
    }
    // Eat interleaved [] and ? suffixes (mirrors parseType)
    for (;;) {
      if (this.peek(i).kind === "[" && this.peek(i+1).kind === "]") { i += 2; }
      else if (this.peek(i).kind === "?") { i++; }
      else break;
    }
    return i;
  }

  private parseVarDecl(): Stmt {
    const { line, col } = this.peek();
    const isConst = !!this.eat("const");
    const type = this.parseType();
    const name = this.expectIdent();
    if (this.peek().kind !== "=") {
      // Variable declared without initializer — error and recover.
      this.pushError(`variable '${name}' must be initialized`, this.peek());
      this.eat(";");
      return { tag: "var", isConst, type, name, init: { tag: "int", value: 0, line, col }, line, col };
    }
    this.expect("=");
    const init = this.parseExpr();
    this.expect(";");
    return { tag: "var", isConst, type, name, init, line, col };
  }

  private parseVarDeclNoSemi(): { isConst: boolean; type: WacType; name: string; init: Expr; line: number; col: number } {
    const { line, col } = this.peek();
    const isConst = !!this.eat("const");
    const type = this.parseType();
    const name = this.expectIdent();
    this.expect("=");
    const init = this.parseExpr();
    return { isConst, type, name, init, line, col };
  }

  // Parses assign / compound / incr / expr statement
  private parseAssignOrExprStmt(): Stmt {
    const { line, col } = this.peek();

    // Try to parse as lvalue, then check for assignment operator
    // If what follows isn't an assignment op, treat as expression statement
    const exprOrLval = this.parseExpr(); // parse full expression first

    // Check if this is an assignment target (lvalue) followed by assignment op
    const nextKind = this.peek().kind;

    if (nextKind === "=") {
      this.advance();
      const lval = exprToLVal(exprOrLval);
      if (!lval) {
        this.pushError("left side of assignment must be a variable or field", { kind: "ident", value: "", line, col });
        const rhs = this.parseExpr();
        this.expect(";");
        return { tag: "expr", expr: rhs, line, col };
      }
      const rhs = this.parseExpr();
      this.expect(";");
      return { tag: "assign", lval, rhs, line, col };
    }

    if (COMPOUND_OPS.has(nextKind)) {
      const op = this.advance().kind as CompoundOp;
      const lval = exprToLVal(exprOrLval);
      if (!lval) {
        this.pushError("left side of compound assignment must be a variable or field", { kind: "ident", value: "", line, col });
        const rhs = this.parseExpr();
        this.expect(";");
        return { tag: "expr", expr: rhs, line, col };
      }
      const rhs = this.parseExpr();
      this.expect(";");
      return { tag: "compound", lval, op, rhs, line, col };
    }

    if (nextKind === "++" || nextKind === "--") {
      const op = this.advance().kind as "++" | "--";
      const lval = exprToLVal(exprOrLval);
      if (!lval) {
        this.pushError("operand of ++ / -- must be a variable or field", { kind: "ident", value: "", line, col });
        this.expect(";");
        return { tag: "expr", expr: exprOrLval, line, col };
      }
      this.expect(";");
      return { tag: "incr", lval, op, line, col };
    }

    this.expect(";");
    return { tag: "expr", expr: exprOrLval, line, col };
  }

  // LVal from expression context (for for-loop init/update)
  private parseLVal(): LVal {
    const { line, col } = this.peek();
    const name = this.expectIdent();
    const ops: LValOp[] = [];
    for (;;) {
      if (this.eat("!")) { ops.push({ tag: "unwrap" }); continue; }
      if (this.eat(".")) { ops.push({ tag: "field", name: this.expectIdent() }); continue; }
      if (this.peek().kind === "[") {
        this.advance();
        const idx = this.parseExpr();
        this.expect("]");
        ops.push({ tag: "index", idx });
        continue;
      }
      break;
    }
    return { name, ops, line, col };
  }

  // ---- Expressions ----

  private parseExpr(): Expr { return this.parseTernary(); }

  private parseTernary(): Expr {
    const left = this.parseIsExpr();
    if (this.eat("?")) {
      const { line, col } = left;
      const then = this.parseExpr();
      this.expect(":");
      const else_ = this.parseExpr();
      return { tag: "ternary", cond: left, then, else_, line, col };
    }
    return left;
  }

  private parseIsExpr(): Expr {
    const left = this.parseOr();
    if (this.peek().kind === "is") {
      const { line, col } = this.peek();
      this.advance();
      const not = !!this.eat("not");
      // check: null, type, or expression (reference identity)
      if (this.peek().kind === "null") {
        this.advance();
        return { tag: "is", operand: left, not, checkType: "null", line, col };
      }
      // If the next token is a lowercase ident not followed by `[` → ref equality with an expr.
      // Struct type names start with uppercase; lowercase idents are variables.
      const t = this.peek();
      if (t.kind === "ident" && t.value[0] === t.value[0]!.toLowerCase() && t.value[0] !== t.value[0]!.toUpperCase() && this.peek(1).kind !== "[") {
        const checkExpr = this.parseOr();
        return { tag: "is", operand: left, not, checkType: checkExpr, line, col };
      }
      // Parse as type (without nullable ? suffix, since ? may be ternary operator).
      const checkType = this.parseTypeNoNullable();
      return { tag: "is", operand: left, not, checkType, line, col };
    }
    return left;
  }

  private parseBinaryLeft(next: () => Expr, ...ops: TokenKind[]): Expr {
    let left = next.call(this);
    while (ops.includes(this.peek().kind as TokenKind)) {
      const { line, col } = this.peek();
      const op = this.advance().kind as BinOp;
      const right = next.call(this);
      left = { tag: "binary", op, left, right, line, col };
    }
    return left;
  }

  private parseOr():      Expr { return this.parseBinaryLeft(this.parseAnd, "||"); }
  private parseAnd():     Expr { return this.parseBinaryLeft(this.parseBitOr, "&&"); }
  private parseBitOr():   Expr { return this.parseBinaryLeft(this.parseBitXor, "|"); }
  private parseBitXor():  Expr { return this.parseBinaryLeft(this.parseBitAnd, "^"); }
  private parseBitAnd():  Expr { return this.parseBinaryLeft(this.parseEq, "&"); }
  private parseEq():      Expr { return this.parseBinaryLeft(this.parseRel, "==", "!="); }
  private parseRel():     Expr { return this.parseBinaryLeft(this.parseShift, "<", "<=", ">", ">="); }
  private parseShift():   Expr { return this.parseBinaryLeft(this.parseAdd, "<<", ">>"); }
  private parseAdd():     Expr { return this.parseBinaryLeft(this.parseMul, "+", "-"); }
  private parseMul():     Expr { return this.parseBinaryLeft(this.parseCast, "*", "/", "%"); }

  private parseCast(): Expr {
    let left = this.parseUnary();
    while (["as", "as!", "as~", "as@"].includes(this.peek().kind)) {
      // Attach position to the operand start so the cast expression spans
      // from the operand through to the target type (e.g. "x as~ i64").
      const { line, col } = left;
      const op = this.advance().kind as "as" | "as!" | "as~" | "as@";
      const toType = this.parseType();
      left = { tag: "cast", op, operand: left, toType, line, col };
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.kind === "-" || t.kind === "!" || t.kind === "~") {
      this.advance();
      const operand = this.parseUnary();
      return { tag: "unary", op: t.kind as "-" | "!" | "~", operand, line: t.line, col: t.col };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.eat("!")) {
        expr = { tag: "unwrap", operand: expr, line: expr.line, col: expr.col };
        continue;
      }
      // Call on arbitrary expression: (expr)(args), expr!(args), expr[i](args) — callexpr
      // Any expression except plain ident (those are handled by parsePrimary as "call")
      if (this.peek().kind === "(" && expr.tag !== "ident" && expr.tag !== "call") {
        const { line: cl, col: cc } = this.peek();
        this.advance();
        const args = this.parseArgList();
        this.expect(")");
        expr = { tag: "callexpr", callee: expr, args, line: cl, col: cc };
        continue;
      }
      if (this.eat(".")) {
        const { line, col } = this.peek();
        const name = this.expectIdent();
        if (this.eat("(")) {
          const args = this.parseArgList();
          this.expect(")");
          expr = { tag: "method", object: expr, name, args, line, col };
        } else {
          expr = { tag: "field", object: expr, name, line, col };
        }
        continue;
      }
      if (this.peek().kind === "[") {
        const { line, col } = this.peek();
        this.advance();
        const idx = this.parseExpr();
        this.expect("]");
        expr = { tag: "index", object: expr, idx, line, col };
        continue;
      }
      break;
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    const { line, col } = t;

    // Integer literal
    if (t.kind === "int") {
      this.advance();
      const val = parseIntLiteral(t.value);
      if (val > 2147483647n || val < -2147483648n) {
        return { tag: "int64", value: val, line, col };
      }
      return { tag: "int", value: Number(val), line, col };
    }

    // Float literal
    if (t.kind === "float") {
      this.advance();
      return { tag: "float", value: parseFloat(t.value), line, col };
    }

    // String literal
    if (t.kind === "str") {
      this.advance();
      return { tag: "str", value: decodeStrLiteral(t.value), line, col };
    }

    // Char literal
    if (t.kind === "char") {
      this.advance();
      return { tag: "char", value: decodeCharLiteral(t.value), line, col };
    }

    // Booleans
    if (t.kind === "true")  { this.advance(); return { tag: "bool", value: true,  line, col }; }
    if (t.kind === "false") { this.advance(); return { tag: "bool", value: false, line, col }; }

    // null
    if (t.kind === "null")  { this.advance(); return { tag: "null", line, col }; }

    // Grouped expression
    if (t.kind === "(") {
      this.advance();
      const expr = this.parseExpr();
      this.expect(")");
      return { tag: "paren", expr, line, col };
    }

    // Type keywords used in array construction: i32[5]() or i32[](1,2,3)
    if (this.isTypeKeyword(t.kind)) {
      return this.parseArrayConstruction(this.parseCoreType());
    }

    // fn[T(A,B)][...] array of funcrefs, or just funcref ref/construction
    if (t.kind === "fn") {
      const elemType = this.parseCoreType(); // parses fn[T(A,B)]
      return this.parseArrayConstruction(elemType);
    }

    // Identifier — variable, call, constructor, named construction, array construction
    // Note: IDENT.method(args) and Type.static(args) look identical — postfix handles both.
    if (t.kind === "ident") {
      const name = t.value;
      this.advance();

      // IDENT ( — function call or constructor
      if (this.peek().kind === "(") {
        this.advance(); // (
        const args = this.parseArgList();
        this.expect(")");
        // Syntactically ambiguous: could be func call or struct constructor
        return { tag: "call", func: name, args, line, col };
      }

      // Type.method(args) or Type.method — uppercase first char = type qualifier
      // c.method() is handled by postfix (lowercase = instance variable)
      if (this.peek().kind === "." && name[0] >= "A" && name[0] <= "Z") {
        const savedPos = this.pos;
        this.advance(); // .
        if (this.peek().kind === "ident") {
          const { line: ml, col: mc } = this.peek();
          const method = this.advance().value;
          if (this.eat("(")) {
            const args = this.parseArgList();
            this.expect(")");
            return { tag: "call", func: method, typeQual: name, args, line: ml, col: mc };
          }
          // Type.method without call — function reference
          return { tag: "fnref", func: method, typeQual: name, line: ml, col: mc };
        }
        // Not a member access after all — restore
        this.pos = savedPos;
      }

      // IDENT { — named struct construction
      if (this.peek().kind === "{") {
        this.advance(); // {
        const fields = this.parseFieldInitList();
        this.expect("}");
        return { tag: "construct", name, form: "named", args: [], fields, line, col };
      }

      // IDENT ? [ ... ] () — nullable element array construction (e.g., Point?[10]())
      if (this.peek().kind === "?" && this.peek(1).kind === "[") {
        this.advance(); // eat ?
        const nullableElem: WacType = { tag: "nullable", inner: { tag: "named", name } };
        return this.parseArrayConstruction(nullableElem);
      }

      // IDENT [ ... ] () — array construction
      if (this.peek().kind === "[") {
        if (this.peek(1).kind === "]") {
          // IDENT [] (...) — array literal constructor
          this.advance(); // [
          this.advance(); // ]
          this.expect("(");
          const elems = this.parseArgList();
          this.expect(")");
          return { tag: "array_new", elemType: { tag: "named", name }, elems, line, col };
        }
        // IDENT [ expr ] () — sized array constructor?
        // Peek further: parse [ expr ] and check if followed by ( )
        // We do this by a tentative parse
        const savedPos = this.pos;
        this.advance(); // [
        const sizeExpr = this.parseExpr();
        if (this.peek().kind === "]" && this.peek(1).kind === "(" && this.peek(2).kind === ")") {
          this.advance(); // ]
          this.advance(); // (
          this.advance(); // )
          return { tag: "array_new", elemType: { tag: "named", name }, size: sizeExpr, line, col };
        }
        // Not array construction — it's an index expression; undo and return ident
        // (postfix will handle the [ ... ] part)
        this.pos = savedPos;
      }

      return { tag: "ident", name, line, col };
    }

    // Unexpected token
    this.pushError("unexpected token", t, t.value.length || 1, "expected expression");
    this.advance();
    return { tag: "null", line, col };
  }

  private isTypeKeyword(k: TokenKind): boolean {
    return ["i8","i16","i32","i64","f32","f64","bool","string"].includes(k as string);
  }

  private parseArrayConstruction(elemType: WacType): Expr {
    const { line, col } = this.peek();
    this.expect("[");
    if (this.peek().kind === "]") {
      this.advance(); // ]
      if (this.peek().kind === "(") {
        // T[] ( elements )
        this.advance(); // (
        const elems = this.parseArgList();
        this.expect(")");
        return { tag: "array_new", elemType, elems, line, col };
      }
      // T[] followed by [ — nested array construction: element type is T[], recurse
      if (this.peek().kind === "[") {
        return this.parseArrayConstruction({ tag: "array", elem: elemType });
      }
      // T[] alone — array literal with no elements
      this.expect("(");  // will error, but gives a cleaner message
      return { tag: "array_new", elemType, elems: [], line, col };
    }
    // T [ size ] ()
    const size = this.parseExpr();
    this.expect("]");
    this.expect("(");
    this.expect(")");
    return { tag: "array_new", elemType, size, line, col };
  }

  private parseArgList(): Expr[] {
    const args: Expr[] = [];
    if (this.peek().kind === ")" || this.peek().kind === "]") return args;
    args.push(this.parseExpr());
    while (this.eat(",")) {
      if (this.peek().kind === ")" || this.peek().kind === "]") break;
      args.push(this.parseExpr());
    }
    return args;
  }

  private parseFieldInitList(): FieldInit[] {
    const fields: FieldInit[] = [];
    if (this.peek().kind === "}") return fields;
    fields.push(this.parseFieldInit());
    while (this.eat(",")) {
      if (this.peek().kind === "}") break;
      fields.push(this.parseFieldInit());
    }
    return fields;
  }

  private parseFieldInit(): FieldInit {
    const { line, col } = this.peek();
    const name = this.expectIdent();
    this.expect(":");
    const value = this.parseExpr();
    return { name, value, line, col };
  }
}

// ---- Helpers ----

function parseIntLiteral(raw: string): bigint {
  if (raw.startsWith("0x") || raw.startsWith("0X")) {
    return BigInt(raw);
  }
  return BigInt(raw);
}

function decodeStrLiteral(raw: string): string {
  // raw includes surrounding quotes: "..."
  const inner = raw.slice(1, -1);
  return inner.replace(/\\(n|t|r|\\|"|0)/g, (_, c: string) => {
    if (c === "n") return "\n";
    if (c === "t") return "\t";
    if (c === "r") return "\r";
    if (c === "\\") return "\\";
    if (c === '"') return '"';
    return "\0"; // c === "0"
  });
}

function decodeCharLiteral(raw: string): string {
  if (raw.startsWith("\\")) {
    const c = raw[1];
    if (c === "n") return "\n";
    if (c === "t") return "\t";
    if (c === "r") return "\r";
    if (c === "\\") return "\\";
    if (c === "'") return "'";
    return "\0"; // c === "0"
  }
  return raw;
}

// Convert an expression node to an LVal if possible (for assignment targets)
function exprToLVal(expr: Expr): LVal | null {
  if (expr.tag === "ident") {
    return { name: expr.name, ops: [], line: expr.line, col: expr.col };
  }

  // Build ops list by walking postfix chain
  const ops: LValOp[] = [];
  let cur: Expr = expr;
  while (true) {
    if (cur.tag === "unwrap") { ops.unshift({ tag: "unwrap" }); cur = cur.operand; }
    else if (cur.tag === "field")  { ops.unshift({ tag: "field", name: cur.name }); cur = cur.object; }
    else if (cur.tag === "index")  { ops.unshift({ tag: "index", idx: cur.idx }); cur = cur.object; }
    else break;
  }
  if (cur.tag === "ident") return { name: cur.name, ops, line: cur.line, col: cur.col };
  return null; // not an lvalue
}
