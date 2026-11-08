# What wac got in the way of, with reproductions

## A conditional returned where an optional is declared is not boxed

```wac
i64? g(i64 v, i64 w) { return v < w ? v : w; }
```

builds, and the module then fails to load: `type error in return[0] (expected (ref null …), got i64)`.
A plain `return v;` is boxed correctly; the conditional's value is not. **Worked around** in
`src/time/natural.wac` by returning through `some(i64)`, which assigns to an `i64?` local first.

## `x as string?` is refused by the emitter

"cast to an unsupported type". **Worked around** by assigning in an `if`.
