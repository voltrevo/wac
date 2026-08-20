# 0163 — one file under two keys: silent in the reference, an invalid module in wacc

- **Status:** open
- **Claimed by:** agent-a, 2026-08-20 — part 1 (refuse it, rather than emit a module the engine rejects)
- **Reported by:** agent-a
- **Date:** 2026-08-19
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

A project where one file is reached under two different keys. Today that needs a perturbed resolver
to produce — see *Why this is latent* — so the reproduction is stated as the shape rather than as a
program you can run unaided:

```wac
// proj/wac.json5      {}
// proj/src/point.wac  export struct Point { i32 x; i32 y; i32 sum(const this) {…} }
// proj/src/a.wac      import { Point } from "./point.wac";
//                     export Point make() { return Point.create(3, 4); }
// proj/src/b.wac      import { Point } from "@/src/point.wac";
//                     export i32 take(Point p) { return p.sum(); }
// proj/src/main.wac   export i32 main() { return take(make()); }
```

With resolution correct, `@/src/point.wac` and `./point.wac` are one key and both compilers answer
**7**. Make them two keys — I did it by having the `@/` branch skip normalisation, so one side is
`./src/point.wac` and the other `src/point.wac` — and the two disagree:

| | with one key | with two keys |
|---|---|---|
| reference | 7 | **7** — reads the file twice and does not mind |
| wacc `check` | clean | **clean** |
| wacc `run` | 7 | **the engine rejects the module** |

wacc's message for the last one is *"the module compiled from src/main.wac was rejected by the
engine — this is a compiler bug rather than a fault in your program"*.

## Why this matters, and why it is not just the perturbation talking

`design/lang/0009` D8 says identity is canonical after resolution, and its own warning is:

> Nominal identity rides on it, and getting it wrong produces two incompatible copies of one struct —
> a program that type-checks, runs, and fails at a seam whose error message names the same type twice.

**Neither compiler does that.** The reference does not produce two incompatible copies at all — it
tolerates the duplicate and the program works. wacc produces a module that will not load, with the
checker silent beforehand. So the failure the note is written to guard against is not the failure
either implementation actually has, and a test written from the note's description would be looking
for the wrong thing.

The two behaviours are also *different from each other*, which is its own problem: a program that the
harness compiles and runs is one `wac build` refuses.

## Why this is latent, and when it stops being

Nothing a user can write today produces two keys for one file. Relative paths normalise, `@/`
normalises, and built-ins are their own keys. It takes a resolver bug — which is how it was found,
while canarying the `@/` work.

**D9-D11 change that.** Once a repository can be reached through a Git mapping as well as relatively,
"the same file under two names" becomes something a manifest can express, and then this stops being
reachable-only-by-perturbation. That is the point at which the reference's tolerance and wacc's
invalid module become a user's problem, and the user gets told it is a compiler bug.

## What would fix it

Two separable things:

1. **wacc's checker should refuse it**, with a diagnostic naming the file and both keys, rather than
   letting the emitter build something the engine rejects. A module that fails validation is the
   worst available outcome: the blame lands on the compiler and the source line is gone.
2. **Decide what the right answer is**, which is D8's job and not this issue's. Tolerating the
   duplicate (the reference's behaviour) is defensible if identity is genuinely canonical after
   resolution; refusing it is defensible if two keys means the resolver has already gone wrong. What
   is not defensible is one of each.

## Notes

Found by canarying, not by review. The `@/` test needed to show it could fail, so I perturbed the
resolver to give `@/` a different key — and the interesting part was not that the test failed but
*how*: `check` stayed clean and the engine did the complaining.

## Part 1 done: it is refused, with both keys named — agent-a, 2026-08-20

`linkFiles` answers `""` when two supplied keys name one file, and `linkFailure` says which:

    one file is supplied under two keys: `./src/point.wac` and `src/point.wac`,
    which both name `src/point.wac`

So the invalid module is gone, and with it the *"this is a compiler bug rather than a fault in your
program"* with no source line. That was the worst available outcome and it is what part 1 asked for.

**It needed no perturbed resolver to test.** The shape is reachable through the files-based API by
handing it two keys, which is what `packages/wacc/test/wac/twokeys_test.wac` does — five tests,
including the `./src/point.wac` against `src/point.wac` pair this issue was found with, and two
controls: two *different* files with identical contents stay legal (an empty file, a shim), and an
ordinary one-key program still builds. Reverting the guard fails two of the five.

### Where it had to go, after two wrong answers

`buildLinked` first — which is `wac build` only, so `blockedFiles` and the whole `emitFiles*` family
walked straight past it. That is the split `issues/lang/0170a` records: those go through `emitLinked`.
Then `frontOf`, which `emitLinkedWith2` does not call either. The one thing both routes pass through
is **`linkFiles`**, and `""` from it is already how a link says no — `frontOf` turns it into a null
front and `emitLinkedWith2` into a bare module. Said once there, it covers every consumer.

### The first version cost 20% of a build

`normalisePath` on every supplied key put `packages/box` at **15.7s against a 12.3s baseline** — three
seconds on a twelve-second build, for a condition nothing in the tree can reach. A key can only collide
with a normalised sibling if it is *not itself* normalised, so `looksNormal` — six `indexOf`s, no
allocation — answers for every key in a healthy map and the walk stops. **11.9s**, inside the noise of
the baseline. Measured rather than assumed, because a guard on the hot path is exactly where a cheap
correctness win turns into a slow compiler.

## What is left: part 2, and the divergence is now deliberate

Part 2 stands as written — D8's job. What has changed is that "one of each" is no longer *invalid
module against works*: wacc **refuses with a reason** and the reference tolerates the duplicate and
runs. That is still a disagreement, and it is now a stated position rather than an accident.

Recommendation, for whoever settles D8: **refusing is right.** Two keys for one file means resolution
has already gone wrong, and identity riding on the key is the whole of D8 — so tolerating it asks the
compiler to guess which of two identities the programmer meant, in a program where nothing distinguishes
them. The reference's tolerance is not evidence for the other side; it reads the file twice and gets
away with it because it has no nominal identity to keep straight. `[§wac-samename-struct-4jhq7wn]`
already says identity is the file a definition was written in, and one file is one definition.
