# 0152 — wacc warns that a downcast out of `anyref` always traps, and it does not

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-17
- **Kind:** diagnostic
- **Symptom:** wrong answer

## What happens

`x as! S` where `x` is `anyref` draws

    warning: these types share no ancestor, so this cast always traps

The cast succeeds. `anyref` is the **top** reference type, so every reference shares it as an
ancestor, and `spec/spec/casts.md:358` documents this exact spelling as the way back down:

    i31ref x = val as! i31ref;    // ref.cast — downcast from anyref

The reference compiler does not warn. This is a divergence, not only a false alarm.

## Reproduction

```wac
export struct S { i32 v; }
export bool takes(anyref x) { S s = x as! S; return s.v > 0; }
export i32 main() { S s = S(7); return takes(s) ? 7 : 0; }
```

```
$ deno task wacx check dc.wac        # the reference
(silent)

$ wac check dc.wac                   # wacc
warning: these types share no ancestor, so this cast always traps
  --> dc.wac:2:39
   |
 2 | export bool takes(anyref x) { S s = x as! S; return s.v > 0; }
   |                                       ^
```

Expected: no warning, as the reference gives.
Actual: a warning saying the cast always traps.

**And it does not trap.** Run, the program exits 7 —
`packages/wacc/test/wac/downcast_test.wac` is that assertion, and it is green.

## Where

`packages/wacc/src/check.wac:6262`:

```wac
if (ck == kAsBang() && !c.isGeneric(fromBase) && !c.isGeneric(toBase) &&
    !shareAncestor(c, fromBase, toBase)) {
  c.warn(warnAlwaysTraps(), e.line, e.col);
}
```

`shareAncestor` walks `c.parentOf` from the source type. A struct has no registered parent, so the
walk from `anyref` reaches `""` and answers false — `anyref` is nowhere in the hierarchy it consults.

The reference guards the same rule by *kind*, `compiler/wacTypeCheck.ts:2969`:

```ts
if (from.kind === "struct" && to.kind === "struct") {
  const fe2 = entryOfType(from, ctx);
  const te2 = entryOfType(to, ctx);
  if (fe2 && te2 && !commonAncestor(fe2, te2)) {
    warnAt(ctx, `'${fn} as! ${tn}' always traps — the types share no ancestor`, line, col);
  }
}
```

`anyref` is not `kind === "struct"`, so the reference never reaches the test. Restricting wacc's
condition the same way is the obvious shape of the fix; whether the right answer is "both must be
structs" or "the source must not be `anyref`" is the part worth deciding, since `shareAncestor` is
also what `A is B` uses (`check.wac:3229`) and that one has the same blind spot.

## Notes

Found while converting `downcast.test.ts` to wac (`issues/system/0161`). It was invisible before
because the TypeScript reached the emitter through `api.emitFiles`, which does not check — so no
diagnostic from that program was ever read. The wac route asks `diagnoseGraph` first, and the warning
arrived.

The same conversion turned up that the second program in that test **never type-checked at all**:
`export bool gotNull(anyref x)` handed `null`, where references are non-null by default
(`spec/tour.wac` section 14) and the parameter has to be `anyref?`. It ran for as long as it did
because the emitter guessed its way through — `issues/lang/0105`'s hole, in a test that predates the
fix.

Two smaller things noticed beside it, neither filed separately:

- `wac check` prints the warning and then says `1 file(s), no diagnostics`. A warning is a
  diagnostic; the summary counts only errors.
- The byte-for-byte generator differential and the emit sweep evidently carry no program that
  downcasts out of `anyref`, or this would have shown as a diagnostic mismatch long ago. That is a
  corpus gap rather than a second bug, but it is the reason a divergence this plain survived.
