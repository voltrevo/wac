# Open issues

Newest first. See `README.md` for how to file one and `closed/` for the record of what
has been fixed and why.

| # | summary | kind | symptom |
|---|---|---|---|
| [0262c](open/0262c-the-per-function-decline-path-has-no-reachable-test.md) | `declined_test.wac` says "a function the emitter could not emit is **named**" and its fixture is a *checker* error now — `issues/lang/0170a` item 2 moved the subject. It still passes because `contains(said, "f")` is satisfied by the `f` in "of that kind". Every replacement construct is caught earlier; what is reachable is a cap, and a cap decline names no function | bug | a test measuring the wrong phase |
| [0253a](open/0253a-a-non-ascii-character-in-a-comment-breaks-the-self-host-fixpoint.md) | adding one non-ASCII character to a comment in any wacc source makes rung 5 fail — the reference and wacc stop agreeing about wacc; 600 ASCII characters in the same place do not, and `deno task seed`'s own fixpoint check does not catch it | bug | wrong answer — **does not reproduce as of 2026-08-25**: the trigger was applied verbatim, the seed rebuilt from it, the driver carries the character and stage A was recomputed, and rung 5 is green |
| [0243a](open/0243a-a-match-of-literals-was-accepted-in-any-slot-and-the-spec-answers-the-rest-twice.md) | the silent half is fixed — an all-literal `match` expression went in any slot at all, so `string s = match (e) { case A: 1, else: 2 };` built a module with the export missing while the identical `?:` was refused. What is left is which spec sentence governs a mixed integer/float arm pair: `enums.md` has literal arms taking the expected type, `control.md` has a float literal typing as `f64` regardless of context, and `enums.md` says the two constructs are one rule | decision | invalid wasm, now a question |
| [0241a](open/0241a-a-generic-methods-body-is-never-checked-under-substitution.md) | a generic method's body is only ever checked with its type parameters opaque, so a fault that exists only for a particular `T` — `v()` where `v` is the `i32` payload of `Opt<i32>` — is invisible: `wac check` answers "no diagnostics" and `wac build` refuses it, naming the method. The spec defers such a mistake *to instantiation*, and there is no instantiation-time pass | diagnostic | no error |
| [0235a](open/0235a-written-type-arguments-parse-as-a-comparison.md) | the silent half is fixed — a type name in value position was refused only for structs, so `x < i32`, `x < E` and `x < string` checked clean; what is left is that `found bool` is still the first of three lines | diagnostic | wrong answer |
| [0233a](open/0233a-a-shift-by-a-variable-is-typed-from-the-amount-not-the-slot.md) | `i64 x = 1 << count;` is refused by both compilers: a shift is typed from its left operand, which for a literal has no type, so the only type in reach is the amount's — the one the result is explicitly not supposed to follow | decision | compile error |
| [0171a](open/0171a-unwrapping-a-nullable-primitive-loses-the-function.md) | bindgen refuses a nullable primitive at the host boundary, so `export i32 read(i32? x)` — the accessor the spec prescribes — gets no glue; the emitter half is done | decision | no glue for a signature the spec shows |
| [0170a](open/0170a-wacc-swallows-what-it-cannot-check-instead-of-refusing-it.md) | the standing one, and items 1 and 2 are done: the 25 reasonless emitter bails name what they could not find, and `typeOfE(Binary)` no longer answers with one operand's type when the two disagree. What is left is item 3 — `""` as an ordinary value — and the in-process API's export-parity net; item 4 turned out to be done already. `writeValType` refuses a bare unresolved name now that 0173a is closed | decision | none — the four reproductions are refused |
| [0163](open/0163-one-file-under-two-keys-is-silent-in-the-reference-and-an-invalid-module-in-wacc.md) | refused now, naming both keys, instead of an invalid module the checker was silent about — what is left is D8 deciding whether refusing is right, with a recommendation that it is | decision | no error |
| [0157](open/0157-an-import-of-a-file-nobody-supplied-is-caught-by-the-emitter-not-the-checker.md) | the single-file half is fixed and the emitter's sentence **names the file** now; what is left is the checker reporting it at the import's token, for which the linker already has the key | diagnostic | no error |
| [0156](open/0156-the-specs-parse-messages-match-neither-compiler.md) | the spec quotes `expected ';'` as a parse message, wacc says `unexpected token` with it in the annotation, the reference says a third thing — and the differentials compare positions, not text | diagnostic | wrong answer |
| [0153](open/0153-a-build-cost-two-emits-and-five-front-ends-and-what-is-left.md) | a build cost two emits and five front ends; what is left after fixing that | performance | no error |
| [0151](open/0151-the-reference-refuses-an-identity-test-the-spec-allows.md) | the reference refuses an identity test the spec allows, so a sweep row cannot be closed | bug | compile error |
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

200 issues, 172 closed.

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
