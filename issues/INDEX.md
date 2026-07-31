# Open issues

Newest first. See `README.md` for how to file one and `closed/` for the record of what
has been fixed and why.

| # | summary | kind | symptom |
|---|---|---|---|
| [0038](open/0038-frombytes-accepts-invalid-utf8.md) | `string.fromBytes` accepts invalid UTF-8 | bug | wrong answer |
| [0037](open/0037-slice-clamps-silently-while-indexing-traps.md) | `slice` clamps silently while indexing traps | diagnostic | wrong answer |
| [0035](open/0035-wacx-is-specified-but-does-not-exist.md) | `wacx` is specified as the entry point but does not exist | missing feature | not implemented |
| [0021](open/0021-wacinstance-cannot-return-a-string.md) | `wacInstance` cannot return a `string` — three workarounds exist instead | bug | trap |
| [0033](open/0033-unchecked-integer-overflow.md) | no way to detect integer overflow | missing feature | wrong answer |
| [0034](open/0034-generics.md) | generics | missing feature | not implemented |
| [0031](open/0031-br-table-dispatch-for-match.md) | `match` dispatches through a comparison chain, not `br_table` | performance | not implemented |
| [0030](open/0030-payload-less-enum-as-integer.md) | a payload-less enum allocates instead of being an integer | performance | not implemented |
| [0029](open/0029-narrowing-outside-match.md) | `if (s is Circle)` does not narrow `s` | missing feature | compile error |
| [0028](open/0028-methods-on-enums.md) | an enum cannot have methods | missing feature | not implemented |
| [0027](open/0027-nested-patterns.md) | patterns are one level deep | missing feature | not implemented |
| [0026](open/0026-match-as-an-expression.md) | `match` is a statement, not an expression | missing feature | not implemented |
| [0025](open/0025-coverage-tool-covers-only-gzip.md) | the coverage tool measures gzip and nothing else | missing feature | wrong answer, no error |
| [0018](open/0018-accept-exponent-without-point.md) | should `1e9` be a float literal? (a decision, not a defect) | missing feature | compile error |

## Closed

38 issues, 24 closed.

Most of the closed ones came from porting `wacc`'s AST to sum types and then probing shapes
that port does not reach. Twelve typechecked cleanly and then failed at instantiation or ran
wrong, which is why `README.md` asks you to run the thing rather than only compile it.

Three were found *by the fix for another one*: the enum no-default rule (0012) made the
sized-array form unusable and produced 0019, and 0019's own fix needed two AST walks updated
— the same omission as 0005. A change that touches the AST or adds a statement form should be
assumed to have missed a walk until checked.

0024 came from asking what the probe rounds had not covered: branch coverage is wac's own
tooling and had never been pointed at `match`, so arms were invisible to it and any coverage
number over a match was overstated.
