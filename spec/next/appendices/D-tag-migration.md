# D — Tag migration

What became of each tag in the current specification (`spec/spec`, `spec/cli`) that this one does not carry.

A tag from the current specification that appears in a chapter here keeps its meaning: the rule did not change. A tag
listed below was **replaced** — the rule changed and the new tag states the new rule — or **retired** — nothing here
states a rule in its place, for the reason given. A test claiming a retired tag tests behaviour this specification does
not have.

## Replaced

| Old tag | New tag | What changed |
|---|---|---|
| `§wac-import-mapped-6np2rkq` | `§wac-package-key-exact-rme93fh` | a dependency key is a whole package name; prefix mappings are gone ([04](../1-programs/04-packages.md)) |
| `§wac-import-undefined-h4mq9xk` | `§wac-specifier-kinds-sgmw8y4` | the same refusal, restated over three kinds of specifier instead of four ([02](../1-programs/02-modules-and-imports.md)) |
| `§wac-nonnull-isnull-warn-2mkq7np` | `§wac-nonnull-isnull-may-warn-udv9kfr` | a decided null test *may* warn; no warning is mandatory ([10](../2-types/10-nullability.md)) |
| `§wac-struct-default-ar2wgyf` | `§wac-field-initialiser-default-28c4ffw` | a field's default is its initialiser, and a field without one has none ([12](../2-types/12-structs.md)) |
| `§wac-recursive-nodefault-1os4yl4` | `§wac-uninhabited-valid-2f9cxmt` | a type no value can inhabit is valid; it cannot be defaulted ([11](../2-types/11-never-and-uninhabited.md)) |
| `§wac-override-k7fn3qp` | `§wac-override-virtual-8bj3d46` | `override` replaces only a method the parent marked `virtual` ([12](../2-types/12-structs.md)) |
| `§wac-override-missing-m4jw2rk` | `§wac-override-required-fgt5fkj` | the same requirement, against a `virtual` parent method |
| `§wac-static-disp-x4rk7m2` | `§wac-virtual-dispatch-a4xhpib` | a `virtual` method dispatches on the runtime type; a non-`virtual` one is final ([12](../2-types/12-structs.md)) |
| `§wac-override-dispatch-r2km6jf` | `§wac-virtual-dispatch-a4xhpib` | as above |
| `§wac-arr-default-uwpc1ls` | `§wac-arr-defaulted-needs-default-8kbgqzf` | a sized array is `T[].defaulted(n)` or `T[].filled(n, v)` ([15](../2-types/15-arrays.md)) |
| `§wac-arr-i8-lit-trunc-i9g6kol`, `§wac-arr-i16-lit-kyrurqi`, `§wac-arr-i8-trunc-r2km9jf` | `§wac-packed-no-coercion-udspvhv` | a packed element is an ordinary value of its type; nothing truncates into it implicitly ([08](../2-types/08-primitives.md)) |
| `§wac-arr-i8-lit-badtype-3w7g6aa` | `§wac-arr-packed-cast-nfe1ha9` | as above ([15](../2-types/15-arrays.md)) |
| `§wac-uninit-nypziz8` | `§wac-local-unassigned-txsix97` | a local may be declared without an initialiser and must be assigned before it is read ([08](../2-types/08-primitives.md)) |
| `§wac-arith-ref-3jd8qkr` | `§wac-operator-dispatch-left-txsqbyi` | arithmetic on a reference dispatches to the left operand's operator symbol ([22](../3-expressions/22-operators.md)) |
| `§jsx-component-renders` | `§wac-markup-tag-is-function-vv4pvhq` | a markup tag calls a function; there are no components with a `render` method ([23](../3-expressions/23-interpolation-and-markup.md)) |
| `§wac-modconst-notconst-r4jn9kq` | `§wac-static-call-66kaqx5` | a module-level `static` initialiser may call functions, run by static evaluation ([27](../4-static/27-static-declarations.md)) |
| `§wac-modconst-sized-5wnq8kt` | `§wac-static-eval-ordinary-ba8c628` | a static initialiser is ordinary code; no special case for sized arrays ([28](../4-static/28-static-evaluation.md)) |
| `§wac-async-drain-7cvj4bn` | `§wac-drain-cs2v9rf` | continuations are run by `drain`, on the scheduler a ticket names ([35](../6-concurrency/35-tickets-and-await.md)) |
| `§wac-async-unwaitable-4hpx2vn` | `§wac-wait-refuses-jj8u2ie` | waiting on a ticket nothing can advance answers `Err` instead of trapping |
| `§wac-grammar-keywords-h4mq7wn` | `§wac-keywords-reserved-w9tpxmx` | the rule is now that the words are reserved, not that a list matches the lexer ([A](A-grammar.md)) |
| `§wac-diag-assign-j3qm7xf` | `§wac-diag-literal-fraction-33zp6u3` | a literal has no type of its own, so the diagnostic is about the literal, not about an `f64` ([B](B-diagnostics.md)) |

