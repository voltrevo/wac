# 0347a — 257 string accumulations in loops, and `Buf` cannot take a `string`

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** performance
- **Symptom:** quadratic output building, worst in the compiler

`core/README.md` names this and does not count it:

> **A string builder.** `bytes`' `Buf` is the byte-level answer; repeated `s + t` is quadratic and
> nothing here fixes that.

Counted. Function-scoped — a local declared `string x = …` and later assigned `x = x + …` inside a
`for` or `while` in the same function: **257 sites across `packages/*/src` and `tools/`.**

```
50  packages/wacc/src/emit.wac          15  packages/wacc/src/check.wac
39  packages/wacc/src/manifest.wac      10  packages/wac/src/testrun.wac
23  packages/wacc/src/bindgen.wac       10  packages/sh/src/lex.wac
15  packages/wacc/src/api.wac            9  packages/sh/src/exec.wac
                                         7  tools/wac/map.wac
```

`"a" + "b"` is a call to the runtime's ` str_concat` — `packages/wacc/src/emit.wac:346` says so — so
each append allocates a fresh string of the combined length. Accumulating `n` pieces into an output
of length `L` copies about `n·L/2` bytes. **142 of the 257 are in `packages/wacc`**, which runs over
every source file in this repository.

## The byte builder exists and is one method short

`packages/bytes/src/buf.wac` has `push`, `pushU16`, `pushU32`, `pushDecimal`, `pushBytes`, `pushAll`,
`pushCodepoint`, `pushRepeat`, `take`, `bytes` and **`toStr`**. It can produce a `string` and it
cannot consume one: there is no `pushStr(string)`.

So today a site that wants the linear version writes `buf.pushAll(s.toBytes())`, which allocates a
`u8[]` per append. That is linear overall rather than quadratic, so it is already the better trade —
and it is verbose enough at 257 sites that nobody has done it.

The asymmetry is exact. `toStr` is two lines:

```wac
  /** The contents as a string, taking them to be UTF-8. */
  string toStr(const this) {
    return string.fromBytes(this.bytes());
  }
```

and `void pushStr(this, string s) { this.pushAll(s.toBytes()); }` is the same two lines in the other
direction. **Somebody wrote the convenience for getting a `string` out and not the one for putting a
`string` in**, and the second is the one 257 sites want.

## The 257 are two different problems and a `Buf` fixes one of them

Broken down by function, `emit.wac`'s 50 are not building documents. They are building **type
names**: `bindTypesOf` 14, `lambdaReportLinked` 6, `methodInstance` 3, `typeOfTyName` 3,
`bindTypeSpelling` 3, then `signatureOf`, `emittedSigOf`, `boundSignatureOf`, `envSig` and the rest.
That is the canonical-name machinery, and `packages/wacc/src/check.wac` says why it runs constantly —
*"the model here is that a type **is** its canonical name, so the name has to carry the arguments"*,
and *"string against string, because in this checker a type is its canonical name"*.

A type name is twenty characters built from three or four pieces. `n·L/2` is nothing there; the cost
is **three or four allocations per name, on a path that computes names constantly**. A `Buf` per call
is *worse*, because the `Buf` is an allocation too.

`manifest.wac`'s 39 are the opposite: one long document assembled once per build, which is exactly
what the README's sentence describes and exactly what a builder fixes.

> **So 257 is the count of a *shape*, and the shape has two costs.** Short strings built often want
> fewer pieces or an interned name; one long string built once wants a builder. Only the second is
> the quadratic one, and sorting the 257 into the two buckets is the work this issue is really asking
> for.

## Why it is filed rather than fixed

The method is small. **The 257 conversions are not**, they are spread over eight packages including
the compiler, and each one is a behaviour-preserving rewrite that has to be read: several of the
sites build a separator conditionally (`out = out + (n > 0 ? ", " : "") + x`), which is a fold rather
than an append and does not transcribe mechanically.

And the ordering matters: `pushStr` in `packages/bytes` is worth having whether or not anything is
converted, and converting `packages/wacc`'s 142 is the piece with a measurable payoff and the widest
blast radius. Those are two changes, not one.

## Notes

No measurement. The claim that this is quadratic is from the emitted call rather than from a clock,
and the number that would justify the sweep is a compile-time comparison before and after converting
one hot file.

**`manifest.wac` is the experiment to run, and the reason is its differential rather than its size.**
Its 578 lines build JSON by concatenation, and its own header says the output is checked
**byte-identical** against `packages/platform/native.ts`'s derivation with `cmp`, *"down to `[]` for
an empty array"*. So a conversion there is verified rather than reviewed: any byte that moves fails
loudly, which is exactly what a 39-site behaviour-preserving rewrite wants and what the other seven
files do not have.

Related: `issues/system/0333a` is the mirror gap at the byte level — `Buf` has eleven ways to add and
one way to remove, and nothing shortens from the back.

Found while checking `core/README.md`'s *what is not here yet* list, two of whose other entries turned
out to be wrong (`issues/system/0345a`). This one is right and had never been sized.
