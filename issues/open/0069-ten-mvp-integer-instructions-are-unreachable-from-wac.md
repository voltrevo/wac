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

## Suggested shape — methods on the numeric types

```wac
i32 n = x.leadingZeros();     // i32.clz  — 32 when x is 0
i32 t = x.trailingZeros();    // i32.ctz
i32 p = x.onesCount();        // i32.popcnt
u32 r = k.rotateLeft(7);      // i32.rotl
u32 s = k.rotateRight(7);     // i32.rotr
```

Three reasons, in order of weight.

**It is the closest existing precedent.** Issue 0056 took two single wasm instructions —
`array.copy` and `array.fill` — and exposed them as methods on the receiver. These are the same
kind of thing: one instruction, one value.

**A free function named `rotl` would collide with existing code.** `packages/crypto` defines
`u32 rotl(u32 x, u32 n)` in five files. A builtin free function would be shadowed by those, or
break them. A method cannot collide with a free function, so those helpers keep working and become
one-instruction wrappers — migration is then optional and incremental rather than a flag day.

**Width falls out of the receiver.** `x.leadingZeros()` picks `i32.clz` or `i64.clz` from `x`'s
type with no overload resolution and no inference. A static `i32.clz(x)` would state the width
twice and could disagree with its argument; a free function would need overloading, which wac does
not have.

Numeric primitives have no methods today, but the dispatcher already reaches them and reports
`type 'i32' has no method 'len'`, so this is a branch rather than a restructure. `5.len()` parses,
so a literal receiver is not a lexing hazard.

### Semantics to pin down

- `leadingZeros()` and `trailingZeros()` of zero are the **full width**, 32 or 64. wasm defines
  this; C's `__builtin_clz(0)` is undefined, so a C reader will assume UB and needs telling.
- Rotate counts are taken mod the width, as the shift operators already are: `x.rotateLeft(32)`
  is `x` for `i32`.
- Signedness is irrelevant to all five, so `i32`/`u32`/`i64`/`u64` all get them and the opcode is
  chosen by width alone.
- All five should const-fold — `wacConstEval.ts` exists and crypto builds tables from constant
  expressions.

### Rejected alternatives

**Operators.** `>>>` is already logical shift, so rotation would need `<<<` and `>>>>`, and
`clz`/`ctz`/`popcnt` have no natural operator at all. Operators could cover two of the five and
would split the family across two mechanisms.

**A `std/bits.wac` module.** With no inliner those are real calls, which defeats the purpose.
Having the compiler special-case imported names by module and name is fragile and leaves code in
`std` that never runs.

**The mnemonic names `clz`/`ctz`/`popcnt`.** Those are x86 and ARM mnemonics. The house style is
spelled out — `copyFrom`, `fromBytes`, `fromCodepoint`, `withCapacity`, `swapRemove` — and
`leadingZeros` is Rust's and Go's choice for the same reason. The cost is that
`s[d] = s[d].rotateLeft(16)` is longer than `rotl(s[d], 16)`, which seems worth paying since hot
code is read more often than written.

An earlier version of this issue suggested free-function builtins. That was before checking the
`copyFrom` precedent and the five existing `rotl` definitions, both of which argue the other way.

## Sequencing

This and 0070 both need methods on a primitive type, which does not exist yet. Whichever lands
first pays for the dispatcher branch and the other gets it free — an argument for doing this one
first, since it is much the cheaper of the two and needs no floor decision.

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
