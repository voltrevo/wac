# 0017 — an exponent without a decimal point lexed as an identifier

- **Status:** closed
- **Fixed in:** 2683771
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** diagnostic
- **Symptom:** compile error
- **Covered by:** `§wac-float-no-point-5rtk9bq`

## Reproduction

```wac
export f64 f() { return 1e40; }
```

Expected: an error naming the problem.
Actual: `expected ';', found 'e40'` — several tokens away, naming neither the cause nor
the fix.

## Notes

`FLOAT_LITERAL` in grammar.md requires the decimal point, so `1e40` is genuinely not a
float literal and the lexer was right to refuse it. The defect was that it refused it by
lexing `1` as an integer and `e40` as an *identifier*, leaving the parser to fail on
whatever came next.

No valid wac puts an identifier immediately after an integer, so an adjacent one is
always this mistake; a space between them (`1 * e40`) is someone writing two things and
is unaffected.

Found while testing the f32 range check for issue 0001 — `1e40` was the out-of-range
literal I reached for, and it did not lex.
