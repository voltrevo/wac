# 0113 — `a < b || c > (d)` is unwritable: the generic-call form swallows an ordinary pair of comparisons

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-13
- **Kind:** design decision
- **Symptom:** compile error

## Reproduction

```wac
export i32 f(i32 n, i32 cap) {
  if (n < 0 || n > (cap + 1)) { return 1; }
  return 0;
}
```

**Both compilers refuse it**, which is what makes this a language question rather than a port defect:

    reference   expected type, found '0'  |  expected '>', found '0'
    wacc        [parse] expected a type — a type is a name like `i32`, `string`, or one this
                file declares  |  [parse] unexpected token

They are reading `n < 0 || n > (` as the start of a **generic call** — `name<Type, …>(args)`, which
is how `Vec<string>()` is spelled — and then complaining that `0` is not a type.

## The trigger is exact, and three near-misses compile

| spelling | compiles |
|---|---|
| `if (n < 0 \|\| n > (cap + 1))` | **no** |
| `if (n < 0 \|\| n > cap + 1)` | yes — no `(` after the `>` |
| `if (n > (cap + 1) \|\| n < 0)` | yes — the `>` `(` comes before the `<` |
| `if (n < 0) { … } if (n > (cap + 1)) { … }` | yes — two statements |

So the rule is: an identifier, a `<`, and later a `>` **immediately followed by `(`**, inside one
expression. Nothing else about the expression matters — the contents between them need not resemble
a type list, and the parser does not appear to check that they do before committing.

## Why it is worth a number rather than a shrug

It is not a corner. Bounds checks are written this way constantly — *is this length inside the
buffer* — and the parenthesis is exactly what a cast forces you to write:

```wac
if (n < (0 as i64) || (p as i64) + n > (b.len() as i64)) { … }
```

That line is from `packages/quic/src/frame.wac` and cost about twenty minutes to diagnose, because
the message points at a type and the mistake is a comparison. Every `i64` bound in this codebase is
spelled with parenthesised casts, so the more careful the arithmetic, the likelier the collision.

The failure is also **silent about its cause**. `expected a type` names the parser's hypothesis, not
the program: a reader looks for a missing type and there is none. It is the same shape as
[0110](0110-a-local-wacbind-accepts-what-the-suite-refuses.md) in that the diagnostic is locally
true and points away from the fix.

## What could fix it, and what it would cost

Three options, and the third is the one I would take.

1. **Require the type arguments to parse as types before committing.** `n < 0 || n > (…)` fails that
   test at `0` and falls back to comparisons. This is what C# does and it resolves this case
   completely. Cost: the parser needs speculative lookahead it may not have today, and the rule has
   to be written down in `spec/` because it is now part of the grammar rather than an implementation
   detail.
2. **Require an explicit marker on a generic call**, e.g. `f::<T>(x)`. Unambiguous, and Rust chose it
   for exactly this reason. Cost: it changes existing source, and `Vec<string>()` is the friendlier
   spelling — this trades a common pleasant form for a rare unpleasant one.
3. **Only treat `<` as type arguments when the name resolves to a generic.** Both compilers already
   know the declared generics by the time they parse a call, and a non-generic `n` cannot be one.
   Cheapest of the three, resolves every instance I can construct, and needs no source changes.

Whichever, **the grammar note belongs in `spec/`**: today the language's answer to "when is `<` a
comparison?" is whatever two parsers happen to agree on, and they agree by both being wrong the same
way. Two implementations cannot see a shared mistake — it took writing a new package in the language
to find this one.

## Until then

Name the bound. It reads better anyway:

```wac
i64 room = b.len() as i64;
if (n < (0 as i64) || (p as i64) + n > room) { … }
```

`packages/quic/src/frame.wac` does this in four places and says why at one of them.
