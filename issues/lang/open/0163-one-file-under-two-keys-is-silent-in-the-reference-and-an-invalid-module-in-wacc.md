# 0163 — one file under two keys: silent in the reference, an invalid module in wacc

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
