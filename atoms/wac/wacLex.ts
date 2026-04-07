// Lexer for wac — tokenizes source into an array of tokens.
// All tokens carry source positions for error reporting.

export type TokenKind =
  // literals
  | "int" | "float" | "string" | "bool"
  // identifiers and keywords
  | "ident"
  | "import" | "from" | "export" | "struct" | "const" | "this" | "override"
  | "if" | "else" | "while" | "for" | "do" | "switch" | "case" | "default"
  | "break" | "continue" | "return" | "trap" | "true" | "false" | "null"
  | "is" | "not" | "as" | "void" | "fn"
  // cast operators (multi-char)
  | "as!" | "as~" | "as@"
  // operators
  | "+" | "-" | "*" | "/" | "%" | "=" | "==" | "!=" | "<" | "<=" | ">" | ">="
  | "&&" | "||" | "!" | "&" | "|" | "^" | "~" | "<<" | ">>"
  | "+=" | "-=" | "*=" | "/=" | "%=" | "&=" | "|=" | "^=" | "<<=" | ">>="
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
  "import", "from", "export", "struct", "const", "this", "override",
  "if", "else", "while", "for", "do", "switch", "case", "default",
  "break", "continue", "return", "trap", "true", "false", "null",
  "is", "not", "as", "void", "fn",
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
        advance(); advance();
        while (pos < source.length) {
          if (peek() === "*" && peek(1) === "/") { advance(); advance(); break; }
          advance();
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
    while (pos < source.length) {
      const ch = peek();
      if (ch === '"') { advance(); break; }
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
    emit("string", result, startLine, startCol);
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
    // Float: dot followed by digit
    if (peek() === "." && /[0-9]/.test(peek(1))) {
      text += advance(); // dot
      while (/[0-9_]/.test(peek())) text += advance();
      // Optional exponent
      if (peek() === "e" || peek() === "E") {
        text += advance();
        if (peek() === "+" || peek() === "-") text += advance();
        while (/[0-9_]/.test(peek())) text += advance();
      }
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
          if (peek() === "=") { advance(); emit(">>=", ">>=", startLine, startCol); }
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
