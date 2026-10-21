# 0396a — A `const` reference stored into a plain field, returned through a plain function, or read from a `const` field is writable

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-21
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
struct In { i32 v; } struct Box { In i; } struct C { const In i; }
In give(const In c) { return c; }
export i32 f() {
  const In c = In(1);
  Box b = Box(c); b.i.v = 5;                 // construction
  In m = give(c); m.v = 6;                   // a plain function
  C k = C(In(1)); k.i.v = 7;                 // a const field, written through
  return c.v;
}
```

Expected: each write refused (`§wac-const-no-launder-t584c4n`, `§wac-deep-const-j4fn2xq`).
Actual: accepted; `f` answers 6.

## Notes

Issue 0315a's 2026-10-03 note says construction and field assignment are already refused; they are not. Refusing
the construction route broke ~15 sites in the compiler's own command graph (std `Captured.of`, `Sys.run`,
platform, tls, zstd, `api.wac`, `check.wac`, `parse.wac`), so it is 0315a's decision: sweep `const` onto
fields, or make const part of the type. The ternary, array, tuple, reassignment and for-in routes were fixed
in 2a36c9d2c (cases 0678–0683).
