import { wacLex, type Token, type TokenKind } from "./wacLex.ts";

function kinds(src: string): string[] {
  return wacLex(src).tokens.map((t) => t.kind);
}

function texts(src: string): string[] {
  return wacLex(src).tokens.map((t) => t.text);
}

function tok(src: string): [TokenKind, string][] {
  return wacLex(src).tokens.map((t) => [t.kind, t.text]);
}

// ── keywords ─────────────────────────────────────────────────────────────────

Deno.test("wacLex: all keywords tokenized correctly", () => {
  const kwSrc =
    "import from export struct const this override if else while for do switch case default break continue return trap true false null is not as void fn";
  const kws = kwSrc.split(" ");
  const { tokens, errors } = wacLex(kwSrc);
  if (errors.length) throw new Error("unexpected errors: " + JSON.stringify(errors));
  const kindsOnly = tokens.filter((t) => t.kind !== "eof").map((t) => t.kind);
  for (const kw of kws) {
    if (!kindsOnly.includes(kw as TokenKind)) throw new Error(`keyword '${kw}' not found`);
  }
});

// ── identifiers ──────────────────────────────────────────────────────────────

Deno.test("wacLex: identifiers (including type names like i32)", () => {
  const t = tok("i32 myVar _x snake_case CamelCase i64 f32 f64 bool anyref i31ref");
  const idents = t.filter(([k]) => k === "ident");
  if (idents.length !== 11) throw new Error(`expected 11 idents, got ${idents.length}: ${JSON.stringify(idents)}`);
  if (idents[0][1] !== "i32") throw new Error("first ident should be i32");
  if (idents[2][1] !== "_x") throw new Error("ident _x");
});

// ── integer literals ─────────────────────────────────────────────────────────

Deno.test("wacLex: decimal integer literals", () => {
  const t = tok("0 42 2147483647 1000000000");
  const ints = t.filter(([k]) => k === "int");
  if (ints.length !== 4) throw new Error("expected 4 ints");
  if (ints[0][1] !== "0") throw new Error("int 0");
  if (ints[1][1] !== "42") throw new Error("int 42");
  if (ints[2][1] !== "2147483647") throw new Error("int 2147483647");
});

Deno.test("wacLex: hex integer literals", () => {
  const t = tok("0xFF 0x00 0xDEADBEEF 0x1A2B");
  const ints = t.filter(([k]) => k === "int");
  if (ints.length !== 4) throw new Error("expected 4 hex ints");
  if (ints[0][1] !== "0xFF") throw new Error("hex 0xFF");
  if (ints[2][1] !== "0xDEADBEEF") throw new Error("hex 0xDEADBEEF");
});

// ── float literals ────────────────────────────────────────────────────────────

Deno.test("wacLex: float literals", () => {
  const t = tok("3.14 2.718281828459045 0.0 1.0e10 2.5E-3");
  const floats = t.filter(([k]) => k === "float");
  if (floats.length !== 5) throw new Error(`expected 5 floats, got ${floats.length}: ${JSON.stringify(floats)}`);
  if (floats[0][1] !== "3.14") throw new Error("float 3.14");
  if (floats[2][1] !== "0.0") throw new Error("float 0.0");
  if (floats[3][1] !== "1.0e10") throw new Error("float exponent");
});

// ── string literals ───────────────────────────────────────────────────────────

Deno.test("wacLex: string literal basic", () => {
  const t = tok(`"hello"`);
  if (t[0][0] !== "string") throw new Error("not a string token");
  if (t[0][1] !== "hello") throw new Error("text should be 'hello'");
});

Deno.test("wacLex: string escape sequences", () => {
  const t = tok(`"\\n\\t\\r\\\\\\\"\\0"`);
  if (t[0][0] !== "string") throw new Error("not a string");
  const val = t[0][1];
  if (val.length !== 6) throw new Error(`expected 6 chars, got ${val.length}: ${JSON.stringify(val)}`);
  if (val[0] !== "\n") throw new Error("newline escape");
  if (val[1] !== "\t") throw new Error("tab escape");
  if (val[2] !== "\r") throw new Error("carriage return escape");
  if (val[3] !== "\\") throw new Error("backslash escape");
  if (val[4] !== '"') throw new Error("quote escape");
  if (val[5] !== "\0") throw new Error("null escape");
});

Deno.test("wacLex: string with emoji (byte content preserved)", () => {
  const t = tok(`"hello 😀"`);
  if (t[0][0] !== "string") throw new Error("not a string");
  // emoji is 4 bytes but 1 JS char in the string
  if (!t[0][1].includes("😀")) throw new Error("emoji not in string");
});

// ── cast operators ────────────────────────────────────────────────────────────

