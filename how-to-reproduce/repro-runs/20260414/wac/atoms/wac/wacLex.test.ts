import { wacLex } from "./wacLex.ts";
import type { Token, TokenKind } from "./wacLex.ts";

function kinds(src: string): TokenKind[] {
  const { tokens } = wacLex(src);
  return tokens.map((t) => t.kind);
}

function values(src: string): string[] {
  const { tokens } = wacLex(src);
  return tokens.map((t) => t.value);
}

// --- Keywords ---
Deno.test("wacLex: all keywords lex to their own kind", () => {
  const kws = [
    "as", "bool", "break", "case", "const", "continue", "default", "do",
    "else", "export", "f32", "f64", "false", "fn", "for", "i16", "i32",
    "i64", "i8", "if", "import", "is", "not", "null", "override", "return",
    "string", "struct", "switch", "trap", "true", "void", "while",
  ] as const;
  for (const kw of kws) {
    const { tokens, errors } = wacLex(kw);
    if (errors.length > 0) throw new Error(`${kw}: unexpected errors`);
    if (tokens[0].kind !== kw) throw new Error(`${kw}: got kind '${tokens[0].kind}'`);
  }
});

// --- Cast operators ---
Deno.test("wacLex: cast operators as! as~ as@", () => {
  const result = kinds("as! as~ as@");
  if (result[0] !== "as!") throw new Error(`expected as!, got ${result[0]}`);
  if (result[1] !== "as~") throw new Error(`expected as~, got ${result[1]}`);
  if (result[2] !== "as@") throw new Error(`expected as@, got ${result[2]}`);
});

Deno.test("wacLex: 'as' without suffix is keyword", () => {
  const { tokens } = wacLex("x as i64");
  if (tokens[1].kind !== "as") throw new Error(`expected 'as', got ${tokens[1].kind}`);
});

// --- Identifiers vs keywords ---
Deno.test("wacLex: identifiers not matching keywords", () => {
  const { tokens } = wacLex("foo _bar baz123 _");
  if (tokens[0].kind !== "ident" || tokens[0].value !== "foo") throw new Error("foo");
  if (tokens[1].kind !== "ident" || tokens[1].value !== "_bar") throw new Error("_bar");
  if (tokens[2].kind !== "ident" || tokens[2].value !== "baz123") throw new Error("baz123");
  if (tokens[3].kind !== "ident" || tokens[3].value !== "_") throw new Error("_");
});

Deno.test("wacLex: contextual non-keywords lex as ident", () => {
  // from, anyref, i31ref are not in keyword list — become idents
  const k = kinds("from anyref i31ref");
  if (k[0] !== "ident") throw new Error(`from: ${k[0]}`);
  if (k[1] !== "ident") throw new Error(`anyref: ${k[1]}`);
  if (k[2] !== "ident") throw new Error(`i31ref: ${k[2]}`);
});

// --- Integer literals ---
Deno.test("wacLex: decimal integers", () => {
  const k = kinds("0 42 1000000");
  if (k[0] !== "int") throw new Error("0");
  if (k[1] !== "int") throw new Error("42");
  if (k[2] !== "int") throw new Error("1000000");
  const v = values("0 42 1000000");
  if (v[0] !== "0") throw new Error("val 0");
  if (v[1] !== "42") throw new Error("val 42");
  if (v[2] !== "1000000") throw new Error("val 1000000");
});

Deno.test("wacLex: hex literals", () => {
  const k = kinds("0xFF 0x00 0xDEADBEEF");
  if (k[0] !== "int") throw new Error("0xFF");
  if (k[1] !== "int") throw new Error("0x00");
  if (k[2] !== "int") throw new Error("0xDEADBEEF");
  const v = values("0xFF 0x00 0xDEADBEEF");
  if (v[0] !== "0xFF") throw new Error("val 0xFF");
  if (v[2] !== "0xDEADBEEF") throw new Error("val 0xDEADBEEF");
});

// --- Float literals ---
Deno.test("wacLex: float literals", () => {
  const k = kinds("3.14 2.718281828459045 0.0");
  if (k[0] !== "float") throw new Error("3.14");
  if (k[1] !== "float") throw new Error("2.718...");
  if (k[2] !== "float") throw new Error("0.0");
  const v = values("3.14 2.718281828459045");
  if (v[0] !== "3.14") throw new Error("val 3.14");
  if (v[1] !== "2.718281828459045") throw new Error("val 2.718...");
});

Deno.test("wacLex: '3.' is integer 3 then dot, not float (no digit after dot)", () => {
  // 3. followed by a non-digit → emit int "3", then "."
  const k = kinds("3.x");
  if (k[0] !== "int") throw new Error(`expected int, got ${k[0]}`);
  if (k[1] !== ".") throw new Error(`expected ., got ${k[1]}`);
  if (k[2] !== "ident") throw new Error(`expected ident, got ${k[2]}`);
});

// --- String literals ---
Deno.test("wacLex: string literal basic", () => {
  const { tokens } = wacLex('"hello"');
  if (tokens[0].kind !== "str") throw new Error("not str");
  if (tokens[0].value !== '"hello"') throw new Error(`val: ${tokens[0].value}`);
});

