# Open issues

Newest first. See `README.md` for how to file one and `closed/` for the record of what
has been fixed and why.

| # | summary | kind | symptom |
|---|---|---|---|
| [0098](open/0098-a-mutant-gets-a-spurious-no-such-field-next-to-the-real-error.md) | a spurious `no such field` appears beside the real error, and `corpusMutate` is red | diagnostic | wrong answer |
| [0097](open/0097-a-linked-git-repo-emits-an-invalid-module.md) | a type named the same as one in `core` retypes every use of the `core` one | bug | invalid wasm |
| [0090](open/0090-linked-emission-drops-exported-functions-without-saying-so.md) | linked emission drops exported functions without saying so | bug | not implemented |
| [0089](open/0089-wacc-emits-no-transfer-buffer-so-nothing-can-bind-to-it.md) | wacc emits no transfer buffer, so nothing that passes bytes can bind to it | missing feature | not implemented |
| [0088](open/0088-a-generic-enum-variant-cannot-name-its-type-arguments.md) | a generic enum's variant cannot name its type arguments, and a generic struct can | missing feature | compile error |
| [0087](open/0087-break-after-an-infinite-loop-crashes-the-compiler.md) | `break` after an infinite loop crashes the compiler with an uncaught TypeError | bug | compile error |
| [0086](open/0086-a-template-instance-named-only-by-a-generic-functions-return-type-has-no-methods.md) | a template instance named only by a generic function's return type has no methods | bug | compile error |
| [0085](open/0085-as-i31ref-truncates-where-the-spec-says-it-traps.md) | `as! i31ref` truncates where the spec says it is checked | bug | wrong answer |
| [0084](open/0084-increment-as-a-value-on-a-packed-array-element.md) | `++` as a *value* on a packed array element emits `array.get`, so the module is invalid | bug | invalid wasm |
| [0083](open/0083-a-parent-declared-after-its-child-emits-an-invalid-supertype.md) | a struct whose parent is declared after it emits an invalid supertype | bug | invalid wasm |
| [0081](open/0081-bindgen-does-not-resolve-an-imported-type-alias-in-an-exported-signature.md) | bindgen does not resolve an imported type alias in an exported signature — [gh#10](https://github.com/voltrevo/wac/issues/10) | bug | compile error |
| [0080](open/0080-bind-helper-exports-collide-for-same-named-structs-in-different-modules.md) | bind helper exports collide for same-named structs in different modules — [gh#9](https://github.com/voltrevo/wac/issues/9) | bug | invalid wasm |
| [0082](open/0082-increment-of-an-i64-field-or-element-emits-an-i32-one.md) | `++` on an `i64` field or element emits an `i32` one, so the module is invalid | bug | invalid wasm |
| [0079](open/0079-a-sized-array-of-funcrefs-does-not-parse.md) | a sized array construction whose element type is a funcref does not parse | bug | compile error |
| [0078](open/0078-as-raw-computes-where-it-claims-to-reinterpret.md) | `as@` computes where it claims to reinterpret — **wants an operator decision** | missing feature | not implemented |
| [0077](open/0077-a-wac-local-named-self-has-no-wapy-rendering.md) | a wac local named `self` has no wapy rendering | bug | compile error |
| [0075](open/0075-the-website-undersells-determinism-and-virtual-time.md) | the website undersells determinism and virtual time — **wants an operator decision** | missing feature | not implemented |
| [0074](open/0074-values-with-no-identity-tuples-or-value-structs.md) | values with no identity: tuples, or value structs | missing feature | not implemented |
| [0073](open/0073-named-re-export-so-a-library-can-have-one-entry-point.md) | named re-export, so a library can have one entry point | missing feature | not implemented |
| [0071](open/0071-no-addressable-scratch-a-stack-storage-class.md) | no addressable scratch: a `stack` storage class | missing feature | not implemented |
| [0070](open/0070-no-simd-a-v128-primitive-and-its-intrinsics.md) | no SIMD: a `v128` primitive and its intrinsics | missing feature | not implemented |
| [0069](open/0069-ten-mvp-integer-instructions-are-unreachable-from-wac.md) | ten MVP integer instructions are unreachable: clz, ctz, popcnt, rotl, rotr | missing feature | not implemented |
| [0061](open/0061-enum-variants-should-be-qualified-rather-than-file-scope-names.md) | enum variants should be qualified rather than file-scope names | missing feature | compile error |
| [0059](open/0059-cttrace-buffer-is-a-fixed-2-22-events-so-an-expensive-routine-cannot-be-traced.md) | ctTrace's buffer is a fixed 2^22 events, so an expensive routine cannot be traced at all | missing feature | not implemented |
| [0060](open/0060-a-value-returned-from-a-const-this-method-stays-const.md) | a value returned from a `const this` method stays const, so the caller cannot mutate it | bug | compile error |
| [0053](open/0053-bindgen-could-offer-suspending-callbacks-jspi.md) | bindgen could offer suspending callbacks, and the engine already does | missing feature | not implemented |
| [0052](open/0052-deep-const-is-escapable-by-passing-the-reference.md) | deep const is escapable by passing the reference to a mutating function | bug | wrong answer |
| [0031](open/0031-br-table-dispatch-for-match.md) | `match` dispatches through a comparison chain, not `br_table` | performance | not implemented |
| [0030](open/0030-payload-less-enum-as-integer.md) | a payload-less enum allocates instead of being an integer | performance | not implemented |
| [0027](open/0027-nested-patterns.md) | patterns are one level deep | missing feature | not implemented |

## Closed

98 issues, 68 closed.

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
