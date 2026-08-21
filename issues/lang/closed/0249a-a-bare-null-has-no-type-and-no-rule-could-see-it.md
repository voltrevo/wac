# 0249a — a bare `null` has no type, so the rules about it never fired

- **Status:** closed
- **Closed by:** agent-a, 2026-08-21 — two guards, one line each
- **Fixed in:** `packages/wacc/src/check.wac`, with three rows in
  `packages/wacc/test/wac/illtyped_test.wac`
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** diagnostic
- **Symptom:** no error from the checker; the emitter declines the whole module with the reason `null`

## Reproduction

```wac
export bool f() { return null is null; }
```

    wac check   1 file(s), no diagnostics
    wac build   wacc: cannot emit … — the exported function `f` is not in the module the
                emitter produced — null
    reference   'is null' requires a reference type, got null

Three shapes, all the same:

| program | reference | `wac check` | `wac build` |
|---|---|---|---|
| `null is null` | refused, by name | silent | declines — `null` |
| `null is not null` | refused, by name | silent | declines — `null` |
| `null!` | *"'!' unwrap requires nullable type, got null"* | silent | declines — `null` |

## Why

`spec/spec/types.md`: *"`null` is a keyword literal with **no type of its own**. It can be used anywhere
a nullable type (`T?`) is expected — the compiler infers the type from context."* In `null is null`
there is no context to infer from, so the operand has no type — and both rules that would refuse it are
keyed on the type it does not have:

```wac
string lt3 = typeOfExpr(c, left);
if (isValueType(lt3) || (!(target is null) && startsWithFn(lt3))) { … }   // lt3 is typeNone
```

```wac
string ut2 = typeOfExpr(c, operand);
if (withoutNull(ut2) == "" && (isPrimitiveName(ut2) || … )) { … }         // ut2 is typeNone
```

So this is `issues/lang/0170a`'s item 3 again — *unknown* flowing into a rule that treats not-knowing
as nothing-to-say — and the sixth instance of it found in two days. One line each fixes it, asking
`litKindOf(…) == litNull()` beside the type test, and reporting through the codes those rules already
own so the messages match the reference's wording.

## What the spec does and does not say

`[§wac-isnull-kxsqi4g]` reads *"`null is null` is `true`"*, which looks like this program being legal.
It is not: the tag's **runnable case** is

```wac
Point? p = null;
return p is null;
```

— a null reached through a *typed* variable, which compiles and answers `true` in both compilers. The
sentence is about the semantics of a null reference, not about the literal form, and the literal form
has no type for `is` to test. Checked before changing anything, because a rule stated in prose with an
unrunnable example is exactly the shape that gets "fixed" the wrong way.

## And two shapes deliberately left alone

`null == null` and `null != null`: the **reference accepts them**, and wacc's emitter declines. So wacc
is *stricter* than the reference here, which is the direction this package minds least but still a
divergence, and it is not obvious who is right. `spec/spec/operators.md` refuses `==` on every nullable
*reference* form — `N?`, `E?`, `i32[]?`, `string?` — on the grounds that they "would have to answer for
null before [they] could compare anything", which reads as an argument for refusing two bare nulls too.
Left as it stands rather than picked: the emitter already refuses them, so nothing ships, and making
`wac check` agree would mean either adopting a rule the reference does not have or relaxing one the
spec implies.

Recorded here rather than in its own issue because it is one sentence of the same investigation, and
splitting it would move this paragraph rather than add anything.

## Canary

The three rows went into `illtyped_test.wac` as a32–a34 and both guards were then removed: exactly
those three fail — *"a32 null is null: accepted an ill-typed program"* — and the other six tests pass.
The legal forms are pinned by the same file's controls and by the spec corpus: `P? p = null; p is null`,
`q!` on an `i32?`, and `p is null` on a *non-null* struct, which the spec allows and warns about.

`corpuscheck` green over the repository, `typecheck` rung 3 with 0 false alarms and 0 contradicted,
`cases`, `specsingle`, `specmulti`, `warnings`, `codes` green.
