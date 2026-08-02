// Lexer for wac — tokenizes source into an array of tokens.
// All tokens carry source positions for error reporting.

export type TokenKind =
  // literals
  | "int" | "float" | "string" | "bool"
  // identifiers and keywords
  | "ident"
  | "import" | "export" | "struct" | "const" | "this" | "override"
  | "if" | "else" | "while" | "for" | "do" | "switch" | "case" | "default"
  | "break" | "continue" | "return" | "trap" | "true" | "false" | "null"
  | "is" | "not" | "as" | "void" | "fn" | "enum" | "match"
  // cast operators (multi-char)
  | "as!" | "as~" | "as@"
  // operators
  | "+" | "-" | "*" | "/" | "%" | "=" | "==" | "!=" | "<" | "<=" | ">" | ">="
  | "&&" | "||" | "!" | "&" | "|" | "^" | "~" | "<<" | ">>" | ">>>"
  | "+=" | "-=" | "*=" | "/=" | "%=" | "&=" | "|=" | "^=" | "<<=" | ">>=" | ">>>="
  | "++" | "--"
  // punctuation
  | "(" | ")" | "{" | "}" | "[" | "]" | ";" | ":" | "," | "." | "?" | "@"
  // special
  | "eof";

export type Token = {
  kind: TokenKind;
  /** Raw source text of the token */
  text: string;
  /** 1-based line number */
  line: number;
  /** 1-based column number (start of token) */
  col: number;
};

export type LexError = {
  message: string;
  line: number;
  col: number;
};

export type LexResult = {
  tokens: Token[];
  errors: LexError[];
};

// Keywords that are reserved and cannot be identifiers
const KEYWORDS = new Set<string>([
  // `from` is deliberately absent. It means something only directly after an import
  // clause, and reserving it everywhere cost a parameter named `from` in `slice(a, from,
  // to)` — which reported a missing semicolon at the *next declaration*, a hundred lines
  // on. The import parser matches it by text instead, which `at` already does.
  //
  // Note for anyone editing this block: the spec test extracts every quoted string here
  // and compares it against grammar.md, so a comment with a quoted phrase in it reads as
  // a keyword. That is how this comment was first written, and how it was caught.
  "import", "export", "struct", "const", "this", "override",
  "if", "else", "while", "for", "do", "switch", "case", "default",
  "break", "continue", "return", "trap", "true", "false", "null",
  "is", "not", "as", "void", "fn", "enum", "match",
]);

