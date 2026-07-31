# 0020 — grammar.md is behind the implementation in four places

- **Status:** closed
- **Fixed in:** this commit
- **Reported by:** agent-b
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** not implemented (the spec is wrong, not the compiler)
- **Covered by:** `§wac-grammar-keywords-3mfq7bx`

`spec/spec/grammar.md` is the formal grammar, and CONTRIBUTING says the spec is the
source of truth. Four productions no longer describe what the parser accepts. Each is
a one-line fix; they are grouped because they are the same drift, found while checking
whether generics could reuse the type syntax.

## Reproduction

Every snippet below compiles today and none of it is derivable from the grammar.

```wac
const i32 N = 3;                 // 1. top-level const is not in `program`
export u32 a(u32 x) { return x; } // 2. u32/u64 are not in `primitive_type`
export i32 b() { u8[] v = u8[1](); return v[0]; }   // 3. u8/u16 not in element_type
export i32 c() { i32[][] g = i32[][1](); g[0] = i32[](7); return g[0][0]; }
export i32 d(Point?[] ps) { return 0; }             // 3. nullable element type
```

1. **`program`** is `{ import | struct_decl | enum_decl | func_decl }`. Module-level
   constants are missing entirely, though `spec/spec/variables.md` documents them.

2. **`primitive_type`** is `"i32" | "i64" | "f32" | "f64" | "bool" | "void"`. `u32`
   and `u64` are missing.

3. **`element_type`** is `primitive_type | "i8" | "i16" | "string" | IDENT |
   funcref_type`. Missing `u8` and `u16`; missing `array_type`, though nested arrays
   work and `arrays.md` documents them; and missing nullable, though `Point?[]` works
   and `arrays.md` documents that too.

4. **The keyword list is wrong in a way that matters.** It lists `bool f32 f64 i8 i16
   i32 i64 string` among "Keywords", but the lexer's `KEYWORDS` set contains none of
   them — they lex as identifiers. That is not an accident: it is exactly what makes
   `f64.toBits(x)`, `f32.fromBits(b)` and `string.fromBytes(b)` parse, since each is
   an ordinary `IDENT . IDENT ( args )` static call. A reader who believed the grammar
   would conclude those cannot exist, and anyone adding a builtin static on a type
   would look for parser support that is not needed.

Expected: the grammar describes the accepted language.
Actual: it describes an earlier one, and in case 4 contradicts a deliberate design
choice.

## Notes

Third time this drift has surfaced. `export const struct` (issue closed earlier) and
`char_content` were both missing from the grammar while the parser handled or was
meant to handle them, and both were found by someone writing wac rather than by
reading the spec.

Worth considering a check that keeps them together — even a test asserting the
`KEYWORDS` set matches the grammar's keyword block would have caught case 4, which is
the one with a real consequence.


## Resolution

All four corrected, and every snippet in the report is now verified to compile — the
grammar describing the accepted language is the whole claim, so it is worth checking
rather than asserting.

1. `program` gains `const_decl`, and the production itself, which was referenced nowhere
   and defined nowhere.
2. `primitive_type` gains `u32` and `u64`.
3. `element_type` is now `type | "i8" | "i16" | "u8" | "u16"` — any type at all, plus the
   packed types, which exist only as elements. Listing the cases separately is what let
   nested arrays and nullable elements go missing, so the general form is less likely to
   drift again.
4. The keyword list drops the eight type names and gains `from` and `this`, with a
   paragraph saying *why* the type names are identifiers — the reasoning is the part
   worth keeping, since a future reader would otherwise "fix" it back.

`param` also gained its optional `const`, which landed in issue 0004 and was missing here
too — a fifth instance of the same drift, found only because the report prompted a read of
the whole file.

## The check

Taking up the suggestion: `§wac-grammar-keywords-3mfq7bx` reads the Keywords block out of
`grammar.md` and the `KEYWORDS` set out of `wacLex.ts` and asserts they match in both
directions, naming what is missing on each side. Verified by deleting `from` from the
grammar and watching it report exactly that.

A second test compiles `f64.toBits`, `f32.fromBits` and `string.fromBytes`, which is the
consequence case 4 had inverted — those parse only because the type name is an identifier,
so if anyone makes them keywords the builtins stop working and this says so.

The remaining productions are still prose checked by hand. A parser-level conformance
check against the whole EBNF would be the real fix and is a much larger job; the keyword
block was singled out because it was the case with a behavioural consequence.
