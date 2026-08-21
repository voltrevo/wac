# 0179 — `feToBytes` carries three times, and nothing in the repository observes two of them

- **Status:** closed
- **Closed by:** agent-a, 2026-08-21 — the bound is proved by a constructed witness, and the passes now have a test
- **Fixed in:** `packages/crypto/src/field25519.wac` (the derivation, in `feToBytes`) and `packages/crypto/test/wac/field25519_test.wac` (two tests)
- **Claimed by:** agent-a, 2026-08-21 — derived; the passes stay and the reason is in the code
- **Reported by:** agent-b
- **Date:** 2026-08-17
- **Kind:** untested behaviour
- **Symptom:** no error

## What was found

`packages/crypto/src/field25519.wac`'s `feToBytes` opens with three reduction passes:

```wac
i64[] h = feCopy(hIn);
feCarry(h);
feCarry(h);
feCarryFloor(h);
```

Deleting **both** `feCarry` calls changes no answer anywhere. Measured 2026-08-17 by removing them
and running:

| what | result |
|---|---|
| `wac test packages/crypto/test/wac/` | 0 failures |
| `packages/tor/test/wac/ntor_test.wac` | 6 passed |
| `packages/tls/test/wac/hybrid_test.wac` | 31 passed |

That is the whole of X25519, Ed25519, the ntor differential against C tor's own `test-ntor-cl`, and
the hybrid key exchange — every consumer of the field in the repository.

`feCarryFloor` on its own **is** load-bearing: removing it fails five tests in
`field25519_test.wac`, including the BigInt differential. So this is not "the reduction does
nothing", it is "two of its three passes do nothing that anything can see".

The differential it was checked against is the new one at the bottom of `field25519_test.wac`: 270
values including p-1, p-2, 2^254, the limb boundaries and 250 pseudo-random elements, each put
through add, sub, mul, square, seven small multiplies, inversion and a round trip, all compared
against BigInt in `test/oracle.mjs`. Sub is in there deliberately, because negative limbs are the
thing round-to-nearest exists for.

## Why this is filed rather than fixed

**Deleting them is a change to constant-time code and I have not shown they are dead.** "No input in
this repository reaches it" is not "no input reaches it". The same argument is already written down
one function away — `packages/crypto/test/cov_ledger.wac`'s entry for `field25519.wac:200` explains that `feToBytes`' final conditional
subtraction is unreachable, gives the reason, and says explicitly: *"That is an argument, not a
proof — I could not construct an input, and I have not shown none exists."* The same caution applies
here and more so, because two passes are a larger thing to remove than one branch.

**The bound is the question.** `feMul` leaves limbs up to some width; `feCarryFloor` reduces to
canonical only if its input is already within a bound the round-to-nearest passes are there to
establish. Whoever picks this up should derive that bound rather than measure it, because the
failure mode is a non-canonical encoding for a narrow band of values, which surfaces as an interop
failure years later.

Three outcomes are all fine and the choice needs the bound:

- **They are redundant** — delete them, and say in the comment what bound makes `feCarryFloor`
  sufficient.
- **They are needed for inputs nothing here produces** — keep them, and add the case to the
  differential so it is measured rather than argued.
- **They are needed and the case cannot be built from the public surface** — keep them, and record
  it beside the `geP` entry in `cov.ts`, which is where this repository puts that answer.

## What was corrected in passing

`packages/crypto/test/wac/field25519_test.wac`'s header used "a reduction one carry pass short of
complete" as its example of what only an outside reference can catch. That example is wrong: a
carry pass short of complete is exactly what nothing catches. The claim it was making — that a
non-canonical representative satisfies every relation the field can state about itself — is right,
and the header now uses the floor pass, which the differential does catch.

## Derived — agent-a, 2026-08-21, and the answer is "keep them" for a different reason than expected

The issue asks for the bound rather than another measurement. Working it through moves the question:
**`feCarryFloor` is not the part that needs a bound to be correct. It needs one to terminate in two
passes.**

**What `feCarryFloor` does unaided.** Floor division leaves a non-negative remainder, and the loop
visits limb `i` after limb `i-1` has already carried into it — so after pass one, limbs 1..9 are in
`[0, 2^bits)` whatever magnitude the input had. Only limb 0 can be out of range, by the fold at limb 9.
So a *single* pass canonicalises everything except limb 0, from any input.

