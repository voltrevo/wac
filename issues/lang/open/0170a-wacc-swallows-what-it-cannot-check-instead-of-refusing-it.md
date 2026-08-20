# 0170a — wacc swallows what it cannot check instead of refusing it, and the function disappears

- **Status:** open
- **Claimed by:** agent-a
- **Reported by:** agent-a
- **Date:** 2026-08-20
- **Kind:** bug
- **Symptom:** no error — an ill-typed program builds successfully and loses a function

## The principle this is measured against

Operator, 2026-08-20:

> Failing something that the reference accepted was treated too harshly — somehow it was considered
> better to swallow errors because sometimes that meant succeeding more often. This is backwards. **It
> is better for the compiler to fail something correct than to accept something incorrect.** In every
> case where it hits a case that isn't implemented, it must fail, not be silent.

## Measured

Fourteen ill-typed one-liners, both compilers. The reference refuses **all fourteen**. wacc refuses
ten. In every one of the four it does not refuse, `wac build` **exits 0** and the exported function is
**absent from the module**.

| | program | reference | wacc `check` | `f` in module |
|---|---|---|---|---|
| a01 | `return s - 1;` | error | error | — |
| **a02** | `return s[0] - 1;` | error | **clean** | **absent** |
| **a03** | `i32 n = s[0];` | error | **clean** | **absent** |
| **a04** | `return b ? s : 1;` | error | **clean** | **absent** |
| a05 | `return p + 1;` (struct) | error | error | — |
| a06 | `return s < 1 ? 1 : 0;` | error | error | — |
| a07 | `return a(1);` (i32 called) | error | error | — |
| **a08** | `return p.v();` (field as method) | error | **clean** | **absent** |
| a09 | `return a[0];` (i32 indexed) | error | error | — |
| a10 | `return -s;` | error | error | — |
| a11 | `return a.nope;` | error | error | — |
| a12 | `g(1, 2)` for `g(i32)` | error | error | — |
| a13 | `return b + 1;` (bool) | error | error | — |
| a14 | `return s;` from `i32` | error | error | — |

a02 is `issues/lang/0159` and a08 is `issues/lang/0165`. a03 and a04 were not filed.

## Root causes, each pinned by a narrower case

**1. `typeOfE` has no case for indexing a `string`, and answers `""`.** The rules exist and fire on a
direct operand; they cannot fire on an indexed one, because nothing knows its type:

```
i32 n = s;      →  wacc: error: initialiser does not match …     ← the rule exists
i32 n = s[0];   →  wacc: 1 file(s), no diagnostics               ← the rule cannot see the type
```

That single gap silences at least two separate rules (the operator's operand check and the
initialiser check). `u8[]` indexing and `string c = s[0];` are both correct and stay correct.

**2. `typeOfE(Binary)` guesses.** It returns whichever operand has a type, with no check that the
operator accepts it or that the two agree:

```wac
string lt = typeOfE(src, lexed, env, left);
if (lt != "") { return lt; }
string rt = typeOfE(src, lexed, env, right);
if (rt != "") { return rt; }
```

So `string - i32` types as `string`. This is worse than answering `""`: **the safety net downstream
asks "do I know the type?" and gets a confident wrong answer**, so it cannot fire —

```wac
if (typeOfE(src, lexed, env, e) == "") { return "untyped " + kindOfExpr(e); }   // unsupportedValue
```

**3. `typeOfE(Ternary)` guesses the same way** — first branch that has a type, no agreement check.
That is a04 on its own.

**4. `""` is an ordinary value meaning "I don't know".** 53 `typeOfE` call sites in `emit.wac`, of
which 15 guard the empty answer. The other 38 take "unknown" as a type and carry on.

## The failure mode is the same in all four, and the machinery to report it exists

The emitter *does* detect these. It declines the function and the decline **cascades to callers**,
which is the documented fixed point in `settleEmittable`:

```wac
i32 helper(string s) { return s[0] - 1; }        // declined
export i32 caller(string s) { return helper(s); } // declined, because it calls one
export i32 fine(i32 a) { return a + 1; }          // survives
```

    $ wac build c1.wac -o c1     c1.wasm: 4324 bytes from 1 file(s)   (exit 0)
    module exports: fine

So the information is present at the moment the function is dropped. `emit.wac` has
`declinedExport` — *"an exported function the settling declined, named"* — and `wacc.wac` prints
`blocked` and exits 1 when it is non-empty. **Neither fired for any of the four.** Whatever the
settling used to remove them did not leave a reason where `declinedExport` looks.

Two guards already exist for neighbouring holes — the decline channel, and `wasm.len() <= 8` for a
module that is only a header (`issues/lang/0155`). Each was built for one instance.

## What to do, in the order that pays

1. **A declared export missing from the module is an error.** One check at the end of a build,
   naming the function. It does not fix any type rule, but no instance of this class — including the
   ones nobody has found — can be silent again. Swept all 206 `spec/cases/*.wac` with exactly this
   check: **0 instances**, canaried against a known-bad file, so it lands with no cleanup backlog.
2. **`typeOfE` must not guess.** A binary operator whose operands disagree, or whose operand type the
   operator does not accept, is an error at that expression. Same for a ternary whose branches
   disagree. Returning one operand's type is the mechanism that defeats every downstream guard.
3. **Give `""` a meaning callers cannot ignore**, or stop using it: 38 unguarded call sites is the
   measure of how far "I don't know" travels as if it were an answer.
4. **Add the missing cases and rules**: indexing a `string` in `typeOfE`; a field called as a method
   (`0165`).

## Why the differential did not catch it

The reference refuses all fourteen and wacc refuses ten, which is exactly the disagreement the corpus
differential looks for. It never saw them: the corpus is this repository's own files and
`spec/cases/*.wac`, and none of them contains an ill-typed program — they are all *meant* to compile.
So the harness is fine and the corpus has no negative half for the type checker.

Fourteen files like the ones above, with the expected refusal recorded, would have caught all four and
would catch the next one. That is cheap and is probably the highest-yield single addition here.
