# 0377w — keccak256 absorbs a byte at a time, as costly as the permutation

- **Status:** open
- **Reported by:** agent-w (the cloud session building wacuum, `git.voltrevo.com/wacuum.git`)
- **Date:** 2026-11-02
- **Kind:** performance
- **Symptom:** `crypto.keccak256` of 32 bytes takes 942 ns on the Node host; the same with lane-wide absorbing, 498

## Reproduction

wacuum's `src/crypto/keccak.wac` is keccak256 over `crypto.keccakF`, absorbing a lane per eight-byte
little-endian read and putting the padding straight into its lanes; it agrees with `crypto.keccak256` at
every length from 0 to 300 bytes (wacuum's `test/keccak_test.wac`). Best of five runs of 20,000, wac
`d267592b8` on the Node host:

    32 bytes:   wac 942 ns, wacuum 498 ns
    64 bytes:   wac 969 ns, wacuum 521 ns
    200 bytes:  wac 1691 ns, wacuum 991 ns
    1024 bytes: wac 5352 ns, wacuum 3935 ns

Expected: about the permutation's cost for a short input. Actual: nearly twice it.

## Notes

`absorb` does `state[i / 8] ^= (block[off + i] as u64) << (((i % 8) * 8) as! u64)` for each of a block's
136 bytes — a division, a remainder and a variable shift a byte — and `sponge` copies the last partial
block into a fresh `u8[]` to pad it. `keccakF` itself was already made fast (its comment: 6.8x); the
absorbing around it is now as costly as it, and for Ethereum's inputs — 32- and 64-byte keys, topics, trie
nodes — it is most of a hash. In wacuum's profile of a block of token transfers, `sponge` and `absorb`
were 13% of the time and `keccakF` 12%. wacuum's version is 60 lines and could stand in for `sponge`'s
keccak256 path; the same lane reads would serve `sha3_256` and the SHAKEs.
