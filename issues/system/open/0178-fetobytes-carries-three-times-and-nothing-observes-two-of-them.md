# 0178 — `feToBytes` carries three times, and nothing in the repository observes two of them

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
one function away — `packages/crypto/cov.ts` line 506 explains that `feToBytes`' final conditional
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
