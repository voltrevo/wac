// wapy's diagnostics, on wapy that is wrong.
//
// This is the test the round trip cannot be. `wapyRoundTrip.test.ts` only ever feeds the
// frontend output from the printer, which is valid by construction, so it proves the two
// surfaces agree and proves nothing at all about what happens when a person makes a mistake.
// Every case here is malformed on purpose.
//
// It is also the test that failed against the frontend this one replaced. That version
// rewrote wapy tokens into wac's shape and let `wacParse` sort them out, which round-tripped
// 155 of 155 files and, on wrong input, said things like `expected function name` at the
// column of a function name that was right there, or accepted `class P` with no colon. What
// each case asserts is that the diagnostic is about wapy: its line, its column, its grammar.

import { wapyParse } from "./wapyParse.ts";

function errs(src: string): { line: number; col: number; message: string }[] {
  return wapyParse(src, "t.wapy").errors;
}

/** The first diagnostic, as `line:col message`, or `""` if the source was accepted. */
function first(src: string): string {
  const e = errs(src)[0];
  return e ? `${e.line}:${e.col} ${e.message}` : "";
}

function reports(name: string, src: string, want: string): void {
  Deno.test(`wapyParse: ${name}`, () => {
    const got = first(src);
    if (got !== want) throw new Error(`\n  source: ${JSON.stringify(src)}\n  got:  ${got || "(accepted)"}\n  want: ${want}`);
  });
}

function accepts(name: string, src: string): void {
  Deno.test(`wapyParse: ${name}`, () => {
    const e = errs(src);
    if (e.length) throw new Error(`unexpected ${e[0].line}:${e[0].col} ${e[0].message}`);
  });
}

// ── The four the previous frontend got wrong ────────────────────────────────

reports("a def with no return type", "def f(x: i32) ->\n    return x", "1:15 expected ':' after a def");
reports("a parameter with no colon", "def f(x i32) -> i32:\n    return x",
        "1:7 a parameter is written `name: Type`");
reports("a class header with no colon", "class P\n    x: f64", "1:7 expected ':' after a class header");
reports("an if with no colon", "def f() -> i32:\n    if x > 1\n        return 2",
        "2:12 expected ':' after an `if`");

// ── Structure ───────────────────────────────────────────────────────────────

reports("a def with no body", "def f() -> i32:", "1:1 a def has no indented body");
reports("a tab in the indentation", "def f() -> i32:\n\treturn 1", "2:1 a tab in the indentation");
reports("an unknown decorator", "@exprot\ndef f() -> i32:\n    return 1",
        "1:1 unknown decorator — expected one of @export, @const, @override");
reports("a decorator modifying nothing", "def f() -> i32:\n    return 1\n@export",
        "3:1 @export does not modify anything");
reports("a duplicate decorator", "@export\n@export\ndef f() -> i32:\n    return 1",
        "2:2 duplicate @export");
reports("elif with no if", "def f() -> i32:\n    elif x:\n        return 1",
        "2:5 `elif` without a matching `if`");
reports("elif after else", "def f() -> i32:\n    if x:\n        return 1\n    else:\n        return 2\n    elif y:\n        return 3",
        "6:5 `elif` after an `else`");
reports("do with no while", "def f() -> i32:\n    do:\n        pass\n    return 1",
        "2:5 a `do:` block must be followed by `while <condition>`");
reports("a statement at the top level", "return 1",
        "1:1 expected a declaration, found 'return'");

// ── Declarations ────────────────────────────────────────────────────────────

reports("a variable with no initialiser", "def f() -> i32:\n    y: i32\n    return y",
        "2:8 a declaration needs an initialiser");
reports("a const with no type", "const N = 10", "1:7 a constant is written `const NAME: Type = value`");
reports("a const with a body", "const N: i32 = 10\n    x: i32 = 1",
        "1:1 a constant takes no indented body");
reports("a receiver annotated with another type", "class P:\n    x: f64\n    def get(self: Q) -> f64:\n        return self.x",
        "3:19 `self` in P is a P, not 'Q'");
reports("an import with no path", "from lib import f", "1:6 expected a quoted path after `from`");
reports("an import with no names", `from "./lib.wac" import`,
        "1:18 expected at least one name to import");
reports("pass mixed with real members", "class P:\n    pass\n    x: f64",
        "2:5 `pass` is the whole body or none of it");

// ── Expressions, where the shared grammar is delegated to ───────────────────

reports("junk after an expression", "def f() -> i32:\n    return 1 2", "2:14 unexpected '2' after the expression");
reports("an initialiser with nothing after the `=`", "def f() -> i32:\n    x: i32 = \n    return x",
        "2:12 expected an expression");
reports("a wac spelling", "def f() -> bool:\n    return true", "2:12 wapy spells this `True`");
reports("a wac receiver spelling", "class P:\n    x: f64\n    def get(this: P) -> f64:\n        return this.x",
        "3:13 wapy spells this `self`");
// Delegated, so the wording is the shared grammar's — but the position is wapy's, which is
// the property that matters. wapy has no line continuation, so an expression is one line and
// an unclosed bracket is always reported at the end of it.
reports("an unclosed bracket", "def f() -> i32:\n    return (1 + 2", "2:18 expected ')', found ''");

// ── Accepted, so the cases above are failing for the reason claimed ─────────

accepts("a function", "@export\ndef f(x: i32) -> i32:\n    return x + 1\n");
accepts("a class with a method", "class P:\n    x: f64\n    def get(self: P) -> f64:\n        return self.x\n");
accepts("a bare receiver", "class P:\n    x: f64\n    def get(const self) -> f64:\n        return self.x\n");
accepts("an if chain", "def f(x: i32) -> i32:\n    if x > 1:\n        return 1\n    elif x > 2:\n        return 2\n    else:\n        return 3\n");
accepts("a do-while", "def f() -> void:\n    do:\n        break\n    while False\n");
accepts("a conditional, bare and parenthesised", `def f(c: bool) -> i32:\n    return 0 if c else 1\n`);
accepts("a conditional in redundant parentheses", `def f(c: bool) -> i32:\n    return (0 if c else 1)\n`);
accepts("a string that spells a keyword", `def f(w: string) -> bool:\n    return w == "if" or w == "else"\n`);
accepts("None as a variant name", "class Opt(enum):\n    Some(v: i32)\n    None\n");
accepts("an empty class", "class Empty:\n    pass\n");
