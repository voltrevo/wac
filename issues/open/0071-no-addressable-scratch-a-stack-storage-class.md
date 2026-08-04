# 0071 — no addressable scratch: a `stack` storage class

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-04
- **Kind:** missing feature
- **Symptom:** not implemented

Part B of a two-part proposal. Part A is 0070, which does **not** depend on this. **Read 0070 first
and consider doing only that**, for the reasons under *Whether this is worth it* below.

Full design: `~/notes/living/wac/stack-lifetime-design-v6.md`.

## What

A storage class, in the C sense — `static`, `register`, `auto`, `stack`. It says: this value has
automatic storage duration bounded by the enclosing block, and it cannot escape.

```wac
stack u8[4096] buf;                  // constant size, zeroed
stack u32[16] state = zero;          // explicit
stack u8[input.len()] copy = input;  // copy-in, skipping the redundant zero
stack u8[n] dyn;                     // dynamic size
stack wipe u8[32] key;               // zeroed on entry AND on exit
```

The bytes live in a private linear memory managed as a stack. Because the lifetime is LIFO and
statically bounded there is no collector and nothing to free — the frame pointer is restored where
the compiler already drops locals, and `return`/`break`/`continue` need no new rules.

The point is that linear memory is **addressable**: `v128.load` reads sixteen bytes in one
instruction, and there is no WasmGC equivalent at any proposal level.

## Type rules — a syntactic non-escape proof

The type is `stack T[]`, second-class: passed **down**, never **up** or **aside**.

| position | allowed |
|---|---|
| local declaration, parameter | yes |
| return type, struct field, array element, inside `fn[…]` | **no** |

Plus: single-assignment (write through it, never rebind), and `==` on handles is rejected so address
identity stays unobservable and the compiler may reuse space between non-overlapping bindings.

Six syntactic rejections and one assignment rule. No inference, no lifetime variables, no borrow
checking. On a parameter, `stack` is a **provenance** qualifier — it requires stack-linear storage
from the caller, which is what makes wide and vector loads legal. The consequence, accepted for v1:
a `stack u8[]` parameter cannot be called with a heap array.

## What makes this substantially bigger than 0070

- a memory section, so the artifact is no longer memoryless;
- two mutable globals (frame pointer, wipe high-water mark) — the only global mutable state I would
  accept anywhere in wac;
- **trap recovery**, because a wasm trap skips cleanup and leaves the pointer advanced. Since `trap;`
  is wac's refusal idiom and `wacx` has an exit code for it, a host catching an exception and calling
  again is the ordinary case, not exotic. Resolution: reset at export entry, **enforce**
  non-reentrancy in the generated wrapper (not merely document it — the failure mode is silent
  corruption of a suspended frame), and export one recovery function `__wac_stack_recover` because
  the memory is private and the host cannot wipe it directly;
- `wipe`-after-trap via a monotone high-water mark: a counter that only goes up is trustworthy after
  a trap, because over-wiping costs time and never correctness;
- bulk memory (`memory.fill`, `memory.copy`) becomes wanted, which needs its own floor decision —
  and note bulk memory is *older* than SIMD, so the compatibility reading of its current exclusion
  is false and something else has to carry it;
- `ctTrace` must cover scalar and vector loads and stores, effective addresses, logical buffer
  identity, and the copy-in/fill/wipe paths. Acceptance criteria, not a follow-up.

## Whether this is worth it

**There is no wasm instruction that copies between a WasmGC array and linear memory.** `array.copy`
is GC-to-GC, `memory.copy` is linear-to-linear. So bridging in from a heap `u8[]` is irreducibly
element-wise, at about 32 instructions per 16 bytes — **which is what Part A's vector packing costs
anyway.**

For data read N times: Part A costs `32N`, Part B costs `32 + N`.

| N | | |
|---|---|---|
| 1 | 32 / 33 | Part B is slightly **worse** |
| 10 | 320 / 42 | ~7.6× |

**So this is worth nothing on a single pass, and its value is linear in re-reads.** That disqualifies
most of what motivated it: UTF-8 validation, base64 and `memcmp` all read each byte once and are a
wash.

What survives:

1. **LZ77 match extension** — the search window is compared against every candidate on the hash
   chain, so it is re-read dozens of times. ~13× on the 16-byte compare, **~2–4× on whole-file gzip
   compression**. This is the strong case and essentially the only one.
2. **Data born in the buffer** — computed scratch pays no bridge at all.
3. Multi-stage internal pipelines staying linear between the ends.

**The honest question is whether one workload justifies all of the machinery above.** It may not.

## The unknown that would change the answer

If `platform`'s `recv`/`readFile` could deliver bytes **directly into a stack buffer**, the bridge
disappears for exactly the streaming workloads where it is currently fatal, and UTF-8 validation goes
from ~1.7× back toward the ~10× the literature reports for SIMD validation. That is a `platform`
proposal rather than a language one — it needs a capability that writes into private memory without
exporting it.

**This should not be decided finally until that is settled**, or it risks being rejected for a cost
that is about to be removed.

## The deciding benchmark

Two hand-written variants — `v128` with GC-array packing, and `v128` with linear memory — over
**complete operations**, so the bridge is counted at both ends. On **LZ77 match extension**, not on
UTF-8 validation: an earlier draft nominated UTF-8, which on this analysis would show no gap and
could kill the feature for the wrong reason.
