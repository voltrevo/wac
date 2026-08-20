# Open issues

Newest first. See `README.md` for how to file one and `closed/` for the record of what
has been fixed and why.

| # | summary | kind | symptom |
|---|---|---|---|
| [0172a](open/0172a-three-spec-behaviours-wacc-declines-with-reproductions.md) | a generic struct with a base, an enum method naming a type late, and `is` against a non-ancestor — four minimised reproductions | missing feature | check clean, build names the function |
| [0171a](open/0171a-unwrapping-a-nullable-primitive-loses-the-function.md) | a nullable primitive is unimplemented in the emitter — an `i32?` parameter that is never read makes a module the engine refuses | missing feature | invalid wasm |
| [0170a](open/0170a-wacc-swallows-what-it-cannot-check-instead-of-refusing-it.md) | wacc refuses 10 of 14 ill-typed programs the reference refuses all of; in each of the 4 it accepts, the build exits 0 and the exported function is absent | bug | no error |
| [0164a](open/0164a-wacc-never-compares-array-types-so-any-array-satisfies-any-slot.md) | any array value satisfies any slot in wacc — argument, assignment, return or field, including a slot that is not an array — so the checker is silent and the engine rejects the module | bug | invalid wasm |
| [0163](open/0163-one-file-under-two-keys-is-silent-in-the-reference-and-an-invalid-module-in-wacc.md) | one file reached under two keys: the reference reads it twice and runs, wacc's checker stays clean and the engine rejects the module — neither is what D8 says the failure looks like | bug | invalid wasm |
| [0162b](open/0162b-a-struct-named-like-one-in-platform-wac-makes-the-program-unrunnable.md) | a program declaring `struct Stat` — or `Change`, `Exec`, `Read`, any name `platform.wac` uses — compiles cleanly and will not start: the linker qualifies the platform one, `Cli.stat`'s funcref signature carries the qualified spelling, no dispatcher is emitted under it, and the host says "the manifest describes no Cli" when it describes one | bug | wrong answer |
| [0161](open/0161-an-aliased-import-of-an-already-imported-type-is-a-different-type-in-wacc.md) | `import { E as E2 }` beside `import { E }` makes two nominal types out of one declaration, so passing one where the other is wanted is a mismatch — wacc only, the reference accepts it | bug | compile error |
| [0160](open/0160-a-lambda-capturing-a-parameter-loses-it-to-a-top-level-function-of-the-same-name.md) | a lambda's captured parameter resolves to a same-named top-level function instead — so any file importing `platform.wac` and declaring `f` builds an invalid module | bug | invalid wasm |
| [0158](open/0158-the-checker-is-superlinear-in-one-files-import-count.md) | one file importing 600 others type-checks in 19.7s where the emitter takes 86ms — the cost is import edges in a single file, not files (1200 files with 10 imports: 8ms) | performance | no error |
| [0157](open/0157-an-import-of-a-file-nobody-supplied-is-caught-by-the-emitter-not-the-checker.md) | importing a file nobody supplied is refused by the emitter with no position and no name, and the checker — even given the whole file map — reports nothing | diagnostic | no error |
| [0156](open/0156-the-specs-parse-messages-match-neither-compiler.md) | the spec quotes `expected ';'` as a parse message, wacc says `unexpected token` with it in the annotation, the reference says a third thing — and the differentials compare positions, not text | diagnostic | wrong answer |
| [0155](open/0155-a-build-that-emitted-no-code-reports-success.md) | a build whose emit produced no code writes a manifest-only module and exits 0 | diagnostic | no error |
| [0154](open/0154-an-exported-struct-name-that-collides-in-a-link-breaks-other-modules-exports.md) | an exported struct name that collides in a link produces a module whose manifest lists exports it does not have, and *other* files fail | bug | invalid wasm |
| [0153](open/0153-a-build-cost-two-emits-and-five-front-ends-and-what-is-left.md) | a build cost two emits and five front ends; what is left after fixing that | performance | no error |
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

173 issues, 142 closed.

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