Deno.test("wacLex: string escape sequences", () => {
  const { tokens, errors } = wacLex('"\\n\\t\\r\\\\\\\"\\0"');
  if (errors.length > 0) throw new Error(`unexpected errors: ${JSON.stringify(errors)}`);
  if (tokens[0].kind !== "str") throw new Error("not str");
  // value should be the raw source including backslashes
  if (!tokens[0].value.includes("\\n")) throw new Error("missing \\n");
});

Deno.test("wacLex: empty string", () => {
  const { tokens } = wacLex('""');
  if (tokens[0].kind !== "str") throw new Error("not str");
  if (tokens[0].value !== '""') throw new Error(`val: ${tokens[0].value}`);
});

Deno.test("wacLex: unterminated string produces error", () => {
  const { errors } = wacLex('"hello');
  if (errors.length === 0) throw new Error("expected error");
  if (!errors[0].message.includes("unterminated")) throw new Error(errors[0].message);
});

// --- Char literals ---
Deno.test("wacLex: char literal", () => {
  const { tokens } = wacLex("'a'");
  if (tokens[0].kind !== "char") throw new Error("not char");
  if (tokens[0].value !== "a") throw new Error(`val: ${tokens[0].value}`);
});

Deno.test("wacLex: char escape", () => {
  const { tokens } = wacLex("'\\n'");
  if (tokens[0].kind !== "char") throw new Error("not char");
  if (tokens[0].value !== "\\n") throw new Error(`val: ${tokens[0].value}`);
});

// --- Operators (exhaustive) ---
Deno.test("wacLex: compound assignment operators", () => {
  const ops = ["+=" , "-=", "*=", "/=", "%=", "<<=", ">>=", "&=", "|=", "^="];
  for (const op of ops) {
    const k = kinds(op);
    if (k[0] !== op as TokenKind) throw new Error(`${op}: got ${k[0]}`);
  }
});

Deno.test("wacLex: increment and decrement", () => {
  const k = kinds("++ --");
  if (k[0] !== "++") throw new Error("++");
  if (k[1] !== "--") throw new Error("--");
});

Deno.test("wacLex: comparison operators", () => {
  const k = kinds("== != < <= > >= << >>");
  const expected: TokenKind[] = ["==", "!=", "<", "<=", ">", ">=", "<<", ">>"];
  for (let i = 0; i < expected.length; i++) {
    if (k[i] !== expected[i]) throw new Error(`[${i}] expected ${expected[i]}, got ${k[i]}`);
  }
});

Deno.test("wacLex: logical and bitwise operators", () => {
  const k = kinds("&& || & | ^ ~");
  const expected: TokenKind[] = ["&&", "||", "&", "|", "^", "~"];
  for (let i = 0; i < expected.length; i++) {
    if (k[i] !== expected[i]) throw new Error(`[${i}] expected ${expected[i]}, got ${k[i]}`);
  }
});

// --- Disambiguation: != vs ! ---
Deno.test("wacLex: ! followed by = is !=, standalone ! is !", () => {
  const k = kinds("a != b a!.x");
  if (k[1] !== "!=") throw new Error(`expected !=, got ${k[1]}`);
  // in "a!.x": a ident, ! unwrap, . dot, x ident
  if (k[4] !== "!") throw new Error(`expected !, got ${k[4]}`);
});

// --- Source location ---
Deno.test("wacLex: line and column tracking", () => {
  const { tokens } = wacLex("i32 x\n  = 5;");
  // "i32" at line 1 col 1
  if (tokens[0].line !== 1 || tokens[0].col !== 1) throw new Error(`i32: ${tokens[0].line}:${tokens[0].col}`);
  // "x" at line 1 col 5
  if (tokens[1].line !== 1 || tokens[1].col !== 5) throw new Error(`x: ${tokens[1].line}:${tokens[1].col}`);
  // "=" at line 2 col 3
  if (tokens[2].line !== 2 || tokens[2].col !== 3) throw new Error(`=: ${tokens[2].line}:${tokens[2].col}`);
  // "5" at line 2 col 5
  if (tokens[3].line !== 2 || tokens[3].col !== 5) throw new Error(`5: ${tokens[3].line}:${tokens[3].col}`);
});

// --- Comments ---
Deno.test("wacLex: line comments are skipped", () => {
  const k = kinds("x // this is a comment\ny");
  if (k[0] !== "ident" || k[1] !== "ident") throw new Error(`got ${k[0]}, ${k[1]}`);
  // only x, y, eof — comment skipped
  if (k.length !== 3) throw new Error(`length ${k.length}`);
});

// --- EOF sentinel ---
Deno.test("wacLex: eof token at end", () => {
  const { tokens } = wacLex("x");
  const last = tokens[tokens.length - 1];
  if (last.kind !== "eof") throw new Error(`last is ${last.kind}`);
});

Deno.test("wacLex: empty input produces only eof", () => {
  const { tokens } = wacLex("");
  if (tokens.length !== 1 || tokens[0].kind !== "eof") throw new Error("bad");
});

