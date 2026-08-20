# 0225 — ed25519 signing leaks its nonce at the scalar reduction, and there was no row for it

- **Status:** closed
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-20
- **Kind:** bug
- **Symptom:** no error

## What it is

`packages/crypto/src/ed25519.wac`'s `scReduce` reduces a 64-byte value modulo L by 260 rounds of
compare-and-subtract, and both halves of each round depend on the value:

```wac
    // r >= shifted ?
    i32 ge = 1;
    for (i32 i = 63; i >= 0; i--) {
      if (r[i] != shifted[i]) { ge = r[i] > shifted[i] ? 1 : 0; i = -1; }   // <- ed25519.wac:334
    }
    if (ge == 1) {
      i32 borrow = 0;
      for (i32 i = 0; i < 64; i++) { … }
    }
```

The comparison leaves early, so *how many bytes it reads* is a function of `r`; and the subtraction
happens or does not. The round count is fixed, which is the part that was thought about — the work
inside a round is not.

**`r` is the nonce.** `ed25519Sign` computes `r = scReduce(sha512(prefix ++ msg))` where `prefix` is
the second half of the secret key expansion, so the reduced value is secret and a partial leak of an
EdDSA nonce recovers the private key from a signature the attacker already has. `scMulAdd` calls
`scReduce` too, which is how `packages/tor`'s hidden-service key blinding reaches it with a secret
scalar (`hsblind.wac`).

## Measured

Two 32-byte seeds through `ed25519Sign`, same message, traced and compared:

    first divergence: SPLIT at event 3,484,997
      A: packages/crypto/src/ed25519.wac:334:58 ternary-then
      B: packages/crypto/src/ed25519.wac:334:62 ternary-else

## Why it was not seen

**The side-channel table has `x25519Base` and no `ed25519Sign` row.** x25519 is key exchange and its
ladder is uniform over 1.8 million events, which is a real result about a real routine and says
nothing about signing — a different scalar, a different reduction, a different secret. The table's own
argument is that "we did not measure it" and "it is fine" look identical in a table that omits the
row, and this is the third time that has been the finding rather than the leak:
`issues/system/0224` was `p256Sign` missing while `p256PublicKey` was there.

`scMulAdd`, one level up, already carries a comment explaining that its carry propagation is
unconditional *on purpose* — "the conditional version stops early almost always, which means the tail
is reached by about one input in sixteen, a branch that is live, rare, and therefore untested." So the
question was asked in this file and answered for the function above the one that needed it.

## Fixed — 2026-08-20

**The comparison is gone, not made branchless.** `r - shifted` wraps exactly when `r < shifted`, so
the subtraction's own borrow out answers the question the compare loop was asking — the same trick
`weierstrass.wac`'s `reduceOnce` and `fieldp.wac`'s use. The difference is then kept or dropped by a
mask. Modelled against `% L` over 126 inputs including L, L−1, L+1, 2L, all-zero and all-ones before
any wac was written.

`ed25519Sign` is **uniform over 7,399,082 events**, and nothing was hiding behind the fix — unlike
`issues/system/0210`, where the ladder was concealing `reduceWide`.

**It costs 2.8% more, and the code comment said less before it was measured.** Traced events for one
signature: 7,199,946 → 7,399,146. The reasoning was that one unconditional pass replaces a compare
pass plus a half-taken subtraction, which ignores that the compare left after a byte or two — so what
it replaced was already cheap. Events rather than milliseconds because the machine was busy enough
that `p256Sign`, untouched by this change, swung between 2.7ms and 4.2ms across six runs; an event
count is deterministic, and it is a proxy for time rather than time.

`scLessThanL` keeps its early return, with a comment saying why: it is called on the `S` of a
signature being verified, which came off the wire.

## The file header was pointing at the wrong place

It said the leak was that "signing branches on scalar bits in the double-and-add". **`ptMul` adds on
every bit and keeps the answer with `feSelect`**, and has for as long as anyone has looked — so the
one sentence a reader would have trusted sent them to the only part that was already right, while the
part that parted went unmentioned. Corrected, and the correction says which claim it replaces.

## Guarded

`test_ed25519_signing_does_not_vary_with_the_secret_key` in `constanttime_test.wac`, and an
`ed25519Sign` row in `ct.wac`. Canaried by putting the conditional copy back — it fails and names
`ed25519.wac:367`, which is the mask rather than only the comparison.

**Adding it found a bug in `packages/wactest/src/built.wac`.** 7.4 million events overflow the
compiler's default 2^22-slot journal, so the test needs `--trace-slots`; passing it changed nothing
and `ctcompare` kept answering `truncated 7399082` with the same count. `builtProgram` keyed its
cache on the module name and the mtimes of the entry's closure — **not on the build flags** — so two
calls with the same name and different flags got the first one's module. `builtByDeno` beside it
documents that exact hazard; this one had it and did not. The flags are now written beside the module
and compared verbatim.
