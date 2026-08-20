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

## Attempted 2026-08-20: tightening `typeOfE` first, and why that is the wrong order

Tried the direct thing — make `typeOfE(Binary)` answer `""` instead of guessing. It **collapsed
self-hosting**, and the way it collapsed is the argument for doing the reporting first.

The rule was calibrated against the reference in four rounds, each round finding a legitimate case
the previous one refused:

| round | refused something legal | what the reference says |
|---|---|---|
| 1 | `"a" + "b"` | `+` is concatenation when both sides are `string` |
| 2 | `bytes[i] - 48` | a packed type is arithmetic; `isNumericTy` excludes `u8`/`i16`/… |
| 3 | `n + bytes[i]` | see below — round 3's conclusion was **wrong** |
| 4 | still collapsed | unknown — and this is the point |

After round 4 the reference-built compiler was a 933 KB module exporting **nothing but `$bind$*`** —
every `check`, `build`, `compile` gone — and `packages/platform/native.ts` printed a size and exited
0. The same defect this issue is about, at maximum scale, hiding the diagnosis of its own cause.

There is no way to find round 4 from here. The compiler that would tell you which expression it
declined is the compiler that no longer builds. Reverted; the seed is a fixed point again.

**So the order is: make declines reportable, then tighten.** With a working report each tightening
round names the expression it refused, and calibration is minutes rather than a rebuild per guess.

## A second finding, from looking for why nothing was reported

`declinedExport` reads `env.funcOk[at]` where `at` counts **only top-level `Func` declarations** —
but `funcOk` slots are handed out by `addFunc` to methods as well, interleaved in declaration order
(the `StructDecl` and `EnumDecl` arms of the same walk both call it per method). So a struct or enum
with methods declared before a function misaligns the index, and every function after it is checked
against the wrong slot.

Both walks skip generics consistently, so that half is fine — checked, because it looked wrong first.

This is not what silenced the cases in the table above: those have no struct, so `at` is 0 and aligned,
and `declinedExport` still said nothing — meaning `funcOk` was **true** for a function that did not
reach the module. That is a third thing to find, and it is the one the report has to expose.

## Corrections to the attempt above, and what is actually established

Two explanations offered here were wrong. Both are left named rather than deleted, because the
pattern in them is the same one this issue is about — accommodating a wrong answer instead of asking
where it came from.

**Round 3 was wrong.** It concluded "`i32` and `u8` agree, so agreement is by *widened* type" and
added a `widenedTy` helper. There is no `u8` value in wac: `spec/spec/types.md` says *array element
only — no locals, params, or struct fields*, and both compilers refuse `u8 x = 1;`. So `n + b[0]` is
plain `i32 + i32` and no widening rule is needed.

**The "phantom type" explanation that replaced it was also wrong.** It claimed `typeOfE` answers
`"u8"` for `b[0]`. It does not — the `Index` arm already handles this, with a comment saying exactly
why:

```wac
// A packed element is an `i32` where it is used — the getter zero- or sign-extends it — which
// is the checker's rule about packed types arrived at from the emitter's side.
if (e == "u8" || e == "i8" || e == "u16" || e == "i16") { return "i32"; }
```

**And rounds 2 and 3 were never verified.** The seed failed identically before and after each, so
adding packed types to `arithmeticTy` and then `widenedTy` may both have been no-ops. What is
established about the attempt is only that the rule broke self-hosting and that the collapse hid its
own cause; the four-round table above is a record of guessing, not of diagnosis.

### What *is* established, on its own evidence

`u8`/`u16` do exist as element types and are load-bearing: `bulkGet` picks `array.get_u` (13) for
them against `array.get_s` (12) for `i8`/`i16`, and `bulkValType` is documented as *"the wasm value
type an element arrives as, which is not the element's own for a packed one"*. That distinction is
already made and already named.

And this is real, proved by the engine rather than by a story about it:

```wac
export i64 f(u8[] b) { i64 x = b[0]; return x; }
```

    reference:  typecheck: type mismatch: expected i64, …
    wacc:       1 file(s), no diagnostics — wac build exits 0
    engine:     CompileError: local.set[0] expected type i64, found array.get_u of type i32

