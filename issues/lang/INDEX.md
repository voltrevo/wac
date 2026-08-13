# Open issues

Newest first. See `README.md` for how to file one and `closed/` for the record of what
has been fixed and why.

| # | summary | kind | symptom |
|---|---|---|---|
| [0114](open/0114-wacc-blames-the-argument-count-when-a-struct-shares-a-name-with-a-variant.md) | a struct sharing a name with an enum variant: the reference says "duplicate name", wacc says the argument count is wrong | diagnostic | wrong answer |
| [0113](open/0113-a-comparison-cannot-be-followed-by-a-parenthesis.md) | `a < b \|\| c > (d)` is unwritable: the generic-call form swallows an ordinary pair of comparisons | design decision | compile error |
| [0112](open/0112-waccs-coverage-instrumentation-omits-match-arms-and-ternaries.md) | wacc's coverage instrumentation emits no `case` and no ternary points, and every `cov.ts` merges coverage by line alone, so switching measures 439 fewer decisions and reports fourteen live entries as stale | missing feature | wrong answer |
| [0111](open/0111-the-reference-compiler-lacks-the-bit-methods-wacc-has.md) | the reference compiler lacks the five bit methods `wacc` has, so `packages/zstd` builds under one and not the other | missing feature | compile error |
| [0110](open/0110-a-local-wacbind-accepts-what-the-suite-refuses.md) | a local `wacBind` accepts two things the suite refuses, so local verification is weaker than it looks | diagnostic | compile error |
| [0109](open/0109-sixteen-callback-slots-per-signature-is-not-far-past-what-an-api-asks-for.md) | sixteen callback slots per signature is not "far past what a callback-taking API asks for" | missing feature | trap |
| [0107](open/0107-wacc-emits-a-larger-module-than-the-reference.md) | wacc emits a larger module than the reference — `box` 820 KB against 991 KB — and is now the default | performance | no error |
| [0105](open/0105-callers-still-compiling-with-the-reference.md) | 25 callers still compile with the reference; the two bundlers are what stops the `wac` binary rebuilding its own seed | task | not implemented |
| [0088](open/0088-a-generic-enum-variant-cannot-name-its-type-arguments.md) | a generic enum's variant cannot name its type arguments, and a generic struct can | missing feature | compile error |
| [0078](open/0078-as-raw-computes-where-it-claims-to-reinterpret.md) | `as@` computes where it claims to reinterpret — **wants an operator decision** | missing feature | not implemented |
| [0077](open/0077-a-wac-local-named-self-has-no-wapy-rendering.md) | a wac local named `self` has no wapy rendering | bug | compile error |
| [0075](open/0075-the-website-undersells-determinism-and-virtual-time.md) | the website undersells determinism and virtual time — **wants an operator decision** | missing feature | not implemented |
| [0074](open/0074-values-with-no-identity-tuples-or-value-structs.md) | values with no identity: tuples, or value structs | missing feature | not implemented |
| [0073](open/0073-named-re-export-so-a-library-can-have-one-entry-point.md) | named re-export, so a library can have one entry point | missing feature | not implemented |
| [0071](open/0071-no-addressable-scratch-a-stack-storage-class.md) | no addressable scratch: a `stack` storage class | missing feature | not implemented |
| [0070](open/0070-no-simd-a-v128-primitive-and-its-intrinsics.md) | no SIMD: a `v128` primitive and its intrinsics | missing feature | not implemented |
| [0061](open/0061-enum-variants-should-be-qualified-rather-than-file-scope-names.md) | enum variants should be qualified rather than file-scope names | missing feature | compile error |
| [0053](open/0053-bindgen-could-offer-suspending-callbacks-jspi.md) | bindgen could offer suspending callbacks, and the engine already does | missing feature | not implemented |
| [0052](open/0052-deep-const-is-escapable-by-passing-the-reference.md) | deep const is escapable by passing the reference to a mutating function | bug | wrong answer |
| [0031](open/0031-br-table-dispatch-for-match.md) | `match` dispatches through a comparison chain, not `br_table` | performance | not implemented |
| [0030](open/0030-payload-less-enum-as-integer.md) | a payload-less enum allocates instead of being an integer | performance | not implemented |
| [0027](open/0027-nested-patterns.md) | patterns are one level deep | missing feature | not implemented |

## Closed

114 issues, 92 closed.

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
