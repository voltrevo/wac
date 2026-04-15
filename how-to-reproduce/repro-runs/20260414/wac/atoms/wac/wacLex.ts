// Lexer for the wac language. Converts source text to a flat token array.
// Pure TypeScript — no platform APIs.

export type TokenKind =
  // Literals
  | "int" | "float" | "str" | "char" | "ident"
  // Cast operators (multi-char, built on "as")
  | "as" | "as!" | "as~" | "as@"
  // Type keywords
  | "i8" | "i16" | "i32" | "i64" | "f32" | "f64"
  | "bool" | "string" | "void"
  // Value keywords
  | "true" | "false" | "null"
  // Control flow
  | "if" | "else" | "while" | "for" | "do"
  | "break" | "continue" | "return" | "trap"
  | "switch" | "case" | "default"
  // Declaration keywords
  | "export" | "import" | "fn" | "struct"
  | "const" | "override"
  // Operator keywords
  | "is" | "not"
  // Delimiters
  | "(" | ")" | "{" | "}" | "[" | "]"
  | "." | "," | ";" | ":" | "?" | "!"
  // Comparison and equality
  | "==" | "!=" | "<" | "<=" | ">" | ">="
  // Assignment
  | "="
  // Arithmetic
  | "+" | "-" | "*" | "/" | "%"
  // Bitwise / shift
  | "<<" | ">>" | "&" | "|" | "^" | "~"
  // Logical
  | "&&" | "||"
  // Increment / decrement
  | "++" | "--"
  // Compound assignment
  | "+=" | "-=" | "*=" | "/=" | "%="
  | "<<=" | ">>=" | "&=" | "|=" | "^="
  // Sentinel
  | "eof";

export type Token = {
  kind: TokenKind;
  value: string; // raw source text for this token
  line: number;  // 1-based
  col: number;   // 1-based
};

export type LexError = {
  message: string;
  line: number;
  col: number;
  span: number;
};

export type LexResult = {
  tokens: Token[];
  errors: LexError[];
};

// Keywords that map directly to their own token kind.
const KEYWORDS: Partial<Record<string, TokenKind>> = {
  as: "as", bool: "bool", break: "break", case: "case", const: "const",
  continue: "continue", default: "default", do: "do", else: "else",
  export: "export", f32: "f32", f64: "f64", false: "false", fn: "fn",
  for: "for", i16: "i16", i32: "i32", i64: "i64", i8: "i8", if: "if",
  import: "import", is: "is", not: "not", null: "null",
  override: "override", return: "return", string: "string",
  struct: "struct", switch: "switch", trap: "trap", true: "true",
  void: "void", while: "while",
};

