# 0020 — grammar.md is behind the implementation in four places

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** not implemented (the spec is wrong, not the compiler)

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
