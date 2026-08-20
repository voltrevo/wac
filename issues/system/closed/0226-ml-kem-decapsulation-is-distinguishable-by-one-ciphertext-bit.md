# 0226 — ML-KEM decapsulation is distinguishable by one ciphertext bit, which is what FO exists to prevent

- **Status:** closed
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-20
- **Kind:** bug
- **Symptom:** no error

## What it is

`packages/crypto/src/mlkem.wac`'s `mod` branches on its argument, and its argument is a polynomial
coefficient:

```wac
i32 mod(i32 a) {
  i32 r = a % q();
  return r < 0 ? r + q() : r;      // <- mlkem.wac:56
}
```

Fourteen call sites, all inside the NTT and the polynomial arithmetic, so it runs tens of thousands of
times per operation — and during `mlkemDecaps` the coefficients are the decrypted message and the
secret key's noise.

And the implicit-rejection select at the end of `mlkemDecaps` is a ternary:

```wac
  for (i32 i = 0; i < 32; i++) { out[i] = diff == 0 ? kPrime[i] : kBar[i]; }   // <- mlkem.wac:539
```

The two candidate secrets are both computed, which is right, and `diff` accumulates over the whole
ciphertext with no early exit, which is also right. What is left is a branch whose direction is
exactly one bit: **was this ciphertext valid.** That is the single most sensitive bit in a KEM, and
this file's own doc comment says why — "a KEM that reported *invalid ciphertext* would hand an
attacker the decryption oracle the Fujisaki-Okamoto transform exists to deny them."

## Measured

Key generation from a fixed seed, encapsulation with a fixed message, then decapsulation of the
resulting ciphertext against the same ciphertext with **one bit flipped in byte 0**. The two programs
differ in that literal and nothing else:

    first divergence: SPLIT at event 1,067,742
      A: packages/crypto/src/mlkem.wac:56:28 ternary-else
      B: packages/crypto/src/mlkem.wac:56:20 ternary-then

So the traces part long before the select at line 539 — inside `pkeDecrypt`'s arithmetic, on a
coefficient. The FO select is the second finding here, not the first.

## Why it was not seen

**There is no ML-KEM row in the side-channel table at all.** Nothing in
`packages/crypto/tools/ct.wac` touches this file, so `mlkemDecaps` has never been traced. That is the
same gap that hid `p256Sign` (`issues/system/0224`) and `ed25519Sign`
(`issues/system/0225`): the table grew by whichever row was easiest to add, and the routines that
take a secret are not the easy ones.

## Fixed — 2026-08-20

Both are one line, both were modelled first, and both were canaried separately so that neither is
resting on the other:

- `mod` is `r + (q() & (r >> 31))`. Checked against the ternary for every `r` in [-40000, 40000),
  which covers everything `a % q()` can produce. Putting the ternary back parts the traces at event
  976,852;
- the select is `kPrime[i] ^ (mask & (kPrime[i] ^ kBar[i]))` with
  `mask = ((diff | -diff) >> 31) & 0xFF`. Putting the ternary back parts them at event 1,528,756 —
  near the end, which is what shows this fix matters on its own rather than being hidden by the first.

A valid ciphertext and the same ciphertext with one bit flipped are now **identical over 1,528,880
events**. `test_ml_kem_decapsulation_does_not_reveal_whether_the_ciphertext_was_valid` in
`constanttime_test.wac` holds it, through `test/wac/mlkem_probe.wac`.

## The key-variation row was a false alarm three times over, and that is the useful part

Adding a `ct.wac` row for ML-KEM reported **leaks** at `mlkem.wac:201` — the rejection-sampling loop
in `sampleNTT`. It is not a side channel, and it took two more attempts to ask the question properly:

| attempt | result | why it was wrong |
|---|---|---|
| keygen → encapsulate → decapsulate the result | leaks at `:201` | the loop's trip count depends on ρ, and **ρ is published inside the encapsulation key** — two seeds are two different public keys |
| keygen → decapsulate a *fixed* ciphertext | leaks at `:201` | decapsulation re-encrypts, which re-samples the matrix from the ρ carried inside `dk`. **A decapsulation key determines its own public key** |
| one fixed keypair, `mix` xored into `dk`'s first 1152 bytes only | **uniform**, 1,023,945 events | `ek`, its hash and z are identical between the runs, so only the secret differs |

The third key is not one `mlkemKeyGen` would produce, which is fine: it is a valid *input*, since
`byteDecode` at width 12 reduces every coefficient mod q. Both runs implicitly reject, which is also
fine — the question is whether the work depends on the secret, not what it answers.

**A differential that varies "the key" varies whatever the key determines**, and for a KEM that
includes public data. A row reading **leaks** for that would have been worse than no row: expected
noise is where the next real finding hides, which is the argument this whole table rests on.

## What the table still cannot see, and now says so

`mod` computes `a % q()` — a remainder by a constant, on secret data. `wac build --trace` records
branches taken and array indices, not how long an arithmetic instruction took, so a uniform row here
is a claim about control flow and memory access and not about arithmetic timing. Real ML-KEM
implementations use Barrett reduction for exactly this reason. Left as a separate change with no
oracle behind it, and named in the code, the README and here so a clean row is not read as more than
it is.
