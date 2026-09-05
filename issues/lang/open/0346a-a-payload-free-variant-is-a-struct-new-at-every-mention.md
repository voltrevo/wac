# 0346a — a payload-free variant is a `struct.new` at every mention

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** performance
- **Symptom:** an allocation per mention of a variant that carries nothing

`enum Ordering { Less, Same, Greater }` has three variants and no payload fields, so every value of
it is one wasm struct of a single `i32` tag. **Every mention allocates a fresh one**, and every
language with sum types allocates three constants instead.

Verified at three levels:

**The emitter.** `packages/wacc/src/emit.wac:6487`'s `emitVariantNew` emits `i32.const tag`, fills
every slot (`emitNull` where the variant has no field there) and then `struct.new`. There is no
special case for zero arity — a bare `Shape.Point` takes the same path as `Shape.Rect(3.0, 4.0)`.

**The semantics.** `spec/spec/structs.md`: *"`is` with a value (not a type or `null`) compares
reference identity — whether two references point to the same object. Maps to `ref.eq`."*

**And the spec says it outright, while explaining something else.** `spec/spec/enums.md`, in the
paragraph on why `is` needs a qualified variant:

> `Shape.Empty` on the right of `is` parses as an expression rather than a type, so the test became
> **reference identity against a freshly constructed variant** and was always false

*Always false* is the observation. Against an interned value that comparison would have been correct
for exactly the cases the author meant; it was wrong for all of them.

## Where it costs something

Nowhere yet, and one place it would.

`enum Ordering` does not exist in this tree — **fifteen functions return a three-way comparison and
all fifteen answer `i32`**, in eight packages: `cmp` and `cmpAbs` (`bignum`), `cmpBE` (`crypto`),
`cmpBytes`, `cmpNumeric`, `cmpNumericThenBytes` (`box`), `compareBytes` (`tor/vote`), `compareIndex`
(`tor/hsdir`), `compareValue`, `compareMidpoint`, `compareScaled` (`fmt/atof`), `bigCmp` (`wacc`),
`cmp` (`fmt/bigint`) and two more.

`issues/system/0345a` proposes a `core` sort, and the natural comparator type for it is an enum
rather than a signed integer, since a sign convention is exactly the check a closed set gives up —
nine of the fifteen return `a[i] - b[i]` unbounded, so `cmp(a, b) == -1` is the same intent written
wrong. **Under today's lowering that comparator allocates once per comparison, `n log n` times per
sort.** So the two issues pull against each other and this one has to be answered first.

Everything else here is cold: `Padding.Unpadded` in `codec`, `Alphabet`'s arms, `http`'s
`Incomplete`. A payload-free variant on a refusal path costs nothing worth measuring.

## What it would take, and what it would change

Three module-level globals per payload-free variant, initialised once, and `emitVariantNew` returning
`global.get` when the arity is zero. The variants are immutable — a struct whose only field is the
tag — so sharing one is unobservable **except** through `is`.

And that is the decision: **interning makes reference identity meaningful for payload-free variants
where today it never is.** `s is Shape.Empty` is currently always false, which the spec documents as
the reason the qualified form is required. After interning it would be true, which is what a reader
expects and is a behaviour change to a construct the spec discusses.

**Asked what would break: nothing testable.** A grep for a test asserting the identity of a
payload-free variant finds `spec/tour.wac`'s table row (`x is y — reference identity — ref.eq`) and
nothing else. The behaviour is specified twice in prose about structs and pinned nowhere, which is a
reason to decide deliberately rather than a licence to change it quietly.

## Notes

Found while writing `vision/core/order.wac`, which proposes exactly the `Ordering` enum above, and
then reading `spec/spec/enums.md` to check the claim that nothing says what wac does. Something does,
in a sentence about a different bug.

No measurement here — the allocation is established from the emitted bytes rather than from a clock,
and the number that would decide it is a sort benchmark that does not exist. `packages/bls` measured
a one-field struct at 2.6 ns against a 395 ns operation, which is the wrong ratio for this case: there
the wrapper is 0.7% of the work and in a comparator it is most of it.