export function wacLex(source: string): LexResult {
  const tokens: Token[] = [];
  const errors: LexError[] = [];
  let pos = 0;
  let line = 1;
  let lineStart = 0;

  function col(): number { return pos - lineStart + 1; }

  function peek(offset = 0): string { return source[pos + offset] ?? ""; }

  function advance(): string {
    const ch = source[pos++];
    if (ch === "\n") { line++; lineStart = pos; }
    return ch;
  }

  function skipWhitespaceAndComments(): void {
    while (pos < source.length) {
      const ch = peek();
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        advance();
      } else if (ch === "/" && peek(1) === "/") {
        // Line comment
        while (pos < source.length && peek() !== "\n") advance();
      } else if (ch === "/" && peek(1) === "*") {
        // Block comment
        const startLine = line, startCol = col();
        advance(); advance();
        let closed = false;
        while (pos < source.length) {
          if (peek() === "*" && peek(1) === "/") { advance(); advance(); closed = true; break; }
          advance();
        }
        if (!closed) {
          errors.push({ message: `unterminated block comment`, line: startLine, col: startCol });
        }
      } else {
        break;
      }
    }
  }

  function emit(kind: TokenKind, text: string, tokenLine: number, tokenCol: number): void {
    tokens.push({ kind, text, line: tokenLine, col: tokenCol });
  }

  function lexString(startLine: number, startCol: number): void {
    let result = "";
    advance(); // consume opening quote
    let closed = false;
    while (pos < source.length) {
      const ch = peek();
      if (ch === '"') { advance(); closed = true; break; }
      if (ch === "\\") {
        advance();
        const esc = advance();
        switch (esc) {
          case "n":  result += "\n"; break;
          case "t":  result += "\t"; break;
          case "r":  result += "\r"; break;
          case "\\": result += "\\"; break;
          case '"':  result += '"'; break;
          case "0":  result += "\0"; break;
          default:
            errors.push({ message: `unknown escape sequence '\\${esc}'`, line: startLine, col: startCol });
            result += esc;
        }
      } else {
        result += advance();
      }
    }
    if (!closed) {
      errors.push({ message: `unterminated string literal`, line: startLine, col: startCol });
    }
    emit("string", result, startLine, startCol);
  }

  /**
   * Character literal — `'a'`, `'\n'`, `'\''`.
   *
   * Emitted as an `int` token holding the Unicode codepoint in decimal, because
   * wac has no character type: a character literal *is* an integer literal with
   * a friendlier spelling. Typing, widening and emission then follow the same
   * rules as any decimal literal, and nothing downstream needs to know.
   *
   * On a malformed literal an `int` token is still emitted, so one bad literal
   * produces one error rather than derailing the parse behind it.
   */
  function lexChar(startLine: number, startCol: number): void {
    advance(); // consume opening quote

    if (pos >= source.length) {
      errors.push({ message: `unterminated character literal`, line: startLine, col: startCol });
      emit("int", "0", startLine, startCol);
      return;
    }

    let cp: number;
    if (peek() === "'") {
      advance();
      errors.push({ message: `empty character literal`, line: startLine, col: startCol });
      emit("int", "0", startLine, startCol);
      return;
    }

    if (peek() === "\\") {
      advance();
      const esc = advance();
      const escapes: Record<string, number> = {
        n: 0x0A, t: 0x09, r: 0x0D, "\\": 0x5C, "'": 0x27, '"': 0x22, "0": 0x00,
      };
      const mapped = escapes[esc];
      if (mapped === undefined) {
        errors.push({ message: `unknown escape sequence '\\${esc}'`, line: startLine, col: startCol });
        cp = esc.codePointAt(0) ?? 0;
      } else {
        cp = mapped;
      }
    } else {
      cp = source.codePointAt(pos)!;
      advance();
      // Above the BMP the source holds a surrogate pair, which is two units.
      if (cp > 0xFFFF) advance();
    }

    if (peek() !== "'") {
      errors.push({
        message: `character literal must hold exactly one character`,
        line: startLine,
        col: startCol,
      });
      while (pos < source.length && peek() !== "'" && peek() !== "\n") advance();
    }
    if (peek() === "'") advance();

    emit("int", String(cp), startLine, startCol);
  }

  function lexNumber(startLine: number, startCol: number): void {
    let text = "";
    // Hex literal
    if (peek() === "0" && (peek(1) === "x" || peek(1) === "X")) {
      text += advance(); // 0
      text += advance(); // x
      while (/[0-9a-fA-F_]/.test(peek())) text += advance();
      emit("int", text, startLine, startCol);
      return;
    }
    // Decimal digits
    while (/[0-9_]/.test(peek())) text += advance();
    /** An exponent, which makes the literal a float wherever it appears. */
    const takeExponent = (): boolean => {
      if (peek() !== "e" && peek() !== "E") return false;
      const signed = peek(1) === "+" || peek(1) === "-";
      if (!/[0-9]/.test(peek(signed ? 2 : 1))) return false;   // `1electron` is not a number
      text += advance();
      if (signed) text += advance();
      while (/[0-9_]/.test(peek())) text += advance();
      return true;
    };
    // Float: a decimal point, or an exponent, or both.
    //
    // `1e9` used to lex as the integer `1` followed by the identifier `e9`, because the grammar
    // required the point. That was a real rule rather than an oversight, but a poor one: `1e9` for a
    // billion is common, every language in this family accepts it, and an exponent marks a float as
    // unambiguously as a point does [issue 0018].
    if (peek() === "." && /[0-9]/.test(peek(1))) {
      text += advance(); // dot
      while (/[0-9_]/.test(peek())) text += advance();
      takeExponent();
      emit("float", text, startLine, startCol);
    } else if (takeExponent()) {
      emit("float", text, startLine, startCol);
    } else {
      emit("int", text, startLine, startCol);
    }
  }

  while (pos < source.length) {
    skipWhitespaceAndComments();
    if (pos >= source.length) break;

    const startLine = line;
    const startCol = col();
    const ch = peek();

    // String literal
    if (ch === '"') { lexString(startLine, startCol); continue; }

    // Character literal
    if (ch === "'") { lexChar(startLine, startCol); continue; }

    // Number literal
    if (/[0-9]/.test(ch)) { lexNumber(startLine, startCol); continue; }

    // Identifier or keyword
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (/[a-zA-Z0-9_]/.test(peek())) ident += advance();
      // Check for cast operators: as!, as~, as@
      if (ident === "as") {
        const next = peek();
        if (next === "!") { advance(); emit("as!", "as!", startLine, startCol); continue; }
        if (next === "~") { advance(); emit("as~", "as~", startLine, startCol); continue; }
        if (next === "@") { advance(); emit("as@", "as@", startLine, startCol); continue; }
      }
      const kind: TokenKind = (KEYWORDS.has(ident) ? ident : "ident") as TokenKind;
      emit(kind, ident, startLine, startCol);
      continue;
    }

    // Operators and punctuation — consume char
    advance();

    switch (ch) {
      case "+":
        if (peek() === "+") { advance(); emit("++", "++", startLine, startCol); }
        else if (peek() === "=") { advance(); emit("+=", "+=", startLine, startCol); }
        else emit("+", "+", startLine, startCol);
        break;
      case "-":
        if (peek() === "-") { advance(); emit("--", "--", startLine, startCol); }
        else if (peek() === "=") { advance(); emit("-=", "-=", startLine, startCol); }
        else emit("-", "-", startLine, startCol);
        break;
      case "*":
        if (peek() === "=") { advance(); emit("*=", "*=", startLine, startCol); }
        else emit("*", "*", startLine, startCol);
        break;
      case "/":
        if (peek() === "=") { advance(); emit("/=", "/=", startLine, startCol); }
        else emit("/", "/", startLine, startCol);
        break;
      case "%":
        if (peek() === "=") { advance(); emit("%=", "%=", startLine, startCol); }
        else emit("%", "%", startLine, startCol);
        break;
      case "=":
        if (peek() === "=") { advance(); emit("==", "==", startLine, startCol); }
        else emit("=", "=", startLine, startCol);
        break;
      case "!":
        if (peek() === "=") { advance(); emit("!=", "!=", startLine, startCol); }
        else emit("!", "!", startLine, startCol);
        break;
      case "<":
        if (peek() === "<") {
          advance();
          if (peek() === "=") { advance(); emit("<<=", "<<=", startLine, startCol); }
          else emit("<<", "<<", startLine, startCol);
        } else if (peek() === "=") { advance(); emit("<=", "<=", startLine, startCol); }
        else emit("<", "<", startLine, startCol);
        break;
      case ">":
        if (peek() === ">") {
          advance();
          if (peek() === ">") {
            advance();
            if (peek() === "=") { advance(); emit(">>>=", ">>>=", startLine, startCol); }
            else emit(">>>", ">>>", startLine, startCol);
          }
          else if (peek() === "=") { advance(); emit(">>=", ">>=", startLine, startCol); }
          else emit(">>", ">>", startLine, startCol);
        } else if (peek() === "=") { advance(); emit(">=", ">=", startLine, startCol); }
        else emit(">", ">", startLine, startCol);
        break;
      case "&":
        if (peek() === "&") { advance(); emit("&&", "&&", startLine, startCol); }
        else if (peek() === "=") { advance(); emit("&=", "&=", startLine, startCol); }
        else emit("&", "&", startLine, startCol);
        break;
      case "|":
        if (peek() === "|") { advance(); emit("||", "||", startLine, startCol); }
        else if (peek() === "=") { advance(); emit("|=", "|=", startLine, startCol); }
        else emit("|", "|", startLine, startCol);
        break;
      case "^":
        if (peek() === "=") { advance(); emit("^=", "^=", startLine, startCol); }
        else emit("^", "^", startLine, startCol);
        break;
      case "~": emit("~", "~", startLine, startCol); break;
      case "(": emit("(", "(", startLine, startCol); break;
      case ")": emit(")", ")", startLine, startCol); break;
      case "{": emit("{", "{", startLine, startCol); break;
      case "}": emit("}", "}", startLine, startCol); break;
      case "[": emit("[", "[", startLine, startCol); break;
      case "]": emit("]", "]", startLine, startCol); break;
      case ";": emit(";", ";", startLine, startCol); break;
      case ":": emit(":", ":", startLine, startCol); break;
      case ",": emit(",", ",", startLine, startCol); break;
      case ".": emit(".", ".", startLine, startCol); break;
      case "?": emit("?", "?", startLine, startCol); break;
      case "@": emit("@", "@", startLine, startCol); break;
      default:
        errors.push({ message: `unexpected character '${ch}'`, line: startLine, col: startCol });
    }
  }

  emit("eof", "", line, col());
  return { tokens, errors };
}
