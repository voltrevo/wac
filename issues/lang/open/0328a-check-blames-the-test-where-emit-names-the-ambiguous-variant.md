# 0328a — `check` blames the test where `emit` names the ambiguous variant

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** bug
- **Symptom:** a warning telling you to delete a correct test

## The reproduction

Three files, and the only difference between them is one unrelated import.

```wac
// a.wac
export enum A { Truncated, Fine }

// b.wac
export enum B { Truncated, Fine }

// r2.wac — clean
import { A } from "./a.wac";
export i32 f(A x) { return x is A.Truncated ? 1 : 2; }

// r1.wac — warns
import { A } from "./a.wac";
import { B } from "./b.wac";          // nothing below mentions B
export i32 f(A x) { return x is A.Truncated ? 1 : 2; }
```

    r2   no diagnostics
    r1   warning: these types share no ancestor, so the test is always false

**The qualification is being dropped.** `[§enum-is-qualified-8jkq4wp]` says `s is Shape.Circle` and
`s is Circle` *"mean the same thing"*, so `A.` should settle which `Truncated` is meant. Instead the
checker takes `Truncated` from file scope, finds `b.wac`'s, and reports that an `A` and a `B.Truncated`
share no ancestor — which is true of the pair it chose and says nothing about the program.

## Why the warning is the worst part

It is *action at a distance*: adding an import on line 2 changes what a test on line 3 is understood
to mean, and the message names neither the import nor the ambiguity. A reader who trusts it deletes a
branch that was doing its job.

## `emit` already has the right answer

Build the same file rather than checking it:

    wacc: cannot emit r1.wac — the name Truncated, which more than one file declares
          — declared by a.wac and b.wac

That is the correct diagnostic, at the correct place, naming both declarations. So the information
exists one stage later, and the program is refused rather than mis-emitted — this is a
diagnostic-quality bug and not a wrong-answer bug.

The shape is the one `issues/lang/` keeps finding: **a stage that resolves an ambiguous name silently
and then reasons from its choice**, where the honest move is to report the ambiguity. The checker has
everything it needs — it saw both declarations to be confused by them.

## What a fix looks like

Either the qualified form resolves through the enum, which is what the tagged claim says it does and
would make `r1` clean; or the checker reports the ambiguity itself, in the emitter's words, and both
stages agree. **The first is what the spec promises**, and the second is worth having anyway for the
unqualified `x is Truncated`, which is genuinely ambiguous and today gets the same misleading
warning.

## Where it came from

`vision/packages` names every package's error union `Fault`, and three member names are declared
twice across nineteen packages — `Fault`, `BadMethod`, `Truncated`. Checking whether two modules'
same-named variants can be matched in one file turned this up. Two further measurements from that,
recorded here because they are about the shipped language rather than about `vision`:

- **An import alias does not work in a match arm.** `import { Truncated as ATrunc }` then
  `case ATrunc:` is *"no variant of that name"*. An arm resolves by the variant's own name.
- **`case` does not accept a qualified variant** where `is` does: `case A.Truncated:` is
  `expected ':', found '.'`. `match_arm` takes a bare `IDENT`, so the two constructs differ in what
  they will accept for the same thing.

Neither is filed as a defect here — the first is arguably right and the second is a deliberate
asymmetry nobody has written down — but together they mean there is no spelling today for matching
two same-named variants from two modules in one file.
