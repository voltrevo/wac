# 0019 — no way to build a dynamically-sized array of a type with no default

- **Status:** closed
- **Fixed in:** 6754023
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Symptom:** compile error
- **Covered by:** `§wac-arr-fill-7kqm3xz`

## Reproduction

```wac
enum E { A(i32 v), B }
E[] build(i32 n) {
  E[] out = E[n]();     // error: type 'E' has no default value for array construction
  return out;
}
```

Expected: some way to say "n elements, each this value".
Actual: none. `E[n]()` is refused (correctly — see issue 0012, an enum has no default),
`E[](a, b, c)` needs a compile-time element count, and there is no third form.

## Notes

Discovered by issue 0012 breaking `packages/wacc`'s own parser: every `XList.take()` did
`X[] out = X[this.n]();` and then filled it, and `Expr` contains an enum field so it has
no default. That allocate-then-fill pattern is the normal way to return a right-sized
array, and it is now unavailable for any type reachable from an enum.

`array.new` (`0xFB 0x06`) takes a value and a length and is exactly this; `wacEmitFunc`
already emits it for `string[n]()`, replicating the empty string. So the emission is a
line, and the whole question is syntax.

**`T[n](v)` is ambiguous** and cannot be used: `arr[i](5)` already means index a funcref
array and call it. `looksLikeConstructionOrCall` distinguishes construction from
indexing precisely by the parentheses being *empty*, so a fill argument would collide.

Named-argument syntax does not collide, because function calls reject it outright
("function calls cannot use named argument syntax"):

```wac
E[] out = E[n](fill: E.B);
```

That is the proposal. It reads as what it does and needs no new token.

Worth deciding at the same time whether `i32[n](fill: -1)` should be allowed for types
that *do* have a default — it is useful (`-1`-filled tables are common) and falling out
of the same rule is better than special-casing.


## Resolution

`T[n](fill: v)`, as proposed. One `array.new`, so the emission is three lines.

Two things it needed beyond the obvious. `looksLikeConstructionOrCall` distinguishes
construction from indexing by the parentheses being empty, so it had to learn the
`(fill:` shape too — otherwise `E[n](fill: x)` was not recognised as construction at all
and failed with a parse error about a `:`. And the fill expression is a subexpression, so
the resolver's annotation pass and array-type collection both had to walk it; missing that
gave "undefined function or struct 'P'" for a `P(1)` written inside a fill, which is the
same omission as issue 0005's match arms. There is a test for exactly that, using a type
reachable only through a fill expression.

`i32[n](fill: -1)` is allowed for types that do have a default, as the notes suggested —
it falls out of the same rule and a -1-filled table is worth having.
