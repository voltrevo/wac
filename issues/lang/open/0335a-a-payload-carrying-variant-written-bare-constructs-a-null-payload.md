# 0335a — a payload-carrying variant written bare constructs a default payload, and a null one for a reference

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** bug
- **Symptom:** trap — a null dereference on a field whose type has no null

`spec/spec/enums.md` defines the bare form for **payload-less** variants only:

> A payload-less variant is a value, not a call — `Shape.Point`, not `Shape.Point()`.

A payload-*carrying* variant written the same way is accepted. It constructs the variant with a
default payload, and for a reference type that default is `null`.

## Reproduction

```wac
enum Sh { A, B(string s) }
Sh make() { return Sh.B; }
export i32 probe() { match (make()) { case A: return 1; case B(s): return s.len(); } }
```

Expected: a compile error. `B` carries a `string` and none was given.
Actual: 0 parse errors, 0 type errors, 5,926 bytes emitted, and at run time

```
probe() traps: dereferencing a null pointer
```

**The trap is wherever the payload is first read**, which may be in another function, in another
file, or on a branch that runs a week later. `s` has type `string`, which has no null.

## The check exists and one spelling walks past it

Same enum, one character different:

| written | parse | type | outcome |
|---|---|---|---|
| `Sh9.B()` | 0 | **1** | `a variant with the wrong count` |
| `Sh9.B`   | 0 | 0 | emits; payload is the default |
| `Sh7.A(5)` — a payload-*less* variant given one | 0 | **1** | `a variant with the wrong count` |

So the arity rule is enforced in both directions **when there is an argument list**, and skipped
when there is not. `packages/wacc/src/emit.wac` has it twice:

```wac
if (args.len() != env.variantArity[vwi]) { return "a variant with the wrong count"; }
```

— reached from the construction-with-arguments path. The bare form takes the payload-less path,
which never asks the arity.

With an `i32` payload the result is quieter and not better: `enum Sh { A, B(i32 n) }` with
`return Sh.B;` runs and answers `B(0)`, indistinguishable at every `case B(n)` from a `B` somebody
meant to build with zero.

## Notes

**Where it was found, and why it is not only a footnote.** `vision/packages` has been writing
`Result<void, E>` — a function that can fail and has nothing to return — and spelling success
`return Ok;`. Measured: that **works today**, 0 type errors, and runs. It works *through this hole*:
`Ok` carries a `T`, no argument is given, and the payload defaults. At `T = void` there is nothing
to default and nothing goes wrong; at `T = string` the same construction is the reproduction above.

So the two are coupled, and fixing this one raises the question it was hiding: **what is
`Result<void, E>`, and how is its `Ok` written?** `Ok(void)` is not a value. Either `void` is
special-cased as a type argument whose variant may be written bare, or the idiom needs a different
spelling — `Ok(Unit())` with a one-member struct works today and is what the measurement showed
(`probe3() = 30`, clean). `spec/spec/async.md` already special-cases the neighbouring case and says
*"`Vec<void>` remains an error — nothing can hold a value"*, so there is precedent for a rule and no
rule for this.

**Nothing in the tree writes it, which is why it has survived — measured.** Over `packages/`,
`tools/`, `spec/` and `bootstrap/`: 50 enums have payload-carrying variants, 170 such variants
exist, and **0** are written bare outside a type test or a `match` pattern. The scan finds all four
of the probes above when pointed at them, so the zero is a zero rather than a broken regex.

It took three passes to get that number, and the two wrong ones are worth recording because both
read as findings. The first said **63**: it scanned the enum body whole, so a method's `match (this)`
and every method signature were counted as payload variants, and it did not blank string literals,
so `"Read.Data carries "` in a test's message was a hit. The second said **27**, having blanked
strings, and still counted `Verdict.Survived` — a payload-*less* variant of an enum whose only
payload variant is `Abort(string why)` — because the variant list was still being read past its end.
Only the third restricts to the text before the first method body.

`spec/cases` has nothing pinning either direction of the arity rule; the two tests that touch it are
`packages/wacc/test/wac/typecheck_test.wac` and `typeargsrule_test.wac`, both on the
with-arguments path.

**So it is latent, not live.** The bare form is nonetheless what a reader reaches for, because it is
what the spec shows for the payload-less case and the two look identical at the call site — and
`vision/packages` reached for it within a day of starting to write `Result<void, E>`.

**Suggested fix and its one decision.** The bare form should ask the arity like the parenthesised one
does, and refuse when it is not zero — one condition on the payload-less path in `emit.wac`, plus
the same in the checker so it is a diagnostic rather than a decline. The decision is whether to
carve out `T = void`, which is the `Result<void, E>` question above and should be answered first,
because the carve-out is where the rule would go.

Measured through `deno run -A bootstrap/ts/ask_wacc.ts`, ten probes, 2026-09-04.
