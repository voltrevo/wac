# 0078 — `as@` computes where it claims to reinterpret

- **Status:** open
- **Blocked on:** **a discussion with the operator before anyone implements it** — see "Do not
  start this yet" below. Moved off the `Status:` line, which `wacSpec.test.ts` requires to be
  exactly `open` or `closed`; the qualification is the same one agent-c wrote.
- **Claimed by:** (nobody yet — and see "Do not start this yet" below)
- **Reported by:** agent-c
- **Date:** 2026-08-08
- **Kind:** missing feature
- **Symptom:** not implemented

`as@` is documented as the raw cast, and `casts.md` describes the same-width signedness
rows as "same bits, read the other way — emits nothing". Four of its twelve pairs do not
do that. They compute.

## Reproduction

```wac
export i32 raw(f64 x) { return x as@ i32; }
```

`raw(3.7)` returns `3`. The bits of `3.7` are `0x400d99999999999a`; the answer is
`0x00000003`. Nothing there is a reinterpretation of those bytes — it emits
`i32.trunc_sat_f64_s`, which is arithmetic.

Expected, under the reading the operator's name and its own signedness rows advertise: a
compile error, and the operation spelled some other way.
Actual: accepted, and silently bundling two decisions — truncate toward zero, *and*
saturate on overflow — neither of which appears in the source.

## What the twelve pairs actually do

Derived from the compiler, not from the spec table, because that table has been wrong
before — `§wac-cast-matrix-6hkq4wz` records the unsigned rows having been missing from it.
The compiler accepts exactly twelve directed pairs and the table now lists exactly those
twelve, so it is currently accurate. `u8`/`u16` are not `as@` destinations at all.

| category | pairs | emits | modifies bits |
|---|---|---|---|
| reinterpretation | `i32 <-> u32`, `i64 <-> u64` | nothing | no |
| narrowing | `i64 -> i32`, `i64 -> u32`, `u64 -> i32`, `u64 -> u32` | `i32.wrap_i64` | no surviving bit |
| **float → int** | `f64 -> i32`, `f64 -> u32`, `f32 -> i32`, `f32 -> u32` | `i32.trunc_sat_*` | **yes** |

Verified by value: `i32 -1` → `0xffffffff`; `i64 0x123456789abcdef0` → `0x9abcdef0`, low
half exact; `f64 3.7` → `0x00000003`.

The middle row is the judgement call. Nothing that survives is altered, so it is a bit
*selection* rather than a computation — but the widths differ, so it is not "the same
bytes" either.

## The operator's proposal

1. Floats get `floor`, `ceil` and `trunc` methods.
2. `as@` works only between types of the same size, and does nothing but put a different
   type on top of the same bits.
3. `u64 -> u32` and the other narrowing rows become a named method rather than `as@`.

## What that costs, measured

Each row measured by removing it from `isRawNumericCast` and compiling all 261 `.wac`
files in wac-mono. The compiler was reverted immediately; nothing is committed.

| removal | call sites affected |
|---|---:|
| float → int | **0** |
| narrowing | **100** — `u64 -> u32` 74, `i64 -> u32` 25, `u64 -> i32` 1 |
| same-width | not proposed for removal (~222 uses) |
| `toBits`/`fromBits`, if subsumed | 16, thirteen of them in `packages/fmt` |

`i64 -> i32` has zero uses. The narrowing that carries weight is almost entirely *to*
`u32`.

## What needs deciding, and why this is not ready to implement

**Rule 2 makes `as@` bigger, not smaller.** Same-size pairs are `i32 ↔ u32 ↔ f32` and
`i64 ↔ u64 ↔ f64` — twelve directed pairs against today's four. So `f64 as@ u64` becomes
legal, and that is exactly what `f64.toBits(x)` already does.

**So `toBits`/`fromBits` collide with the new `as@` and one of them should go.** The case
for deleting them: `as@` would now be *defined* as same-bits-different-type, and a second
spelling is the duplication this language avoids elsewhere; `as@` also expresses
`f64 as@ i64`, a signed reading, which `toBits` cannot — it pairs a float only with the
unsigned integer of its width. The case against: `f64.fromBits(0x3FF0…)` announces itself
where `0x3FF0… as@ f64` does not. **This is the main open question.**

**Naming, not yet agreed.** `low32()` / `high32()` for the narrowing, with the signed
reading composing as `x.low32() as@ i32` rather than getting its own row. Not `wrap()`,
though that is the wasm instruction's name, because it reads as wrapping *arithmetic*.
`high32()` is not strictly needed — `(x >> 32).low32()` works — but splitting a 64-bit
value is constant in `bls`, `crypto` and `bignum`.

**Scope: this is the float half of [0069](../closed/0069-ten-mvp-integer-instructions-are-unreachable-from-wac.md).**
None of wasm's float instructions is reachable from wac — `floor`, `ceil`, `trunc`,
`nearest`, `sqrt`, `abs`, `min`, `max`, `copysign`, every one an MVP single instruction.
Adding three methods and leaving six means filing this again in a month. If the answer is
"add the set", `nearest` should keep that name rather than becoming `round`: it is
round-half-to-even, and most languages' `round` is half-away-from-zero, so `round` would
be a name that implies the wrong semantics.

**What stays.** `as~` keeps its float → int rows — it is the lossy cast and nothing about
it changes. Worth stating in `casts.md`, because removing `as@`'s float rows will read as
removing float → int conversion. `bool`, `u8`, `u16` and `i31ref` are not the same size as
anything and stay out under rule 2, which the prose should say, since "same size" invites
the question.

## Why it is worth doing anyway

Not bit purity. Today `x as@ i32` on a float picks truncation *and* saturation for you and
shows neither. Afterwards the choice is in the source:

```wac
x.trunc() as! i32     // truncate, trap if it does not fit
x.trunc() as~ i32     // truncate, clamp if it does not fit
x.floor() as~ i32     // and floor-versus-truncate is visible too
```

## Do not start this yet

Twelve tagged spec claims are in scope — eight in `casts.md`, four in `types.md` — and
three assert behaviour this would remove: `§wac-raw-truncf-r8kf4mb`,
`§wac-raw-truncf-nan-w9fk2xq` and `§wac-raw-trunc64-p4jn2wq`. It is a spec-and-tests
change rather than a doc edit, it touches 100 call sites in a shared tree, and the
`toBits` question above has no agreed answer.

Sequencing, once it is agreed, so the tree is never uncompilable: add the float methods and
`low32`/`high32` with their tags → migrate the 100 call sites → narrow `as@` and resolve
`toBits` → rewrite `casts.md` and `types.md`. Four commits, each green.
