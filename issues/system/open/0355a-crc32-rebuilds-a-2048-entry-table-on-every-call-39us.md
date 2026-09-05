# 0355a — `crc32()` rebuilds a 2048-entry table on every call: 3.9 µs, and the threshold is set at the wrong size

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** performance
- **Symptom:** at 512 bytes `crc32` is 1.7× slower than the bitwise path it just switched away from

`packages/gzip/src/crc32.wac` builds an eight-way slicing table of 2048 entries in `crcTable8()`.
The streaming API takes it as a parameter, on purpose:

> The table is a parameter rather than rebuilt per call: `crcTable8` computes 2048 entries.

The one-shot `crc32(data)` calls `crcTable8()` itself, on every call, above a threshold of 512 bytes
justified as *"Below this, building 2048 table entries costs more than it saves, so the bitwise form
wins outright."*

## Measured

`vision/bench/crcthresh.wac`. Three arms, five sizes, **total bytes held constant** at 33.5 MB per
row so the columns compare directly. Milliseconds, best of three, v8 host.

     bytes    calls   crc32  bitwise  hoisted
       256   131072     166      169       32
       512    65536     290      169       32
      1024    32768     162      169       32
      4096     8192      65      438       33
     65536      512      35      773       33

`hoisted` is `crc32Start`/`crc32Update`/`crc32Finish` with `crcTable8()` called once outside the
loop — the way the pipeline uses it.

**At exactly the threshold the table path is 1.7× slower than the bitwise path it just abandoned.**
290 against 169. The real crossover is about 1024, where the two are within 4%.

**The excess is a constant 3.9 µs per call at every size**, with no residual:

    512    (290-32)/65536 = 3.9 µs        4096    (65-33)/8192 = 3.9 µs
   1024    (162-32)/32768 = 3.9 µs       65536    (35-33)/512  = 3.9 µs

Four rows, one number — so the model is exactly one table build per call and nothing else. For a
512-byte input the useful work is 0.5 µs, so the table build is **eight times the CRC**.

**The hoisted arm is flat at 32–33 ms across a 256× range of input sizes.** That is what this
library's throughput is when the table is built once: five times `crc32` at 4096 bytes and nine times
it at 1024.

The file's own header says CRC-32 was *"the dominant cost of the whole library"* before the table
existed. For anything under a few kilobytes it is again, for the mirror-image reason.

## Why it is here

Not carelessness. The author priced the table build, wrote the price into a comment, hoisted it out
of the API that obviously runs in a loop, and left it in the API that does not look like it does.
What made that the only option is that **the language has nowhere to put a computed table.**

`spec/spec/variables.md`: a `const` initialiser must be a compile-time constant expression —
*"literals, the operators over them, casts, other constants, and construction of a struct, an enum
variant or an array out of those. Not a call — a call would have to run."* `crcTable8` is two nested
loops.

## Three fixes, and only one of them needs the language

**1. Raise the threshold to ~1024.** One line, no decision, removes the case where the table path
loses outright. Leaves 3.9 µs on every call above it. Worth doing immediately and separately,
because it is the only part that is unambiguously a bug rather than a trade.

**2. Generate 2048 literals into a `const u32[]`.** Works today. `[§wac-array-t8kn4wq]` says every
constant array is built in the module's start, so the cost becomes once per program.
`packages/unicode/src/tables.wac` already does this for 65 KB, so the pattern and its costs are
known — a generator to keep in step and a *"Do not edit"* header. This table is a better candidate
than any of the existing generated ones, because `crc32Bitwise` is a definitional oracle sitting
beside it: unlike the unicode and font tables, a test can check the generated contents against a
second implementation rather than against itself.

**3. A `static` module binding — computed once, by arbitrary code, before `main`.** Not `const`,
because it is not a constant expression; not a mutable global, because nothing may assign it after.
wasm has a start function and the compiler already emits one for constant arrays, so the mechanism
exists and only the surface is missing. This is the general fix and the only one that needs a
language change. Filed here rather than in `issues/lang/` because the evidence is this package's
number; if the language ask is taken up it should get its own entry.

A lazy `u32[]? cached` at module scope also works today and is deliberately not recommended: it
costs a null check per call, adds a mutable module-level binding, and makes the first caller pay for
everyone.

## Related

- `issues/lang/0354a` — 658 constants spelled as function calls, measured at **zero** cost. Same
  syntax gap, opposite result, and the difference is the line the language draws: those are scalars,
  which `const` inlines at every use, and this is a computed array, which `const` cannot express. A
  sweep that did not know the difference would fix the free case and miss this one.
- `packages/unicode/src/tables.wac` — the generated-literals pattern, and what it costs.
