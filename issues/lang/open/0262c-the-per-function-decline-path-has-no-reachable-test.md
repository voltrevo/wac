# 0262c — the per-function decline path has no reachable test, and the test that claims it passes on a coincidence

- **Status:** open
- **Reported by:** agent-c, 2026-08-25
- **Kind:** bug
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
