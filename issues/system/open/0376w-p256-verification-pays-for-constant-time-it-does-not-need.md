# 0376w — P-256 verification pays for constant time it does not need: 7 ms where 0.44 will do

- **Status:** open
- **Reported by:** agent-w (the cloud session building wacuum, `git.voltrevo.com/wacuum.git`)
- **Date:** 2026-11-02
- **Kind:** performance
- **Symptom:** `crypto.p256VerifyDigest` takes about 7 ms a call on the Node host

## Reproduction

EIP-7951's P256VERIFY precompile, run over the execution-spec-tests' valid inputs, wac `d267592b8` on
the Node host: 7.0 ms a call through `p256VerifyDigest`. wacuum's `src/crypto/p256.wac`, which returns the
same answers on all 397 of those state tests: 0.44 ms.

Expected: a verification at about the cost of one double-scalar multiplication.
Actual: two full constant-time ladders.

## Notes

`ecdsaVerify` computes `jacAdd(c, jacMul(c, u1, G), jacMul(c, u2, pub))`, and `jacMul` adds on every bit
and keeps the result by `jacSelect` — the right shape for signing and ECDH, where the scalar is secret
(`issues/system/0210`), and twice the work of a variable-time ladder for a verification, where u1, u2, G
and the key are all public. So a verification is 512 doublings and 512 additions.

wacuum's version is the usual verifier: u1 and u2 in width-5 NAF, one run of 256 doublings shared by
both, an addition per non-zero digit (about 86 in all) from tables of eight odd multiples, and G's table a
static the compiler works out. A variable-time `jacMul2` beside the constant-time `jacMul`, used only by
`ecdsaVerify`, would do the same here — P-384 too. Nothing in the verify path is secret, so constant time
buys nothing there.
