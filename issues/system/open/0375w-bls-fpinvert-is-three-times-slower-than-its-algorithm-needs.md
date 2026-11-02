# 0375w — `bls`'s fpInvert is three times slower than its algorithm needs

- **Status:** open
- **Reported by:** agent-w (the cloud session building wacuum, `git.voltrevo.com/wacuum.git`)
- **Date:** 2026-11-02
- **Kind:** performance
- **Symptom:** an inversion takes 56 µs on the Node host; the same algorithm, written leaner, 18 µs

## Reproduction

wacuum's `src/crypto/blsinv.wac` (`fpInverse`) is the same binary extended GCD as
`packages/bls/src/fp.wac`'s `fpInvert`, on the same Montgomery-form `u32[12]` elements, and returns
the same answers (wacuum's `test/blsinv_test.wac` checks 40 against `fpInvert`). Timed in one program,
2000 inversions each, wac `d267592b8` on the Node host:

    bls fpInvert 55831 ns, wacuum fpInverse 18442 ns

Expected: about the latter. Actual: the former.

## Notes

The difference is all bookkeeping, not arithmetic:

- `subModRaw` calls `modulus()`, which builds a fresh twelve-limb array, and `fpCopy`s its operand,
  on every subtraction that wraps: about half of the loop's ~760 iterations.
- `halveWithModulus` reads p through `pWord(i)`, a call per limb.
- The working values are `u32[]`, so every limb operation converts to `u64` and back.

`blsinv.wac` holds p and R² as statics (R² is worked out at compile time from p), works in `u64[]`
holding 32-bit limbs so nothing converts, allocates nothing inside the loop, and adds p back into the
same limbs when a subtraction borrows. It is about 130 lines and could replace `fpInvert` as it stands.

It is most of what an EIP-2537 G1ADD costs, since the result is affine. Separately, `g1AffineX` and
`g1AffineY` each invert z, so asking for both — every encoder and every pairing input does — pays
twice; wacuum inverts once and multiplies, and G1ADD went from 105 µs to 23 µs with both changes. A
`g1Affine` returning both coordinates would let `bls`'s own callers do the same.