**And the fold works in both directions**, which is the half nothing observed. `h[0] += c * 19`
subtracts `c * (2^255 - 19)` — that is, `c · p`. With `c` positive it takes p away; **with `c` negative
it adds p**, so a representation whose integer value is below zero comes out as its positive residue.
`feSub(0, 1)` is the smallest such input, and it encodes as `p - 1` today. Now pinned, in both the
direct and the through-`feMul` form, by
`test_a_negative_representation_encodes_as_its_positive_residue` — 22 assertions.

Canaried by making the fold refuse a negative carry (`if (c > 0)`): 6 tests fail, 22 of the failures in
the new one. So the test observes the arm it names.

**Where the bound actually lives.** `feCarryFloor`'s own comment says two passes suffice because the
wrap's second excursion is "always small enough to settle". That is a claim about the input's
magnitude, and it is the only claim in the chain that needs one. Pass two can itself carry out of limb
9 if the ripple from limb 0 reaches that far, and the 19 it folds back lands on limb 0 *after* limb 0
was reduced — so limb 0 would be packed out of range. Whether the ripple can reach limb 9 depends on
how big the limbs were coming in.

Which is what the two round-to-nearest passes are for: not canonicalisation, but bringing any input
down to magnitudes where that ripple cannot reach. **So they are load-bearing, and the measurement that
deleting them changes nothing is a fact about the inputs this repository produces** — every value the
field's own operations hand out has already been carried twice inside `feMul` — rather than about the
function. Canaried the other way too: with both passes removed, all 11 tests still pass, negative cases
included.

**Recommendation: keep them, which is now written in the code.** `feToBytes` is exported and takes a
raw `i64[]`, so a caller can hand it an accumulation that was never carried; two straight-line loops on
values that are already small is a cheap precondition to buy, and constant-time is unaffected either
way. The comment in `feToBytes` states the derivation so the next person who measures "deleting them
changes nothing" finds out why that is true and not sufficient.

## Proved, with a witness — and my own "not proved" paragraph was one solve away

The paragraph above said the remaining work was to show the magnitude at which the pass-two ripple
reaches limb 9. It is constructible, so here it is.

Pass one must leave limb 0 at `3 * 2^26 - 1`, so pass two reduces it to `2^26 - 1` **and** carries 2
upward. Limbs 1..8 at their maxima pass that carry along. Limb 9 must end pass one at `2^25 - 1`, so the
carry tips it over and the fold puts another 19 onto a limb 0 that is already maximal — final limb 0 is
`2^26 + 18`, out of range, and the encoder packs it as if it were not.

Solving `r0 + 19 * c = 3 * 2^26 - 1` needs only that 19 is invertible mod `2^26`: `r0 = 7`,
`c = 10596136`, so limb 9 is `10596136 * 2^25 + 2^25 - 1` — about `2^49`, comfortably inside `i64`.

    with the two passes      raw 1200000800…  mul 1200000800…   agree
    with them removed        raw 1200000400…  mul 1200000800…   disagree

The oracle is the encoder against itself: the same value written two ways, these limbs raw and these
limbs through `feMul(., 1)`, which carries on the way out. So no external reference is needed to state
it, which is why it can live in the wac test rather than in the BigInt differential.

**Three failed attempts first, and they are the reason to write this down.** Powers of two for limb 9
all agreed, with and without the passes — because `2^k mod 2^25 = 0` leaves limb 9 at *zero* after pass
one, so it absorbs the ripple instead of carrying. `2^k - 1` gets limb 9 to its maximum but leaves limb
0 small after its own reduction, so the extra 19 lands harmlessly. Only limb 0 *and* limb 9 tuned
together reach it. A search over either alone finds nothing, which is why the issue's measurement — and
mine — kept coming back clean.

## Closing it

- The two `feCarry` passes **stay**, and are no longer "not shown to be dead": they are shown to be
  load-bearing, for an input `feCarryFloor` alone gets wrong.
- `test_the_input_that_needs_the_round_to_nearest_passes` pins it. Canaried by removing both passes:
  that test fails on byte 3 and the other eleven still pass, which is also the sharpest statement of
  how narrow the case is.
- `test_a_negative_representation_encodes_as_its_positive_residue` pins the other thing nothing
  observed — the fold running with a negative carry, which is how a below-zero representation becomes
  its positive residue.
- `feToBytes` carries the derivation, so the next person who measures "deleting them changes nothing"
  finds the witness rather than repeating the search.

The `feCarryFloor` comment's own claim — two passes settle it "provided the excursion is small" — was
right, and is now quantified rather than asserted.
