# Open issues

Newest first. See `README.md` for how to file one and `closed/` for the record of what
has been fixed and why.

| # | summary | kind | symptom |
|---|---|---|---|
| [0023](open/0023-emitcall-direct-call-branch-is-unreachable.md) | `emitCall`'s direct-call branch is unreachable | bug | not implemented |
| [0021](open/0021-wacinstance-cannot-return-a-string.md) | `wacInstance` cannot return a `string` — three workarounds exist instead | bug | trap |
| [0033](open/0033-unchecked-integer-overflow.md) | no way to detect integer overflow | missing feature | wrong answer |
| [0032](open/0032-constants-of-aggregate-type.md) | constants of struct type are rejected | missing feature | compile error |
| [0024](open/0024-generics.md) | generics | missing feature | not implemented |
| [0031](open/0031-br-table-dispatch-for-match.md) | `match` dispatches through a comparison chain, not `br_table` | performance | not implemented |
| [0030](open/0030-payload-less-enum-as-integer.md) | a payload-less enum allocates instead of being an integer | performance | not implemented |
| [0029](open/0029-narrowing-outside-match.md) | `if (s is Circle)` does not narrow `s` | missing feature | compile error |
| [0028](open/0028-methods-on-enums.md) | an enum cannot have methods | missing feature | not implemented |
| [0027](open/0027-nested-patterns.md) | patterns are one level deep | missing feature | not implemented |
| [0026](open/0026-match-as-an-expression.md) | `match` is a statement, not an expression | missing feature | not implemented |
| [0025](open/0025-coverage-tool-covers-only-gzip.md) | the coverage tool measures gzip and nothing else | missing feature | wrong answer, no error |
| [0018](open/0018-accept-exponent-without-point.md) | should `1e9` be a float literal? (a decision, not a defect) | missing feature | compile error |

## Closed

20 issues, 18 of them found by porting wacc's AST to sum types and by probing shapes
that port does not reach. Twelve of the sixteen typechecked cleanly and failed at
instantiation or ran wrong — which is why `README.md` asks you to run the thing.