## Retired

| Old tag | Why |
|---|---|
| `§wac-std-no-root-2vp6xmk` | `std` has a root, which exports `Sys` ([44](../7-library/44-std.md)) |
| `§wac-std-imports-core-7hn3qrz` | constrained how the toolchain carries `core` and `std`, not what a program may write |
| `§wac-packed-nullable-2knq6wv` | a packed type is an ordinary type: `u8?` is valid ([08](../2-types/08-primitives.md)) |
| `§wac-cast-packed-v7nq4mj` | likewise: a packed value can be cast |
| `§wac-arr-i8-nolocal-p7hd5wn`, `§wac-arr-i8-noparam-w5hd3jk`, `§wac-arr-i8-noreturn-k7fn2qp` | likewise: a packed type may be a local, a parameter or a result |
| `§wac-hex-width-3nkq7wm`, `§wac-hexlit-i32-47spr0b`, `§wac-hexlit-ones-9bg3jtx`, `§wac-hexlit-sign-8wckct3`, `§wac-hexlit-pad-9qw60ul` | suspended: whether a hex literal is a bit pattern or a value is open ([09](../2-types/09-numeric-literals.md)). Whichever is decided gets new tags |
| `§wac-async-nosuspend-6pv2wkn` | described a limit of the implementation, not of the language |
| `§wac-ll-push-front-k4mf2js`, `§wac-ll-push-back-p9qn3xl`, `§wac-ll-len-w7rk5bt`, `§wac-ll-len-empty-m3hd8qz`, `§wac-ll-sum-j2fn9rk`, `§wac-ll-pop-front-h8wd2pm`, `§wac-ll-pop-all-f4kp7wn`, `§wac-ll-pop-empty-n2qm8xl`, `§wac-ll-reverse-c7jw3kf`, `§wac-ll-front-back-q8kn2wp` | the linked list was an example program, not part of the language or of `core` |
| `§wac-buf-basic-k4mf2js`, `§wac-buf-getset-p9qn3xl`, `§wac-buf-overwrite-w7rk5bt`, `§wac-buf-grow-m3hd8qz`, `§wac-buf-pop-j2fn9rk`, `§wac-buf-equals-h8wd2pm`, `§wac-buf-oob-get-f4kp7wn`, `§wac-buf-oob-set-n2qm8xl`, `§wac-buf-pop-empty-c7jw3kf` | the `Buffer` example program; `core`'s `Buf` has tags of its own ([42](../7-library/42-buf.md)) |
| `§wac-wapy-h3nq7fv`, `§wac-wapy-import-8kd3mqp`, `§wac-wapy-core-5wq8jhn`, `§wac-wapy-nolines-4gt7wxb`, `§wac-wapy-words-p2vm9kx`, `§wac-wapy-dedent-3nq8vrk`, `§wac-wapy-asyncdef-9mk2xrt`, `§wac-wapy-range-6mn4dtq`, `§wac-wapy-switch-w9pk2hs`, `§wac-wapy-matchexpr-3jx8rvc`, `§wac-wapy-roundtrip-5vd2qnw` | wapy is outside this specification |

## Shared suffixes

The current specification gave nine pairs of different tags the same seven-character suffix — `§wac-bind-i64-k3fn9wp` and
`§wac-sound-k3fn9wp`, for example. Both tags of each pair are carried unchanged, since a tag is its whole name. New tags
are drawn from a pool that does not repeat.
