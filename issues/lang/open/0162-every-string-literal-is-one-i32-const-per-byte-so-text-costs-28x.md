# 0162 — every string literal is one `i32.const` per byte, so text costs 2.8× in the module

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-19
- **Kind:** performance
- **Symptom:** wrong answer

## Reproduction

`packages/wacc/src/emit.wac`, the `StrLit` case of `emitExprAt`:

```wac
u8[] bytes = stringLiteralBytes(src, lexed, tok);
for (i32 i = 0; i < bytes.len(); i++) {
  fb.byte(65);          // i32.const
  fb.i32leb(bytes[i]);
}
fb.byte(251); fb.u32leb(8);   // array.new_fixed
```

Every character of every string literal becomes its own instruction. Per byte of source that is:

- 1 byte for the `i32.const` opcode, plus
- 1 byte of signed LEB128 when the character is `< 0x40`, or **2** when it is `>= 0x40` — the sign
  bit of the low seven bits is set, so it needs a continuation byte.

Lowercase letters are `0x61`–`0x7A`, so identifiers and comment prose take the three-byte path;
spaces, newlines, digits and most punctuation take the two-byte one.

Predicted from the byte distribution of the two files whose cost was measured for
`design/lang/0009` — `core/hash.wac` and `core/map.wac`, 11,033 bytes, 4,104 of them below `0x40`:

    predicted   4104 * 2 + 6929 * 3  =  28,995 bytes   2.63x
    measured    seed 800,077 -> 831,173 = 31,096        2.82x

The remainder is the per-line `+` concatenation in the generated file and function overhead, which
was separately measured at 0.1% by changing the concatenation shape.

Expected: a string literal costs about its own length, as it would through a data segment and
`array.new_data`. Actual: it costs 2.6–2.8× its length in code, and there is no data segment
involved at all.

## Notes

**This is not only about `core`.** Every string literal in every wac program pays it. `core` is
merely where it was measured, because embedding a source tree makes the multiplier visible.

**It changes a recommendation that is written down.** `design/lang/0009` costs `std`'s half of step 3
at "about 384 KB of seed" for `packages/platform/src`, and recommends against moving `platform.wac`
on that basis. That figure is 137 KB × 2.8. Through a data segment it would be roughly 140 KB, and
the objection largely goes away — so the note's own caveat, that "2.8× is a property of the current
representation rather than a law", turns out to be the load-bearing sentence.

**What I got wrong, since the note says it in a way that reads as established.** It claims the cost
is *"what a wasm module costs to carry a string literal: the bytes, plus the code that materialises
them"*. There are no bytes: it is code all the way down. I wrote that from a model of how a compiler
would do it rather than from reading `emitExprAt`, and it stood for a day next to two correct
measurements, which is what made it convincing.

## What would fix it

Emit a data segment and `array.new_data` (`0xfb 0x09`), with `array.new_fixed` kept for short
literals where a segment's own overhead is not worth it. The emitter has no data section today —
`byte(11)` in this file is the `end` opcode, not section 11 — so this is a new section to write,
its offsets to track, and the engine feature to confirm on all three hosts (V8, wasmtime, and
whatever the browser build targets). That is more than a small change, which is why this is a report
rather than a patch.

A cheaper partial: the two-byte LEB is only needed because the value is signed. Nothing else here
would change if the loop emitted the byte through a form with no sign bit to worry about — but wasm
has no unsigned `i32.const`, so that is not available, and the honest fix is the data segment.