export function wacLex(src: string): LexResult {
  const tokens: Token[] = [];
  const errors: LexError[] = [];
  let pos = 0;
  let line = 1;
  let lineStart = 0;

  function col(): number { return pos - lineStart + 1; }
  function peek(offset = 0): string { return src[pos + offset] ?? ""; }

  function advance(): string {
    const ch = src[pos++];
    if (ch === "\n") { line++; lineStart = pos; }
    return ch;
  }

  function tok(kind: TokenKind, value: string, tLine: number, tCol: number): void {
    tokens.push({ kind, value, line: tLine, col: tCol });
  }

  function err(message: string, tLine: number, tCol: number, span: number): void {
    errors.push({ message, line: tLine, col: tCol, span });
  }

  while (pos < src.length) {
    // Skip whitespace
    if (" \t\r\n".includes(peek())) { advance(); continue; }

    // Skip line comments
    if (peek() === "/" && peek(1) === "/") {
      while (pos < src.length && peek() !== "\n") advance();
      continue;
    }

    const startLine = line;
    const startCol = col();
    const startPos = pos;
    const ch = peek();

    // --- Numeric literals ---
    if (ch >= "0" && ch <= "9") {
      // Hex literal: 0x...
      if (ch === "0" && (peek(1) === "x" || peek(1) === "X")) {
        advance(); advance(); // consume "0" and "x"
        if (!/[0-9a-fA-F]/.test(peek())) {
          err("expected hex digits after '0x'", startLine, startCol, 2);
        }
        while (/[0-9a-fA-F]/.test(peek())) advance();
        tok("int", src.slice(startPos, pos), startLine, startCol);
      } else {
        // Decimal integer or float
        while (peek() >= "0" && peek() <= "9") advance();
        if (peek() === "." && peek(1) >= "0" && peek(1) <= "9") {
          advance(); // consume "."
          while (peek() >= "0" && peek() <= "9") advance();
          tok("float", src.slice(startPos, pos), startLine, startCol);
        } else {
          tok("int", src.slice(startPos, pos), startLine, startCol);
        }
      }
      continue;
    }

    // --- String literals ---
    if (ch === '"') {
      advance(); // opening "
      let value = '"';
      while (pos < src.length && peek() !== '"') {
        if (peek() === "\\") {
          const bsPos = pos;
          advance(); // backslash
          const esc = advance();
          if (!"ntr\\\"0".includes(esc)) {
            err(`unknown escape sequence '\\${esc}'`, line, pos - lineStart, 2);
          }
          value += "\\" + esc;
        } else if (peek() === "\n") {
          err("unterminated string literal", startLine, startCol, pos - startPos);
          break;
        } else {
          value += advance();
        }
      }
      if (pos >= src.length) {
        err("unterminated string literal", startLine, startCol, pos - startPos);
      } else {
        advance(); // closing "
        value += '"';
      }
      tok("str", value, startLine, startCol);
      continue;
    }

    // --- Char literals ---
    if (ch === "'") {
      advance(); // opening '
      let value = "";
      if (peek() === "\\") {
        advance(); // backslash
        const esc = advance();
        if (!"ntr\\'0".includes(esc)) {
          err(`unknown escape sequence '\\${esc}'`, line, pos - lineStart, 2);
        }
        value = "\\" + esc;
      } else if (peek() === "'") {
        err("empty char literal", startLine, startCol, 2);
      } else if (peek() === "\n" || pos >= src.length) {
        err("unterminated char literal", startLine, startCol, pos - startPos);
      } else {
        // Consume one UTF-16 code unit (or surrogate pair for astral codepoints)
        const cu = src.charCodeAt(pos);
        value = advance();
        if (cu >= 0xD800 && cu <= 0xDBFF && pos < src.length) {
          value += advance(); // low surrogate
        }
      }
      if (peek() === "'") {
        advance(); // closing '
      } else {
        err("expected closing \"'\" after char literal", startLine, startCol, pos - startPos);
      }
      tok("char", value, startLine, startCol);
      continue;
    }

    // --- Identifiers and keywords ---
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      while (/[a-zA-Z0-9_]/.test(peek())) advance();
      const text = src.slice(startPos, pos);

      // Special: "as" can be followed immediately (no space) by !, ~, @
      if (text === "as" && (peek() === "!" || peek() === "~" || peek() === "@")) {
        const suffix = advance();
        tok(`as${suffix}` as "as!" | "as~" | "as@", text + suffix, startLine, startCol);
      } else {
        const kw = KEYWORDS[text];
        tok(kw ?? "ident", text, startLine, startCol);
      }
      continue;
    }

    // --- Operators and punctuation (consume ch first, then lookahead) ---
    advance(); // consume ch
    const next = peek(); // one-char lookahead

    switch (ch) {
      case "=":
        if (next === "=") { advance(); tok("==", "==", startLine, startCol); }
        else tok("=", "=", startLine, startCol);
        break;
      case "!":
        if (next === "=") { advance(); tok("!=", "!=", startLine, startCol); }
        else tok("!", "!", startLine, startCol);
        break;
      case "<":
        if (next === "<") {
          advance();
          if (peek() === "=") { advance(); tok("<<=", "<<=", startLine, startCol); }
          else tok("<<", "<<", startLine, startCol);
        } else if (next === "=") { advance(); tok("<=", "<=", startLine, startCol); }
        else tok("<", "<", startLine, startCol);
        break;
      case ">":
        if (next === ">") {
          advance();
          if (peek() === "=") { advance(); tok(">>=", ">>=", startLine, startCol); }
          else tok(">>", ">>", startLine, startCol);
        } else if (next === "=") { advance(); tok(">=", ">=", startLine, startCol); }
        else tok(">", ">", startLine, startCol);
        break;
      case "+":
        if (next === "+") { advance(); tok("++", "++", startLine, startCol); }
        else if (next === "=") { advance(); tok("+=", "+=", startLine, startCol); }
        else tok("+", "+", startLine, startCol);
        break;
      case "-":
        if (next === "-") { advance(); tok("--", "--", startLine, startCol); }
        else if (next === "=") { advance(); tok("-=", "-=", startLine, startCol); }
        else tok("-", "-", startLine, startCol);
        break;
      case "*":
        if (next === "=") { advance(); tok("*=", "*=", startLine, startCol); }
        else tok("*", "*", startLine, startCol);
        break;
      case "/":
        if (next === "=") { advance(); tok("/=", "/=", startLine, startCol); }
        else tok("/", "/", startLine, startCol);
        break;
      case "%":
        if (next === "=") { advance(); tok("%=", "%=", startLine, startCol); }
        else tok("%", "%", startLine, startCol);
        break;
      case "&":
        if (next === "&") { advance(); tok("&&", "&&", startLine, startCol); }
        else if (next === "=") { advance(); tok("&=", "&=", startLine, startCol); }
        else tok("&", "&", startLine, startCol);
        break;
      case "|":
        if (next === "|") { advance(); tok("||", "||", startLine, startCol); }
        else if (next === "=") { advance(); tok("|=", "|=", startLine, startCol); }
        else tok("|", "|", startLine, startCol);
        break;
      case "^":
        if (next === "=") { advance(); tok("^=", "^=", startLine, startCol); }
        else tok("^", "^", startLine, startCol);
        break;
      case "~": tok("~", "~", startLine, startCol); break;
      case "(": tok("(", "(", startLine, startCol); break;
      case ")": tok(")", ")", startLine, startCol); break;
      case "{": tok("{", "{", startLine, startCol); break;
      case "}": tok("}", "}", startLine, startCol); break;
      case "[": tok("[", "[", startLine, startCol); break;
      case "]": tok("]", "]", startLine, startCol); break;
      case ".": tok(".", ".", startLine, startCol); break;
      case ",": tok(",", ",", startLine, startCol); break;
      case ";": tok(";", ";", startLine, startCol); break;
      case ":": tok(":", ":", startLine, startCol); break;
      case "?": tok("?", "?", startLine, startCol); break;
      default:
        err(`unexpected character '${ch}'`, startLine, startCol, 1);
    }
  }

  tok("eof", "", line, col());
  return { tokens, errors };
}
