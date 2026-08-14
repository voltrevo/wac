# 0124 — `x as T ? a : b` cannot be parsed, because `T ?` reads as a nullable type

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-14
- **Kind:** bug
- **Symptom:** compile error

A cast whose type sits immediately before a ternary's `?` is unparseable. Three lines:

```wac
export i64 f(i64 t) {
  return t > 5 as i64 ? t : t;
}
```

```
error: expected ';', found 't'
  --> amb.wac:2:25
```

The type parser takes `i64 ?` as the nullable type `i64?`, so the ternary loses its `?` and the
rest of the line is unexpected. Parenthesising the cast — `t > (5 as i64) ? t : t` — compiles, so
the language can express it and only this spelling is lost.

**`is` does not have it.** `a is S ? 1 : 2` parses, which is worth stating because it makes the
fix's shape narrower than "types swallow `?`": whatever `is` does after its type is what `as`
should do.

## How it was found, which is the part worth keeping

Not by reading the grammar. `compiler/wapyRoundTrip.test.ts` went red on
`packages/webrtc/src/sctp.wac` — the first file in the repository to write a parenthesised cast
inside a ternary — with `unexpected '60000' after the expression`. The wapy printer had dropped the
parentheses the wac source carried, correctly by its own precedence ladder, and `wapyParse` rewrites
`X if C else Y` back to `C ? X : Y`, which puts the condition's last token against the `?`.

So a wac grammar wart surfaced as a wapy round-trip failure, two surfaces away from itself.

**The printer is fixed** (`endsInCast`, and a three-line fixture beside the corpus one), because a
red shared suite is worse than a wart. This issue is the wart, which is still there: a wac author
who writes `x as T ? a : b` directly gets `expected ';'` and no hint about the parentheses.

## What "done" would mean

1. `t > 5 as i64 ? t : t` parses, or is refused with a diagnostic that names the parentheses.
2. A spec case, since this is a grammar question rather than a checker one.
3. The printer's `endsInCast` can then go, and its fixture should stay — it would be the regression
   test for whichever way (1) is answered.

The oracle is the reference compiler, which refuses it today.
