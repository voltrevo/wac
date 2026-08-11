# 0079 — a sized array construction whose element type is a funcref does not parse

- **Status:** closed, 2026-08-11 by agent-b
- **Fixed in:** 4c534d4d
- **Claimed by:** agent-b, 2026-08-11
- **Reported by:** agent-b
- **Date:** 2026-08-08
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
export void f(fn[i32(i32)] a) { fn[i32(i32)][] v = fn[i32(i32)][2](fill: a); }
```

`wacParse` reports **7 errors** for this, and the type checker then reports
`1:52 type 'null' is not an array` — a message about a type nothing in the program mentions,
which is the tell that the parse went wrong rather than the program.

The unsized form parses and type-checks cleanly:

```wac
export void f(fn[i32(i32)] a) { fn[i32(i32)][] v = fn[i32(i32)][](a, a); }   // ok
export void f(fn[i32(i32)][] xs) { }                                        // ok
```

and so does the sized form for every other element type:

```wac
export void f(i32 a) { i32[] v = i32[2](fill: a); }                          // ok
struct P { i32 x; }
export void f(P a) { P[] v = P[2](fill: a); }                                // ok
```

So it is specifically **sized array construction with a funcref element type**. The
no-`fill` spelling `fn[i32(i32)][3]()` fails too, with 1 parse error rather than 7, so the
`fill:` argument is incidental — the size is what breaks it.

## Notes

Suspicion, not a diagnosis: the array-construction parser decides how many `[]` pairs are
element-type suffixes with the rule at `wacParse.ts` — *"`[]` followed by another `[` (not
followed by `)`) is an element type suffix"* — and `parseType` for `fn` has its own suffix
loop that consumes `[]` pairs directly. A funcref type ends in `]` before the array brackets
even begin, which no other element type does, and the two loops appear to disagree about who
owns which bracket.

## How it was found

By a generated differential sweep in `wac-mono`'s `packages/wacc` — the cell is
`fn[i32(i32)][2](fill: a)` from a family of programs that are well-formed by construction for
every type in the matrix. Every other type in that family passes, which is what made a
17-cell row with one hole obvious.

Filed rather than fixed because the fix is in the shared compiler's expression parser and
would want `wac`'s own suite run behind it; the reporter was working in `wac-mono` and is
not going to make that change in passing. The reproduction is one line and becomes a test
either way.

## Resolution

The suspicion in the notes was right about which two loops disagreed, and the ownership is simpler
than it looked. `parseType` consumes the brackets of `fn[R(P)]` and then keeps consuming `[]` pairs,
so by the time the expression parser sees the construction:

* `fn[R(P)][](a, b)` — it holds the **array** type, and the next token is `(`. Handled.
* `fn[R(P)][2](fill: v)` — the suffix loop stops at `[2`, so it holds the **funcref**, and the next
  token is `[`. Not handled, in either compiler.

So the sized spelling never reached the code that parses `T[N](fill: v)` for every other element
type. The tail of an array construction — from its opening `[` through both the sized and the fixed
forms — is a shared function in each parser now, and the `fn` arm calls it when a `[` follows the
type. The element is the type as parsed, which is the funcref for `fn[R(P)][2]` and the array for
`fn[R(P)][][2]`.

**`fn[R(P)][3]()` with no fill is still refused**, and the refusal is the language rather than this
bug: a sized array with no `fill:` asks each element for its default and there is no default
function. `fn[R(P)]?[3]()` works, as do `P[3]()` and `string[3]()` — the rule is about the element
type having a default, not about arrays. `spec/cases/0116` pins that boundary next to `0115`, which
runs the fixed one.

Both compilers had the same gap in the same shape, which is what a shared corpus is for: wacc's
parser is a port of this one, and the port carried the hole across.
