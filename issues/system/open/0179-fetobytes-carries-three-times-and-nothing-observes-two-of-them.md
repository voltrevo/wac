# 0179 — `feToBytes` carries three times, and nothing in the repository observes two of them

- **Status:** open
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

**What is still not proved**, stated because the issue is right to insist on it: I have not shown the
exact magnitude at which the pass-two ripple reaches limb 9, only that the round-to-nearest passes put
the input well below it. A bound of the form "limbs below 2^k are safe for `feCarryFloor` alone" would
let the passes go; deriving it is the remaining work, and it is now a bounded arithmetic question rather
than an open-ended one about the whole field.