Deno.test("wacLex: cast operators as!, as~, as@", () => {
  const t = tok("x as! i32 y as~ i64 z as@ i32");
  const casts = t.filter(([k]) => k === "as!" || k === "as~" || k === "as@");
  if (casts.length !== 3) throw new Error(`expected 3 cast ops, got ${casts.length}`);
  if (casts[0][0] !== "as!") throw new Error("as!");
  if (casts[1][0] !== "as~") throw new Error("as~");
  if (casts[2][0] !== "as@") throw new Error("as@");
});

Deno.test("wacLex: bare 'as' keyword (no suffix)", () => {
  const t = tok("x as i64");
  const as = t.find(([k]) => k === "as");
  if (!as) throw new Error("'as' keyword not found");
});

// ── operators ─────────────────────────────────────────────────────────────────

Deno.test("wacLex: arithmetic operators", () => {
  const t = tok("a + b - c * d / e % f");
  const ops = t.filter(([k]) => ["+", "-", "*", "/", "%"].includes(k as string)).map(([k]) => k);
  if (ops.join(" ") !== "+ - * / %") throw new Error("arithmetic ops: " + ops.join(" "));
});

Deno.test("wacLex: comparison operators", () => {
  const t = tok("== != < <= > >=");
  const ops = t.filter(([k, _]) => ["==", "!=", "<", "<=", ">", ">="].includes(k as string)).map(([k]) => k);
  if (ops.length !== 6) throw new Error("comparison ops count");
});

Deno.test("wacLex: logical operators", () => {
  const t = tok("a && b || !c");
  const ops = t.filter(([k]) => ["&&", "||", "!"].includes(k as string)).map(([k]) => k);
  if (ops.join(" ") !== "&& || !") throw new Error("logical ops: " + ops.join(" "));
});

Deno.test("wacLex: bitwise operators", () => {
  const t = tok("a & b | c ^ d ~ e << f >> g");
  const ops = t.filter(([k]) => ["&", "|", "^", "~", "<<", ">>"].includes(k as string)).map(([k]) => k);
  if (ops.join(" ") !== "& | ^ ~ << >>") throw new Error("bitwise ops: " + ops.join(" "));
});

Deno.test("wacLex: compound assignment operators", () => {
  const t = tok("+= -= *= /= %= &= |= ^= <<= >>=");
  const ops = t.filter(([k]) => k.endsWith("=") && k.length > 1 && k !== "==" && k !== "!=" && k !== "<=" && k !== ">=").map(([k]) => k);
  const expected = "+= -= *= /= %= &= |= ^= <<= >>=";
  if (ops.join(" ") !== expected) throw new Error("compound ops: " + ops.join(" "));
});

Deno.test("wacLex: increment and decrement", () => {
  const t = tok("a++ b--");
  const ops = t.filter(([k]) => k === "++" || k === "--").map(([k]) => k);
  if (ops.join(" ") !== "++ --") throw new Error("incr/decr: " + ops.join(" "));
});

// ── punctuation ───────────────────────────────────────────────────────────────

Deno.test("wacLex: all punctuation tokens", () => {
  const t = tok("( ) { } [ ] ; : , . ?");
  const puncts = t.filter(([k]) => ["(", ")", "{", "}", "[", "]", ";", ":", ",", ".", "?"].includes(k as string)).map(([k]) => k);
  if (puncts.length !== 11) throw new Error("punctuation count: " + puncts.length);
});

// ── line and column tracking ──────────────────────────────────────────────────

Deno.test("wacLex: line and column positions", () => {
  const { tokens } = wacLex("i32 x = 5;\ni64 y = 10;");
  // i32 is at line 1, col 1
  if (tokens[0].line !== 1 || tokens[0].col !== 1) throw new Error(`i32 at ${tokens[0].line}:${tokens[0].col}`);
  // i64 starts on line 2, col 1
  const i64tok = tokens.find((t) => t.text === "i64");
  if (!i64tok) throw new Error("i64 not found");
  if (i64tok.line !== 2 || i64tok.col !== 1) throw new Error(`i64 at ${i64tok.line}:${i64tok.col}`);
});

Deno.test("wacLex: column after multi-char token", () => {
  const { tokens } = wacLex("x == y");
  const eq = tokens.find((t) => t.kind === "==");
  if (!eq) throw new Error("== not found");
  if (eq.col !== 3) throw new Error(`== at col ${eq.col}, expected 3`);
  const y = tokens.find((t) => t.text === "y");
  if (!y) throw new Error("y not found");
  if (y.col !== 6) throw new Error(`y at col ${y.col}, expected 6`);
});

// ── comments ──────────────────────────────────────────────────────────────────

