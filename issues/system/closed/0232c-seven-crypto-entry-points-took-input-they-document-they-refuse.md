# 0232c — seven crypto entry points took input they document they refuse

- **Status:** closed
- **Closed by:** agent-c, 2026-08-21
- **Fixed in:** the commit this line arrived in — six files under `packages/crypto/src`, with
  `test/wac/traps_test.wac`, `test/wac/rsa_test.wac` and `test/wac/nistcurve_test.wac`
- **Reported by:** GitHub issues 11, 12, 13, 14, 15, 16 and 17, all at `master` on 2026-08-17
- **Kind:** bug
- **Symptom:** trap, or a wrong answer — depending on which side of the documented width the caller was

## One family, seven places

Every one is an entry point that consumes a fixed-width or serialized input without requiring the
shape its own documentation promises. Filed separately, fixed together, because the *pair* of failure
modes is the same in all of them and only one half of the pair is obvious:

- a **short** input runs off the end of an array and traps somewhere that says nothing about the
  caller's mistake;
- a **long** input is read for its first n bytes and the tail ignored — so two visibly different
  inputs produce one answer. That is the half worth refusing, and the half a short-input test cannot
  see.

| GitHub | entry point | took | now |
|---|---|---|---|
| 11 | `CtrStream.resume` | any `used`, failing later in `apply` | traps at `resume` unless `0..16` |
| 12 | `Sha1.loadState` | any `pending`/`total`, incl. states `saveState` cannot write | traps unless `pending` is `0..63` and `pending == total % 64` |
| 13 | `chachaBlock`, `chacha20`, `poly1305` | any key/nonce length | traps unless exactly 32 and 12 |
| 14 | `p256Verify`, `p256VerifyDigest`, `p384Verify`, `p384VerifyDigest` | trapped on a malformed public key | answers `false` |
| 15 | `rsaRecoverPkcs1` | trapped on a one-byte modulus | answers empty, as documented |
| 16 | `aesEncrypt`, `aesDecrypt` | any block length | traps unless exactly 16 |
| 17 | `rsaVerifyPss` | a negative `saltLen`, reaching an out-of-bounds read | answers `false` |

## Two of them are not length checks, and that is the interesting part

**14 needed the rules split from the trap.** `curveDecode` traps on every validation failure and
should: its docstring is about the invalid-curve attack, and for ECDH a bad point is a protocol error
worth stopping on. But the four verify APIs return `bool` and are handed a public key by whoever sent
the signature. So `curveDecodes` now holds the rules and answers a question; `curveDecode` calls it
and traps. One implementation of the invalid-curve check, two behaviours — rather than two copies,
which would be two chances to fix one and not the other.

**17 was a sign, not a width.** The size check reads `emLen < hashLen + saltLen + 2`, so a negative
`saltLen` *weakens* it instead of failing it, and an ordinary modulus passes.

## What the guards cost: nothing measurable, and that is evidence

Forty test files across `packages/crypto`, `packages/tls` and `packages/ssh` pass unchanged, so no
real caller was relying on the sloppy widths. The one place a check is deliberately *not* added is
`aesEncryptBlock`/`aesDecryptBlock`: they take an expanded key and are the per-block interior of CTR,
GCM and the KDFs, where a length check is a cost paid a million times for a caller already checked at
the boundary.

## Two things the tests taught, both worth keeping

**A deferred trap makes a trap test useless.** The CTR cases were first written as
`resume(…, 17).apply(u8[](0))` — the reporter's own reproduction — and passed *before* the guard
existed, because the deferred read traps on its own. A test that only wants *a* trap cannot tell an
argument check from its absence. Calling `resume` alone is what makes the trap attributable, and
removing the guard then fails all three.

**One existing test was pinning the bug.** `test_traps_p384_on_an_x_that_is_x_plus_p` asserted that a
non-canonical coordinate *traps*, which is exactly what 14 says a `bool` verifier must not do. It is
now two assertions — `curveDecodes` says no to `x + p` and yes to the canonical point, and
`p384Verify` returns rather than traps — because after the fix a malformed key and a nonsense
signature are both `false`, and the old test's discrimination had to be rebuilt somewhere it still
exists.

## Verified against a known break

All eight guards removed at once: 12 of the 17 new or changed cases fail. The five that do not are
the short-input rows, which trap through the array access whatever the guard does — the same thing
`traps_test.wac`'s own header says about its earlier length rows, and the reason every case here has
a long-input twin.
