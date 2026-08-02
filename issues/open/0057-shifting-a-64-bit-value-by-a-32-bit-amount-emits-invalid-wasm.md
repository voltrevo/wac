# 0057 — shifting a 64-bit value by a 32-bit amount emits invalid wasm

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-02
- **Kind:** bug
- **Symptom:** invalid wasm

The type checker accepts a shift whose operands are different widths; the emitter then writes
`i64.shl` with an `i32` on the stack, and the module fails to validate.

## Reproduction

One line:

```wac
export u64 f(u64 v, i32 n) { return v << n; }
```

```
WebAssembly.instantiate(): Compiling function #0 failed:
  i64.shl[1] expected type i64, found local.get of type i32
```

`>>` and `>>>` do the same. It reproduces with a literal too — `v >> 33` inside a `u64`
expression — so it is not about where the amount comes from.

The workaround is to widen the amount by hand, which is what `packages/zstd/src/xxh64.wac` now
does throughout:

```wac
u64 rotl(u64 v, i32 n) {
  u64 k = n as! u64;
  return (v << k) | (v >> (64 as! u64 - k));
}
```

## Why it is worth fixing rather than documenting

**A shift amount is not like the other operands.** Everywhere else, mixing widths is a real
question about what the value means, and making the programmer say `as!` is right. A shift
amount is a small count — it is never the thing being widened, and there is no lossy case to
warn about, because wasm masks it to the operand width anyway. Requiring `as!` there is asking
for a cast that cannot mean anything else.

Either the checker should reject it — which would at least be honest — or, better, the emitter
should widen the amount, since `i64.shl` is defined to take its count as an `i64` and every
shift by a constant will otherwise need a cast that reads as noise.

Found writing XXH64, where every line is a shift or a rotate: the hand-widening is now more
conspicuous than the algorithm.