Deno.test("wacLex: line comments ignored", () => {
  const { tokens } = wacLex("a // this is a comment\nb");
  const nonEof = tokens.filter((t) => t.kind !== "eof");
  if (nonEof.length !== 2) throw new Error(`expected 2 tokens, got ${nonEof.length}`);
  if (nonEof[0].text !== "a") throw new Error("first token");
  if (nonEof[1].text !== "b") throw new Error("second token");
});

Deno.test("wacLex: block comments ignored", () => {
  const { tokens } = wacLex("a /* block\ncomment */ b");
  const nonEof = tokens.filter((t) => t.kind !== "eof");
  if (nonEof.length !== 2) throw new Error(`expected 2 tokens, got ${nonEof.length}`);
});

// ── eof ───────────────────────────────────────────────────────────────────────

Deno.test("wacLex: always ends with eof", () => {
  const { tokens } = wacLex("");
  if (tokens.length !== 1) throw new Error("expected exactly eof");
  if (tokens[0].kind !== "eof") throw new Error("last token should be eof");
});

Deno.test("wacLex: eof has correct kind", () => {
  const { tokens } = wacLex("i32 x = 5;");
  if (tokens[tokens.length - 1].kind !== "eof") throw new Error("last is not eof");
});

// ── error recovery ────────────────────────────────────────────────────────────

Deno.test("wacLex: unknown character produces error", () => {
  const { errors } = wacLex("`bad`");
  if (errors.length === 0) throw new Error("expected errors for backtick");
  if (!errors[0].message.includes("unexpected character")) throw new Error("wrong error: " + errors[0].message);
});

// ── real program tokenization ─────────────────────────────────────────────────

Deno.test("wacLex: gcd function tokenizes without errors", () => {
  const src = `export i32 gcd(i32 a, i32 b) {
  while (b != 0) {
    i32 t = b;
    b = a % b;
    a = t;
  }
  return a;
}`;
  const { errors } = wacLex(src);
  if (errors.length) throw new Error("errors in gcd: " + JSON.stringify(errors));
});

Deno.test("wacLex: struct with methods tokenizes without errors", () => {
  const src = `struct Counter {
  i32 count;
  const i32 id;
  Counter create(i32 id) { return Counter(0, id); }
  void inc(this) { this.count += 1; }
}`;
  const { errors } = wacLex(src);
  if (errors.length) throw new Error("errors in Counter: " + JSON.stringify(errors));
});

Deno.test("wacLex: import statement tokenizes correctly", () => {
  const { tokens, errors } = wacLex(`import { Point as P, midpoint } from "./geometry.wac";`);
  if (errors.length) throw new Error("errors: " + JSON.stringify(errors));
  const ks = tokens.map((t) => t.kind);
  if (!ks.includes("import")) throw new Error("import keyword missing");
  if (!ks.includes("from")) throw new Error("from keyword missing");
  if (!ks.includes("as")) throw new Error("as keyword missing");
  const str = tokens.find((t) => t.kind === "string");
  if (!str || str.text !== "./geometry.wac") throw new Error("string path wrong: " + str?.text);
});

Deno.test("wacLex: fn type syntax tokenizes correctly", () => {
  const { tokens, errors } = wacLex(`fn[i32(i32, i32)] cmp = ascending;`);
  if (errors.length) throw new Error("errors: " + JSON.stringify(errors));
  const ks = tokens.map((t) => t.kind);
  if (!ks.includes("fn")) throw new Error("fn keyword missing");
  if (!ks.includes("[")) throw new Error("[ missing");
  if (!ks.includes("]")) throw new Error("] missing");
});

Deno.test("wacLex: trailing whitespace after tokens (branch coverage)", () => {
  const { tokens } = wacLex("x  ");
  if (tokens[0].text !== "x") throw new Error("first token");
  if (tokens[1].kind !== "eof") throw new Error("should end with eof");
});

Deno.test("wacLex: bare @ character tokenizes", () => {
  const { tokens } = wacLex("@");
  if (tokens[0].kind !== "@") throw new Error("@ should be its own token");
});

Deno.test("wacLex: unknown escape sequence produces error", () => {
  const { errors } = wacLex(`"\\q"`);
  if (errors.length === 0) throw new Error("expected error for \\q");
  if (!errors[0].message.includes("unknown escape")) throw new Error("wrong error: " + errors[0].message);
});

Deno.test("wacLex: null unwrap operator ! vs != disambiguation", () => {
  const { tokens } = wacLex("q! q != null");
  const excl = tokens.filter((t) => t.kind === "!");
  const neq = tokens.filter((t) => t.kind === "!=");
  if (excl.length !== 1) throw new Error(`expected 1 '!', got ${excl.length}`);
  if (neq.length !== 1) throw new Error(`expected 1 '!=', got ${neq.length}`);
});