// --- Complex snippet ---
Deno.test("wacLex: full function snippet produces correct token sequence", () => {
  const src = `export i32 gcd(i32 a, i32 b) {
  while (b != 0) {
    i32 t = b;
    b = a % b;
    a = t;
  }
  return a;
}`;
  const k = kinds(src);
  // First few: export i32 ident ( i32 ident , i32 ident ) {
  const expected: TokenKind[] = ["export", "i32", "ident", "(", "i32", "ident", ",", "i32", "ident", ")"];
  for (let i = 0; i < expected.length; i++) {
    if (k[i] !== expected[i]) throw new Error(`[${i}] expected ${expected[i]}, got ${k[i]}`);
  }
  if (k[k.length - 1] !== "eof") throw new Error("no eof");
});

// --- Bare arithmetic operators (not compound, not ++ --) ---
Deno.test("wacLex: bare + - * / % operators", () => {
  const k = kinds("a + b - c * d / e % f");
  const ops = ["+", "-", "*", "/", "%"] as const;
  // tokens: ident op ident op ... so ops at indices 1,3,5,7,9
  for (let i = 0; i < ops.length; i++) {
    if (k[1 + i * 2] !== ops[i]) throw new Error(`${ops[i]}: got ${k[1 + i * 2]}`);
  }
});

// --- Delimiters not tested elsewhere ---
Deno.test("wacLex: [ ] ; : delimiters", () => {
  const k = kinds("arr[0]; x: y");
  if (!k.includes("[")) throw new Error("missing [");
  if (!k.includes("]")) throw new Error("missing ]");
  if (!k.includes(";")) throw new Error("missing ;");
  if (!k.includes(":")) throw new Error("missing :");
});

// --- Uncovered error paths ---
Deno.test("wacLex: invalid hex 0x with no digits produces error", () => {
  const { errors } = wacLex("0x ");
  if (errors.length === 0) throw new Error("expected error");
  if (!errors[0].message.includes("hex")) throw new Error(errors[0].message);
});

Deno.test("wacLex: unknown escape sequence in string", () => {
  const { tokens, errors } = wacLex('"\\q"');
  if (errors.length === 0) throw new Error("expected error");
  if (!errors[0].message.includes("unknown escape")) throw new Error(errors[0].message);
  // still emits the token
  if (tokens[0].kind !== "str") throw new Error("no str token");
});

Deno.test("wacLex: string terminated by newline (not EOF)", () => {
  const { errors } = wacLex('"hello\nworld"');
  if (errors.length === 0) throw new Error("expected error");
  if (!errors[0].message.includes("unterminated")) throw new Error(errors[0].message);
});

Deno.test("wacLex: unknown escape in char literal", () => {
  const { errors } = wacLex("'\\q'");
  if (errors.length === 0) throw new Error("expected error");
  if (!errors[0].message.includes("unknown escape")) throw new Error(errors[0].message);
});

Deno.test("wacLex: empty char literal error", () => {
  const { errors } = wacLex("''");
  if (errors.length === 0) throw new Error("expected error");
  if (!errors[0].message.includes("empty")) throw new Error(errors[0].message);
});

Deno.test("wacLex: char literal at EOF without closing quote (after content)", () => {
  const { errors } = wacLex("'a");
  if (errors.length === 0) throw new Error("expected error");
});

Deno.test("wacLex: char literal at EOF immediately (just opening quote)", () => {
  // Covers pos >= src.length branch in char handling
  const { errors } = wacLex("'");
  if (errors.length === 0) throw new Error("expected error");
  if (!errors[0].message.includes("unterminated")) throw new Error(errors[0].message);
});

Deno.test("wacLex: colon token standalone", () => {
  const { tokens } = wacLex(":");
  if (tokens[0].kind !== ":") throw new Error(`expected :, got ${tokens[0].kind}`);
});

Deno.test("wacLex: question mark token (nullable type suffix)", () => {
  const k = kinds("Point?");
  if (k[0] !== "ident") throw new Error(`expected ident, got ${k[0]}`);
  if (k[1] !== "?") throw new Error(`expected ?, got ${k[1]}`);
});

Deno.test("wacLex: astral codepoint (emoji surrogate pair) in char literal", () => {
  // '😀' — U+1F600 is represented as surrogate pair in JS strings
  const { tokens, errors } = wacLex("'😀'");
  if (errors.length > 0) throw new Error(`unexpected errors: ${JSON.stringify(errors)}`);
  if (tokens[0].kind !== "char") throw new Error("expected char token");
  // value should be the two-code-unit emoji
  if (tokens[0].value.length !== 2) throw new Error(`expected 2 code units, got ${tokens[0].value.length}`);
});

// --- Unknown character ---
Deno.test("wacLex: unknown character produces error, lexing continues", () => {
  const { tokens, errors } = wacLex("x @ y");
  if (errors.length === 0) throw new Error("expected error for @");
  if (!errors[0].message.includes("@")) throw new Error(errors[0].message);
  // x and y still tokenized
  const k = tokens.map((t) => t.kind);
  if (!k.includes("ident")) throw new Error("missing idents");
});
