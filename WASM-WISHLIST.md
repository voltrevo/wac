# What WebAssembly is missing, from a language that targets it

A running list. Each entry is something wac or [wac-mono](https://github.com/voltrevo/wac-mono)
wanted from WebAssembly and could not have, with the code that works around it and what the
workaround costs.

**This is not a list of wac's own gaps.** Those live in [`issues/`](issues/). The distinction
matters and is easy to get wrong: integer rotate looked like a missing wasm instruction until
someone checked and found `i32.rotl` has existed since 2017 and it was wac that had no way to spell
it (issue 0069). Every entry here should be checked the same way before it is believed.

## Why this evidence is worth collecting

The people who report WasmGC's rough edges are mostly bringing Java, Kotlin, Dart or Scheme —
object-graph languages, where the arrays are arrays of references and the hot loops are method
dispatch. The people who report linear memory's rough edges are bringing C, C++ and Rust, which
never touch a GC array at all.

wac is in a corner neither occupies: **a GC-first language doing byte-heavy systems work.** 41,000
lines of it — TLS 1.3, SSH, a Tor client, gzip, Zstandard, BLS12-381 pairings, SHA-2, ChaCha20 —
with no C runtime underneath and no linear memory in the artifact at all. That combination is rare
enough that several of the entries below are probably not in anyone's issue tracker, because the
languages that would hit them have a `memcpy` and the languages that have GC arrays are not
parsing wire protocols with them.

Entries are marked **verified** (checked against the emitter, a spec document, or a measurement),
**believed** (confident but unconfirmed), or **speculative** (a wish, not a gap).

---

## 1. Nothing copies between a GC array and linear memory

**verified** — `array.copy` takes two array *type indices*; `memory.copy` takes two memory
operands. There is no instruction with one of each, and no proposal for one.

The consequence for a GC-first language is severe and non-obvious. Suppose you want SIMD. Vector
loads read linear memory, so your bytes have to get there, and the only way is element by element:

```
for each byte:
    array.get_u   heap[i]
    i32.store8    base + i
```

That is 32 instructions per 16 bytes — **which is what assembling a `v128` from the GC array costs
anyway** (16 × `array.get_u`, `splat`, 15 × `i8x16.replace_lane`). So for data read once, moving it
to linear memory to use SIMD is a wash, and the whole benefit only appears when the same bytes are
re-read: cost is `32N` versus `32 + N` for N reads.

**What it cost us.** A design for scoped linear-memory scratch
(`~/notes/living/wac/stack-lifetime-design-v6.md`, issue 0071) was justified on byte-stream
workloads — UTF-8 validation, base64, `memcmp`. Costing this bridge disqualified all three, because
each reads every byte once. Published SIMD speedups for those workloads (simdutf reports ~10× for
UTF-8 validation) assume data already in native memory; charged for the bridge they come out around
1.7×. **No figure in the SIMD literature was measured across a WasmGC boundary, because no other
language has one.**

**What would fix it.** Either direction of bulk copy between an `(array i8)` and a memory —
`memory.init_array` / `array.copy_from_memory`, by analogy with `array.new_data`, which already
copies a passive data segment into a GC array and shows the machinery is not alien to the design.

---

## 2. GC arrays can only be read one element at a time

**verified** — `array.get` and its signed/unsigned variants take a single index. There is no
multi-element form, and no way to read four bytes of an `(array i8)` as an `i32`.

Every byte-oriented format therefore pays a per-word tax:

```wac
// packages/crypto/src/layout.wac:28
export u32 beWord32(u8[] b, i32 i) {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) as@ u32;
}
```

Four bounds-checked loads plus six shift/or operations, about ten instructions, where an
`i32.load` from linear memory is one. This is called for every word of every SHA-2 block, every TLS
record header, every Tor cell, every gzip and Zstandard header.

**Related and equally blocking: there is no `v128.load` from a GC array.** SIMD's entire input path
is linear memory, so a language whose byte type is a GC array is locked out of vectorisation for
exactly the workloads vectorisation was designed for. Entry 1 is the workaround and it costs as much
as it saves.

**What would fix it.** A widening multi-element load on packed arrays — `array.get_i32` on an
`(array i8)` at a byte index, and `v128.load_array`. The bounds check is one comparison against
`len - 3` rather than four separate ones, so it should also be *cheaper* than what it replaces, not
merely fewer instructions.

---

## 3. There is no byte swap

**verified** — no `i32.bswap` at any proposal level. The only byte-reversal primitive anywhere in
WebAssembly is `i8x16.shuffle`, which requires SIMD and therefore linear memory (entry 1).

Wasm loads are little-endian. **Most network protocols are big-endian**, including every one in
wac-mono: TLS, SSH, Tor, and SHA-1/SHA-2's message schedule. So even with linear memory, reading a
big-endian word is `i32.load` plus a hand-rolled six-operation swap — which is why moving SHA-256 to
linear memory would gain almost nothing, while the same change for a little-endian format like
ChaCha20 or Zstandard would gain a lot.

That asymmetry is invisible until you work it out, and it inverted a conclusion in our own design
document: SHA-256 looked like the obvious motivating example for linear memory and turned out to be
one of the weakest.

**What would fix it.** `i32.bswap` / `i64.bswap`. Single instructions on every target
architecture — x86 has `bswap`, ARM has `rev`.

---

## 4. SIMD has no rotate

**believed** — there is no `i32x4.rotl` in fixed-width SIMD. Scalar wasm has had `i32.rotl` since
MVP, so this is an asymmetry rather than a general absence.

Every vector rotate is `shl`, `shr_u`, `or` — three instructions. In a vectorised ChaCha20 half-round
that is **12 of the 20 instructions**:

```wac
a = a.addI32x4(b); d = d.xor(a); d = d.rotlI32x4(16);   // 1 + 1 + 3
c = c.addI32x4(d); b = b.xor(c); b = b.rotlI32x4(12);   // 1 + 1 + 3
a = a.addI32x4(b); d = d.xor(a); d = d.rotlI32x4(8);    // 1 + 1 + 3
c = c.addI32x4(d); b = b.xor(c); b = b.rotlI32x4(7);    // 1 + 1 + 3
```

Rotation is not a niche operation in this domain. ChaCha20, Salsa20, BLAKE2, BLAKE3, SHA-1, SHA-2
and Keccak are all built from add-rotate-xor, and a rotate-per-round is the shape of the entire
family. A single `i32x4.rotl` would take that half-round from 20 instructions to 12.

**What would fix it.** `i32x4.rotl` / `rotr`, and the `i64x2` pair. x86 has no direct lane rotate
before AVX512, so an engine would lower it to the same three operations — but on ARM and on AVX512
it is one, and more importantly the *engine* is the right place to know that.

---

## 5. No widening multiply and no add-with-carry

**verified in effect** — `i64.mul` yields the low 64 bits of a 64×64 product, and there is no
access to a carry flag. Both are architecturally universal and neither is reachable.

This is not an inconvenience, it decides a data structure. `packages/bls`'s BLS12-381 base field
holds a 381-bit prime in **twelve 32-bit limbs**:

```wac
// packages/bls/src/fp.wac:6
// 381 bits, held in twelve 32-bit limbs least-significant first.
```

Twelve, not six, because a 64×64 product cannot be observed — so limbs are kept at 32 bits and
products accumulated in `u64`, where the high half is recoverable with a shift. `packages/bignum`
does the same:

```wac
// packages/bignum/src/big.wac:201
u64 t = (r.limbs[i + j] as u64) + x * (b.limbs[j] as u64) + carry;
```

Montgomery multiplication is quadratic in limbs, so twelve limbs is **144 limb products where six
would be 36** — around 4× the multiply work, before counting the extra carry handling. agent-b
measured `montMul` at **45% of a BLS signature verification**, and the whole field kernel at 84%,
so this is not a marginal cost in a corner.

**What would fix it.** Either a widening `i64.mul_wide` producing two results, or a
carry-propagating add (`i64.add_carry`). Every 64-bit ISA has both; wasm exposes neither, and the
result is that every bignum on the platform runs on half-width limbs.

---

## 6. No crypto acceleration of any kind

**believed** — fixed-width SIMD has no AES round instructions, no SHA round instructions, and no
carry-less multiply (`pclmulqdq`).

`packages/crypto` implements AES-GCM because TLS 1.3 requires it, and it is table-driven — which
means it is both slower than the hardware by a large factor and harder to make constant-time,
since S-box lookups are memory-indexed. wac has a constant-time tracer (`ctTrace`) specifically to
find that class of leak, and the leaks it finds in AES are unavoidable in a table-driven
implementation.

The alternatives are bitslicing (a rewrite, and slower than hardware) or `i8x16.swizzle` as a
16-byte register-only lookup (constant-time, but 16 swizzles and selects for a 256-byte S-box).

**What it costs.** AES-GCM is the most-executed cipher on the internet and the wasm platform cannot
reach the instruction that implements it, on hardware that has had it since 2010. GHASH's
carry-less multiply is in the same position.

**What would fix it.** The AES and SHA instruction families, as relaxed-SIMD-style operations
whose availability a module can query. This is a bigger ask than the others — it is
hardware-specific in a way wasm has generally avoided — but the security argument is unusual:
here the *portable* implementation is the one with a timing side channel.

---

## 7. Nothing runs when a trap unwinds

**verified by consequence** — a trap transfers control to the host without executing any cleanup in
the module, and the instance remains callable afterwards.

For a language whose refusal idiom *is* trapping, this is a design constraint rather than an edge
case. wac uses `trap` for every unrecoverable rejection and `wacx` has a dedicated exit code for
"ran and trapped", so a host catching an exception and calling another export is ordinary use.

Our design for scoped scratch (issue 0071) needs three separate mechanisms purely because of this:
a frame-pointer reset at every export entry, an exported `__wac_stack_recover` function because the
private memory cannot be reached from the host, and an *enforced* non-reentrancy rule in the
generated wrapper — because a depth counter in a global does not survive a trap either. After a trap
you cannot trust any mutable global, which is why the only trustworthy recovery state we could find
was a monotone high-water mark: a counter that only ever increases is safe to over-read.

**What would fix it.** The exception-handling proposal's unwinding would cover it, at the cost of a
higher engine floor. A narrower mechanism — a module-level "on trap" function the engine calls
before returning control — would be enough and would cost nothing to modules that do not use it.

---

## 8. Speculative: bounds checks a language can prove away

**speculative** — a wish, and possibly a bad one.

Every `array.get` is bounds-checked with no way for a producer to say the index is provably in
range. The cost is not theoretical: agent-b cut a BLS field multiply by **64% with no change to its
instruction count at all**, largely by moving operands out of GC arrays into locals — the win was
per-access overhead, not operation count.

A language with its own type-level proof that an index is in range currently has no way to convey
it, so the engine re-checks what the producer already knows.

**Why it might be a bad idea.** Wasm's safety story is that the *engine* guarantees memory safety
regardless of what the producer claims, and an unchecked access primitive hands that away to
whoever generated the module. A `get_unchecked` would be the single most attractive instruction in
the set for a compiler bug to reach. Worth writing down as a want; not worth advocating without a
much better answer to that.

---

## Adding an entry

Keep the standard high, because a list of unsubstantiated wishes is easy to ignore and this is
meant to be usable as evidence:

1. **Check it is actually missing.** Search the emitter and the spec first. Rotate spent a day on
   this list before someone found `i32.rotl` in the MVP and moved it to `issues/` as a wac gap.
2. **Name the code that works around it**, with `file:line`. An entry without a real call site is a
   preference.
3. **Quantify the workaround**, measured if possible and modelled if not — and say which. Two
   figures on this page were modelled, wrong, and corrected by someone who measured.
4. **Say what would fix it**, concretely enough to argue with.
5. **Mark it verified, believed, or speculative**, and be honest about which. Several proposal
   statuses here are from memory: this sandbox has no network, so nothing on this page has been
   checked against the current proposal list or caniuse.

An entry that stops being true should move to a `## Resolved` section with the version that fixed
it, rather than being deleted — the history is part of the argument.
