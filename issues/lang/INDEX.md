# Open issues

Newest first. See `README.md` for how to file one and `closed/` for the record of what
has been fixed and why.

| # | summary | kind | symptom |
|---|---|---|---|
| [0152](open/0152-wacc-warns-that-a-downcast-out-of-anyref-always-traps-and-it-does-not.md) | wacc warns that a downcast out of `anyref` always traps, and it does not | diagnostic | wrong answer |
| [0151](open/0151-the-reference-refuses-an-identity-test-the-spec-allows.md) | the reference refuses an identity test the spec allows, so a sweep row cannot be closed | bug | compile error |
| [0146](open/0146-a-leading-brace-is-a-literal-here-and-an-error-in-javascript.md) | a leading `{2}` is a literal in `packages/regex` and an error in JavaScript | bug | wrong answer |
| [0144](open/0144-a-call-through-a-parent-typed-reference-runs-the-parents-method.md) | a call through a parent-typed reference runs the parent's method, and the spec does not say | missing feature | wrong answer |
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
| [0030](open/0030-payload-less-enum-as-integer.md) | a payload-less enum allocates instead of being an integer | performance | not implemented |
| [0027](open/0027-nested-patterns.md) | patterns are one level deep | missing feature | not implemented |

## Closed

152 issues, 135 closed.

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
