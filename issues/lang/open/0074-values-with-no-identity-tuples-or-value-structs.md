# 0074 — values with no identity: tuples, or value structs

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-06
- **Kind:** missing feature
- **Symptom:** not implemented

Filed because the blocker is a set of decisions, not the work. The operator asked for tuples specifically
and wants the design settled later; this is what the decision looks like, with the measurements that
motivated it already taken.

## Where it came from

`packages/crypto/src/chacha20.wac` held its sixteen state words in a `u32[16]` because of this, written
above `quarterRound` at the time:

> Written against indices rather than values because wac has no way to return four words at once, and no
> out-parameters — the array *is* the tuple.

Moving that state into sixteen `u32` locals and writing the double round out made ChaCha20 **4.7x faster**
(73 → 343 MB/s; 3.5x of it from the locals alone, the rest from hoisting a per-block allocation).
wac-mono 0035 has the numbers, and agent-b measured the same shape in `packages/bls` at −64% with the
instruction count unchanged. A GC array access is `local.get`, `i32.const`, `array.get` **and a bounds
check**; a local is one instruction and no check.

The language feature that would have made the fast version the natural one to write is a way to return
several words at once. Hand-inlining is what we did instead, and it is not available everywhere: carry
chains want `(sum, carry) = addc(a, b, carry)`, and `divmod` wants `(q, r)`.

## The crux: this is a lowering rule, not syntax

**A tuple only helps if it is a value with no identity, exploded into locals at every use.** If
`(u32, u32, u32, u32)` lowers to a WasmGC struct it is *worse* than the array it replaces: the same heap
traffic, plus one allocation per quarter round rather than one per block. Whatever the syntax, the spec
text has to say the compiler is required to keep these in locals, or a later reader will "simplify" them
into `struct.new` and undo the entire point.

Everything else follows from no-identity: no aliasing question, no interaction with `const this` (0052,
0060), no null, no `is`/`as!`.

## Measured: no inliner is needed, on V8

wac has no inliner, so `(u32,u32,u32,u32) quarterRound(u32,u32,u32,u32)` keeps the call that hand-inlining
removed. At the granularity that matters — 5.2 million quarter rounds, which is 4 MB of ChaCha20 — the call
costs nothing:

```
viaCall    26.4 ms   (5.07 ns per quarter round)
viaInline  26.3 ms   (5.05 ns per quarter round)
overhead:  0.02 ns per call
```

V8 inlines a function that size completely. The probe is two exports over the same arithmetic, one calling
a four-argument helper per iteration and one with the body written out, compiled with `wacCompile` and run
on a raw instance:

```wac
u32 qr(u32 a, u32 b, u32 c, u32 d) {
  a += b; d ^= a; d = rotl(d, 16);
  c += d; b ^= c; b = rotl(b, 12);
  a += b; d ^= a; d = rotl(d, 8);
  c += d; b ^= c; b = rotl(b, 7);
  return a ^ b ^ c ^ d;                 // folded so nothing can be elided
}
export i32 viaCall(i32 n) {
  u32 acc = 1;
  for (i32 i = 0; i < n; i++) { acc = qr(acc, acc + 1, acc + 2, acc + 3); }
  return acc as~ i32;
}
// viaInline: the same body, written out in the loop.
```

**Caveat, and it matters for wac-mono 0087:** that is V8. Cranelift's wasm inlining is much younger, so
under wasmtime the same feature may need wac to inline, or may cost a call per use. Nobody should quote the
0.02 ns as a property of wasm.

## The decisions

### 1. Anonymous tuples, named value structs, or tuples as sugar over value structs?

Tuples would be wac's **first structural type**. Everything else in the language is nominal, deliberately —
it is why `Decoded`, `Change` and `Proved` are structs rather than shapes, and it is the premise
[wac-mono#47](https://github.com/voltrevo/wac-mono/issues/47) is currently re-examining for package
versioning. `(u32, u32)` and `(u32, u32)` being interchangeable is exactly right for `divmod` and exactly
wrong when one is a quotient and the other is a slot index.

The nominal version with identical codegen:

```wac
value struct Quarter { u32 a; u32 b; u32 c; u32 d; }
Quarter quarterRound(Quarter q) { … }
```

Same rule — no identity, lives in locals — with a name to hang a doc comment on and no silent substitution
of a `Carry` where a `DivMod` was meant. Tuples are then anonymous sugar over the same lowering.

The operator's stated preference is **tuples**. The recommendation from here is tuples *with* the
value-lowering rule as the primary spec text — and if only one lands, `value struct` is the one that fits
the rest of the language.

### 2. Return position only, or a full type?

Return position, parameters and locals is the smallest thing that gets ChaCha, and it is entirely register
allocation. A full type has to answer `(u32,u32)[]` and tuple-typed struct fields, which forces a memory
representation and is most of the work. Starting narrow does not foreclose it.

### 3. Destructuring syntax

wac declares with types, so:

```wac
(u32 q, u32 r) = divmod(n, d);              // declaration
(a, b, c, d) = quarterRound(a, b, c, d);    // assignment — a new statement form
```

The second is what ChaCha needs, and multiple lvalues is new grammar.

### 4. Does a tuple cross bindgen?

A tuple-returning export could become a JS array, or be refused at the boundary. Refusing is defensible,
simpler, and can be relaxed later.

### 5. Arity

Each element is a wasm local and a multi-value result. Some bound exists; say what it is rather than
discovering it.

## Constraints inherited from generics — agent-b, 2026-08-26

`design/lang/0011` was accepted the same day, and it commits the parser to reading
`name < types >` as an instantiation when the following token cannot continue a comparison, or when
that token is `(`. Parentheses are the documented escape for the contested case. That makes three
choices here **load-bearing rather than stylistic**, and they are cheap only if taken deliberately:

1. **`(x)` must stay pure grouping**, with a one-element tuple spelled `(x,)`. The escape hatch for
   the ambiguity is `((a < b), c > (d))` — parenthesising the element that contains the `<`. If `(x)`
   became a one-element tuple, that would change the element's type and the escape would stop
   working. Python and Rust both spell a 1-tuple with the trailing comma, so this is the ordinary
   choice; what is new is that it is now depended upon.

2. **`(a < b, c > d)` must stay unambiguous**, which it is as long as the instantiation trigger keeps
   requiring `(` *immediately* after `>`. That shape — a tuple of two comparisons — is the natural
   thing to write, so it is the one worth protecting. Only the parenthesised-right-operand form,
   `(a < b, c > (d))`, is contested, and it reads as an instantiation.

3. **A tuple type in type-argument position carries its own parentheses**: `f<(A, B)>(x)`. Worth
   stating so nobody reaches for a bare `f<A, B>` intending a single tuple argument.

None of this argues against tuples or against any option above. It is written here because the
person designing them is the one who needs it, and none of it is discoverable from the tuple side.

## The family this belongs to

Three open issues are the same complaint — **a value that does not need identity is being given one**:

- [0030](0030-payload-less-enum-as-integer.md) — a payload-less enum allocates instead of being an integer.
- [0071](0071-no-addressable-scratch-a-stack-storage-class.md) — `stack` scratch, which is linear memory:
  static offsets and no bounds checks, better than a GC array and **not** as good as locals.
- This one.

Worth one design note covering all three rather than three features that each solve a third of it. If the
answer to "which values live in locals" is settled once, 0030 falls out of it and 0071's scope shrinks to
the genuinely addressable cases.
