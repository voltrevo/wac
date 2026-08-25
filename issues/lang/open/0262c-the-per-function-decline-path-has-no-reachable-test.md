# 0262c — the per-function decline path has no reachable test, and the test that claims it passes on a coincidence

- **Status:** open
- **Reported by:** agent-c, 2026-08-25
- **Kind:** decision — the needle is fixed; what is left is retire-or-hook
- **Symptom:** a test whose subject moved out from under it, and still passes

`packages/wacc/test/wac/declined_test.wac` opens:

> A function the emitter could not emit is **named**, and the build fails — `issues/lang/0170a`.

Its fixture is `illTyped()`, which is `return s[0] - 1;` in a function taking a `string`. **That is a
checker error now**, not an emitter decline:

    error: this operator does not take an operand of that kind
      --> m.wac:2:15
       |
     2 |   return s[0] - 1;
       |               ^
       = help: check what the operand is — the operator wants another kind

So the emitter never runs, and the test is measuring the checker while describing the emitter. That
happened *because* things went right — `issues/lang/0170a` item 2 ("a binary whose operands disagree
has no type") is the commit that moved the subject.

## It still passes, and the reason is worth writing down

    t.isTrue(contains(said, "f"), "the failure did not name the function — " + said);

The function is `f`. The checker's message does not name it — but it contains **"of that kind"**, and
`contains` is a substring test, so the assertion is satisfied by the `f` in `of`. A one-character
needle will find itself in almost any English sentence.

All three cases in the file share the fixture, so all three are in the same position, including the
one written to reproduce an off-by-two in the per-function array index — the case whose whole value is
that it exercises the *emitter's* indexing.

## Why it cannot simply be repointed

Every construct tried as a replacement is caught earlier now:

    an ill-typed operand              checker
    a generic method without its type arguments    checker
    a construction mixing named and positional    parser
    `copyFrom` between array types    checker
    a generic instantiated at an enum    **was** the emitter, until `issues/lang/0260c` was fixed

That last one is the sharp lesson: it was a per-function decline that named the function — exactly what
this test needs — and it started compiling an hour after I found it, because the underlying fault got
fixed. A test subject that is a bug is a test subject with a shelf life.

**What is reachable is a cap, not a construct**: `capsPerLambda()` is 32, the checker has no opinion
about it, and a lambda capturing 33 locals is declined by name. `corpusemit_test.wac`'s harness canary
now uses exactly that. But a cap decline is *whole-module* — "the emitter ran out of room for captures
in one lambda" — and does **not** name a function, so it cannot carry this file's claim.

## What to do

Two honest options, and this is filed rather than done because they are a decision:

- **Give the emitter a way to be asked.** A test hook — an entry that declines a named function on
  purpose — makes the per-function path testable without depending on a bug existing. It is also the
  kind of thing this repository is against, because it is code no program needs.
- **Retire the claim.** If the checker catches everything that would reach a per-function decline, the
  path is unreachable and the test is asserting a property of an interior that no input can produce.
  Then `declined_test.wac` becomes a *checker* test, honestly named, and the emitter's decline is
  covered where it is reachable: the cap.

Either way the `contains(said, "f")` assertion wants a wider needle, whichever subject it ends up with.
That part is not a decision.

**Not made red on purpose.** The file passes today, and making the shared suite red is the thing
`CLAUDE.md` says to file rather than do. But it passes for the wrong reason, so it is not protecting
what its header says it protects.

## The non-decision half is done — agent-c, 2026-08-25

The needle is a **location** now, `m.wac:2`, and the header says what the file actually pins: a program
no phase can compile exits non-zero and points at the line. Three cases, green. The needle was checked
against a wrong line (`m.wac:99`) and goes red, so unlike its predecessor it can disagree.

Case 2 keeps its two-methods-before-the-function shape and says in a comment that the *reason* is
historical: the index bug it reproduces is not reachable through this fixture any more, while what it
asserts — two methods ahead of the function do not turn a refusal into a silent success — holds
whichever phase refuses.

## What the search for a reachable subject found instead

Every construct below was tried against **both** compilers. None of them reaches a per-function
decline, and three of them are declines this emitter's own comments *claimed* it still makes:

| tried | what actually happens |
|---|---|
| two locals of one name, disjoint blocks, different types | **compiles, answers correctly** |
| a nested shadow at a different type | **compiles, answers correctly** |
| a nested shadow at the same type | **compiles, answers correctly** |
| a lambda capturing a *parameter* | **compiles, answers correctly** |
| a lambda in a ternary, returned, in a struct field, as a call argument | all four compile |
| named arguments in a call | parser |
| a lambda in an array `fill:` | checker, and `a[0]()` beside it is `issues/lang/0265c` |

So `duplicateLocal` — written to decline two locals of one name — **had no caller at all**, and the
comment above `canEmit` described that decline as live for as long as the function sat there
unreferenced. It is deleted, and the three shadow shapes are cases in `emit_test.wac`'s rung-4
differential now, so the behaviour it worried about is pinned by a test instead of a paragraph. The
lambda comment claiming a captured parameter is refused is corrected the same way.

**And the cap decline is confirmed whole-module**, which this issue asserted and `corpusemit_test.wac`
contradicted. Measured:

    wacc: cannot emit <file> — the emitter ran out of room for captures in one lambda

It names the *file*. A cap goes through `ranOut` → `declineFor`, which sets `env.fullWhy`; the
per-function path is `canEmit` → `env.lastWhy` → `env.funcWhy[at]`, and nothing joins them. That test's
"declined by name" sentence is fixed to say the cap is named rather than the function; its assertion
only ever read the reason string, so the sentence was the only thing wrong.

## It *is* reachable, and that settles the argument rather than the question — agent-c, 2026-08-25

The search above was for a construct. The subject was in the mutation sweep's recall queue all along:

```wac
export u64 f() { return 18446744073709551615.nofield; }
```

    wac check   1 file(s), no diagnostics
    wac build   wacc: cannot emit … — the exported function `f` is not in the module the
                emitter produced — member of an unknown type

*"member of an unknown type"* is a return from `unsupportedExpr`, so it travels
`unsupportedExpr` → `unsupportedIn` → `canEmit` → `env.lastWhy` → `env.funcWhy[at]`: **the per-function
path, naming the function.** Exactly what `declined_test.wac` claims to test.

**And it is reachable for the same reason every other subject was: the checker has a gap.** A member
access on a literal has no expected type, so nothing range-checks the literal and nothing types the
receiver — and the reference refuses the program. That is a silence to fix, and fixing it takes the
subject away again, which is the third time in this issue: `issues/lang/0260c`'s generic-at-an-enum
compiled an hour after being found, `s[0] - 1` became a checker error, and this one is a live entry in
`mutateCheck.test.ts`'s queue waiting for somebody to close it.

So the reachability question is answered **yes**, and the answer does not help: a test pointed here is a
test that depends on a bug staying unfixed, and the bug is one we want fixed. That is an argument for
retiring the claim rather than against it, and it is now demonstrated rather than argued.

## Recommendation, with the decision still the operator's

**Retire the claim.** Every attempt above was caught earlier or compiled, and the reachable declines
are caps, which do not name a function. A test hook is code no program needs, which `CLAUDE.md` is
explicit about, and it would pin an interior that no input can produce.

What argues against deleting the *mechanism* along with the claim: `unsupportedIn` is not dead the way
`duplicateLocal` was. It exists because every walk in the emitter ends in `else: { }`, which for an
expression emits nothing where a value was expected — 199 of 308 broken modules before it, each
reporting a wasm stack depth rather than a missing feature. Its declines are unreachable *because the
checker got there first*, and that is a property of today's checker rather than of the emitter. The
next construct added to the parser ahead of the emitter makes them reachable again, which is exactly
what the guard is for. So: retire the test's claim, keep the guard, and say in `emit.wac` that its
declines are defence for a lag that is currently zero.

## A fourth subject, found and fixed within the hour — agent-c, 2026-08-25

Walking the diagnostic codes turned up `P.nope` — a name reached through a *struct* rather than a
value. `checkMember` had that rule for enums (`E.nope` is a variant that is not there) and not for
structs, so the checker was silent and the **emitter** declined:

    wacc: cannot emit s1.wac — the exported function `f` is not in the module the emitter
    produced — unresolved name P on line 1

Which is the per-function decline this page needs a subject for, and it named the function. It is also
a bug: the reference refuses it in its checker, so wacc was accepting a program it should not. Fixed in
the same session, along with `P.v` and the typing of `P.m`, so it is no longer a subject.

**That makes four for four**, and the pattern is now the finding rather than an accident:

    an ill-typed operand                        was the emitter, until 0170a
    a generic instantiated at an enum           was the emitter, until 0260c
    a name reached through a struct             was the emitter, until this session
    ...and every other construct tried          caught by the checker or the parser already

Every construct that has ever reached this path did so **because the checker had a gap**, and each one
stopped reaching it as soon as the gap was closed. So a test pointed at the decline path is a test
whose subject is a defect, and keeping it green means keeping a defect. That is an argument for
**retiring** the claim rather than hooking the emitter — and if it is hooked instead, the hook has to
be a deliberate one that no checker fix can take away, not a program chosen for declining today.

Not proof that the path is dead: an emitter can decline for reasons no checker models, and this is
evidence about which constructs are *reachable from source*, not about the branch. But four subjects
and four expiries is the whole evidence anyone has, and it points one way.

