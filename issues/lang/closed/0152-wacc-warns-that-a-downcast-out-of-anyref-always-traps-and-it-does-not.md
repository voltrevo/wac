# 0152 — wacc warns that a downcast out of `anyref` always traps, and it does not

- **Status:** closed
- **Fixed in:** this commit
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

## Fixed — 2026-08-20

`shareAncestor` walks the struct parent chain, and **nothing declares `anyref` as a parent** — so the
walk ran off the end and answered "no common ancestor" for a cast that always succeeds. Two lines,
using the condition `assignable` already applies to an `anyref` slot:

```wac
if (ac == "anyref") { return bc == "i31ref" || isReferenceType(c, bc); }
if (bc == "anyref") { return ac == "i31ref" || isReferenceType(c, ac); }
```

`i31ref` is named separately for the reason `assignable` names it separately: an integer packed into a
reference is a reference, and that is the whole point of the type.

**wacc and the reference now agree on all three shapes**, which is what makes this a closed divergence
rather than a quietened warning:

| program | wacc | reference |
|---|---|---|
| `anyref as! S` — the report | no warning | no warning |
| `A as! B`, unrelated structs | warns | warns |
| `anyref as! i31ref` — `casts.md`'s own spelling | no warning | no warning |

And `anyref as! i32` is still `wrong cast operator for these types`: a **primitive** shares nothing with
`anyref`, so the fix does not reach it.

Pinned in `packages/wacc/test/wac/warnings_test.wac`, beside the rule it belongs to, because that file
exists for exactly this — *"the direction that matters is the false alarm"*. Not in `spec/cases`, whose
expectations cannot express "does not warn". **Canaried by reverting the two lines:** the test fails with
`warned on a downcast out of anyref, which succeeds`, and the unrelated-structs case in the same test
keeps passing — so the rule was fixed rather than lost.

Measured: 221 of 221 cases, 53 typecheck cases, the generated sweep clean, specEmit 419/419, and
std/platform, box and wacc's own example all still check.