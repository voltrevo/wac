# 0070 — no SIMD: a `v128` primitive and its intrinsics

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-04
- **Kind:** missing feature
- **Symptom:** not implemented

Part A of a two-part proposal. Part B is 0071 and this does **not** depend on it.

Full design, six drafts and three rounds of external review:
`~/notes/living/wac/stack-lifetime-design-v6.md`.

## What

A `v128` primitive type and a set of compiler intrinsics over it.

```wac
v128 c  = a.xor(b);              // v128.xor
v128 s  = a.addI32x4(b);         // i32x4.add
v128 r  = a.rotlI32x4(12);       // shl | shr_u | or — no rotate opcode exists
v128 wl = a.extmulLowU32x4(b);   // i64x2.extmul_low_i32x4_u — two 32x32→64 products
v128 q  = a.swizzle(indices);    // i8x16.swizzle, dynamic lanes
bool eq = a.eqI8x16(b).allTrueI8x16();
i32 lane = a.extractI32x4(0);    // immediate lane index
```

Lane interpretation lives in the **method name**, not the type, so the checker only has to know "is
it a `v128`" and there is no family of `u8x16`/`u32x4`/`i64x2` types.

Two categories, worth keeping apart in the docs because it matters for instruction accounting and
for `ctTrace`: **direct operations** (one method, one instruction) and **compiler macros** (one
method, a fixed sequence — `rotlI32x4`, `bswapI32x4`, `rotateLanesI32x4`). Both are intrinsics
rather than `std` functions, because there is no inliner and ChaCha would otherwise make 320 calls
per block.

For v1: allowed in locals and parameters only — not struct fields, not arrays, not exported
signatures, so **bindgen is unaffected**.

## Why this is the cheap half

- **No memory section.** `v128` values live in wasm locals, so the artifact stays memoryless and the
  "no imports, nothing ambient" property is untouched.
- No type-system change, no second-class types, no frame pointer, no global mutable state, no trap
  recovery problem, no new export.

## The floor question, which gates this

wac emits no SIMD deliberately. The argument for revisiting: **SIMD's baseline is older than
WasmGC's, which wac already requires.**

| feature | Chrome | Firefox | Safari | Node |
|---|---|---|---|---|
| SIMD (fixed-width, 128-bit) | 91 | 89 | 16.4 | 16.4 |
| WasmGC | 119 | 120 | 18.2 | 22 |

The GC row is wac's own README. **The SIMD row is from memory and must be confirmed against
caniuse** — it is the load-bearing claim and neither I nor agent-b had network access. If it holds,
SIMD excludes nobody who can already run a wac module, which is a different situation from tail
calls or exception handling, and the floor policy should distinguish them rather than treating "not
in the emitter" as one category.

## Expected gain — and read the caveat first

**Every figure is modelled. Nothing has been run.**

| workload | modelled |
|---|---|
| ChaCha20 whole block | **~2.3×**, 2–3× projected runtime |
| UTF-8 validation, per 16B | ~1.7× |
| base64 encode | ~1.2×, a wash |
| LZ77 compare | **~0.95× — a regression** |
| `bls` / `bignum` / RSA | needs `extmul`, then representation-dependent — see below |

Earlier drafts said 5.4× for ChaCha. That compared a vectorised implementation holding state in
**registers** against a scalar one holding state in a **bounds-checked GC array**, and credited SIMD
for both. agent-b caught it by measuring `−64%` on `packages/bls`'s `fpMul` at an *unchanged
instruction count*, purely from moving operands into locals. `quarterRound` takes constant indices,
so the same rewrite is free for ChaCha — and against that baseline the gain is ~2.3×.

**So the honest pitch is several workloads at roughly 2×**, plus two things that are not speedups:
a register-only table lookup (`swizzle` selects lanes from a vector, so the wasm program expresses
no secret-dependent memory address — suitable for constant-time work subject to engine validation)
and a cheaper constant-time compare.

**`extmul` is not optional.** Without a widening 32×32→64 multiply, `bignum`, `bls` and RSA are
excluded by construction; `i32x4.mul` gives the low 32 bits and `i64x2.mul` the low 64 of a 64×64,
which is the same limitation scalar wasm has. agent-b measured bls's Fp kernel at **84% of a
verification** — a large addressable surface, but reaching it needs a redundant limb representation
and every constant in the package regenerated, so bls is *further* from this than the share suggests.

## Before measuring anything

Re-baseline first, or this will flatter itself by more than 2×:

1. `copyFrom`/`fill` in place of hand-written element loops (0056 landed the instructions).
2. `sha256`'s one-shot copy — wac-mono issue 0034.
3. Rotation, `clz`, `ctz`, `popcnt` — issue 0069.
4. **ChaCha's state in locals** — wac-mono issue 0035. This is the one that moved the headline.

## Acceptance criteria

`ctTrace` support is part of the feature, not a follow-up. Lane indices in
`extract`/`replace`/`shuffle` are immediates so there is nothing secret-dependent to trace, and
`swizzle`'s dynamic lanes are register-internal — but it should **record that a dynamic swizzle
occurred** without flagging it as an address leak, or reviewers lose sight of it and constant-time
constructions get false positives.
