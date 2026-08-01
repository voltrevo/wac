# Open issues

Newest first. See `README.md` for how to file one and `closed/` for the record of what
has been fixed and why.

| # | summary | kind | symptom |
|---|---|---|---|
| [0054](open/0054-a-callback-with-an-array-in-its-signature-calls-a-helper-bindgen-never-emits.md) | a callback with an array in its signature calls a helper bindgen never emits | bug | wrong answer |
| [0054](open/0054-hex-literal-sign-extends-into-64-bit.md) | a hex literal in [2^31, 2^32) sign-extends when the target is 64-bit | bug | wrong answer |
| [0053](open/0053-bindgen-could-offer-suspending-callbacks-jspi.md) | bindgen could offer suspending callbacks, and the engine already does | missing feature | not implemented |
| [0052](open/0052-deep-const-is-escapable-by-passing-the-reference.md) | deep const is escapable by passing the reference to a mutating function | bug | wrong answer |
| [0031](open/0031-br-table-dispatch-for-match.md) | `match` dispatches through a comparison chain, not `br_table` | performance | not implemented |
| [0030](open/0030-payload-less-enum-as-integer.md) | a payload-less enum allocates instead of being an integer | performance | not implemented |
| [0027](open/0027-nested-patterns.md) | patterns are one level deep | missing feature | not implemented |

## Closed

54 issues, 48 closed.

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

Generics (0034) closed with eight of its own, seven of them one family: **a name is unique only
within its file, and a monomorphised name is not in any file's scope at all**. Every one was a
lookup keyed on what the author wrote rather than on which declaration was meant. If you are
touching the resolver, assume a bare name is ambiguous until you have canonicalised it.