`wac build` writes an artefact the engine refuses and reports success — a *worse* outcome than the
dropped functions in the table above, which at least produced a loadable module. `export i64 f(u8[]
b) { return b[0]; }` is the same, and there the reference names the real type: *return: expected i64,
found i32*.

**Why the initialiser check does not fire is not yet known.** `typeOfE` answers `i32`, the slot is
`i64`, and the rule that catches `i32 n = s;` exists — so something on the packed path bypasses it.
That is the next thing to find, and it should be found before any rule is tightened.

## 2026-08-20, later: all four are refused by the checker

The table at the top now reads the same for both compilers:

    a02  return s[0] - 1;    error: this operator does not take an operand of that kind
    a03  i32 n = s[0];       error: initialiser does not match the declared type
    a04  return b ? s : 1;   error: the two branches of a ternary have unrelated types
    a08  return p.v();       error: this is not something that can be called
                                    (P.v is a field of type i32, not a method)

**Every one was a rule that already existed and could not see its input.** Not one needed a new
check:

- `typeOfExpr`'s `Index` arm answered unknown for anything not an *array*, so `s[0]` had no type —
  a02, a03. `issues/lang/0159`.
- The field-called-as-a-method arm returned early for a field whose type is not a funcref, because
  both its guards were `heldArity >= 0` — a08. `issues/lang/0165`.
- The ternary-branches rule was skipped whenever *either* branch was a literal, on the grounds that a
  literal takes the other's type. True when it can; `1` cannot be a `string` — a04. The typing walk
  immediately above already asked `literalFits` for the same pair, so the two disagreed with each
  other.

That is the shape of this issue, and it is worth stating plainly because it is not what the title
suggests: **wacc's rules were mostly there.** What was missing was the type information they needed,
and each gap silenced several rules at once. Adding rules would have been the wrong instinct.

### Nets, kept

The two that came out of the failed first attempt stay, because they answer a different question —
*whatever the reason, is the artefact what you asked for*:

- an export the source declared and the module lacks fails the build, naming the function;
- `wac build` validates the module it wrote.

Both caught cases the checker did not, and `0154`'s symptom is now caught by the second.

### Corpus

`spec/cases/0205`–`0208`, in the corpus both compilers read: **210 of 210 met by wacc**, and the
reference's harness passes. Checked for false refusals across 23 packages after each rule.

## The "38 unguarded call sites" figure was wrong, and the real shape is better

I wrote that `""` travels as an answer across 53 `typeOfE` call sites of which 15 guard it, and
offered 38 as the measure of the problem. That counted an *idiom* — an immediate `== ""` — not holes.
Sampling four of the 38:

| site | what it does with an empty answer |
|---|---|
| the `switch` walk | passes it as the expected slot, where empty legitimately means "no slot" |
| the cast walk | handles it deliberately, with a comment: a literal has no type and takes the slot's |
| the index walk | compares it against `"string"`; empty simply is not, and falls through |
| the member walk | `if (!env.isStructName(ot2)) { return; }` — **a silent bail** |

So one of four. Anyone hunting 38 sites would have found mostly deliberate handling, and that is a
bad way to spend a day.

### The measurement that does mean something

The emitter has **40 bare `if (…) { return; }` bails in its expression walk, and not one records a
reason.** The whole file contains **6** `declineFor` calls.

Those bails are not meant to be reachable: `canEmit`/`unsupportedIn` decides emittability *before*
emitting, so anything that got as far as the emitter should be emittable. They are defence in depth —
which means every one of them is a place where **the gate and the doer disagreeing turns into
silence**, and that is exactly what the four cases in this issue were.

Two walks that must agree is the anti-pattern this codebase already names, in `findLambdas`'
own comment: *"Two walks that agree almost always is the bug, so this one records what emission needs
and emission reads it by index."* The gate and the emitter are that pair, at a much larger scale, and
they have no such shared record.

**Which is the argument for the nets rather than for auditing the 40.** Export parity and build
validation catch a disagreement whatever its cause, without requiring the two walks to agree — and
they caught cases the checker did not. Making the 40 bails record a reason would be worth doing and
would improve the *messages*; it would not remove the need for the nets, because a walk can always
disagree in a way neither side thought to record.
