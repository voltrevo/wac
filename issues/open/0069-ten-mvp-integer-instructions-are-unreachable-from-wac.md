# 0069 — ten MVP integer instructions are unreachable from wac

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-04
- **Kind:** missing feature
- **Symptom:** not implemented

The emitter writes no opcode for any of these, and the language has no operator or builtin that
could reach one:

| instruction | opcode | what wac-mono writes instead |
|---|---|---|
| `i32.clz` / `i64.clz` | 0x67 / 0x79 | a shift loop — see below |
| `i32.ctz` / `i64.ctz` | 0x68 / 0x7A | a shift loop |
| `i32.popcnt` / `i64.popcnt` | 0x69 / 0x7B | a shift loop |
| `i32.rotl` / `i64.rotl` | 0x77 / 0x89 | `(x << n) \| (x >> (32 - n))` in a function |
| `i32.rotr` / `i64.rotr` | 0x78 / 0x8A | as above |

All ten are MVP — every engine that can run a wac module has had them since 2017. The binary-op
table has `<<` (0x74), `>>` (0x75/0x76) and `>>>` (0x76) and stops there, so this is a **language**
gap as much as an emitter one: there is no source-level spelling to map onto the opcodes.

## What it costs today, with call sites

**`highBit` is `31 - clz`, written as a loop, twice.**

```wac
// packages/zstd/src/fse.wac:20 — and again, identically, at encode.wac:57
i32 highBit(i32 v) {
  i32 n = -1;
  i32 x = v;
  while (x != 0) { n++; x = x >> 1; }
  return n;
}
```

Called from `fse.wac:225`, `fse.wac:270` and `encode.wac:233` — inside FSE/ANS coding, which is
zstd's hot path. Up to 32 iterations where one instruction would do, and duplicated because there
was nowhere shared to put it.

**`bitLen` is the same shape** — `packages/bignum/src/big.wac:97`, `while (top != 0) { top = top
>> 1; bits++; }` — and bignum's division normalises with it.

**Rotation is a function call in five crypto primitives.** `chacha20`, `sha1`, `sha256`, `sha512`
and `keccak` each define `u32 rotl(u32 x, u32 n) { return (x << n) | (x >> (32 - n)); }`. With no
inliner in the compiler that is a real call: ChaCha makes 320 per 64-byte block, SHA-256 about 384.
Engines do inline small wasm functions, so the runtime cost is smaller than the static count
suggests — but one instruction against four remains, and there is nothing the source can say to
ask for it.

## Suggested shape

`clz`/`ctz`/`popcnt` have no natural operator, so they want builtins — and they must be
**compiler-recognised** rather than `std` functions, because there is no inliner and a call would
defeat the point:

```wac
i32 n = clz(x);        // i32.clz
i32 t = ctz(x);        // i32.ctz
i32 p = popcnt(x);     // i32.popcnt
```

Rotation could be either an operator pair (`<<<` / `>>>`, though `>>>` is taken for logical shift)
or builtins in the same family (`rotl(x, n)`, `rotr(x, n)`). Builtins are probably better: they
avoid arguing about precedence, and they keep all five in one place.

Width follows the operand type, as the shift operators already do.

## Notes

Also absent: `select` (0x1B) and the sign-extension pair `i32.extend8_s`/`extend16_s`
(0xC0/0xC1). `select` is a deliberate non-issue — the ternary compiles to if/else blocks, which is
correct because `select` evaluates both arms eagerly. The sign-extension pair is reachable today by
shifting twice, and nothing in wac-mono obviously wants it, so it is noted rather than requested.

This came out of drafting a SIMD proposal (issues 0070 and 0071). It is separate from those and much
cheaper: it needs no new type, no memory, and no floor decision, and it changes the baseline every
SIMD measurement will be compared against — see 0070's note on re-baselining.

An earlier version of this report cited `0x77`/`0x78` occurrences in the emitter as evidence the
opcodes were known but unused. They are i8/i16 heap-type encodings in `wasmBuildBin.ts`, unrelated;
agent-b caught it. The conclusion held, the evidence did not.
