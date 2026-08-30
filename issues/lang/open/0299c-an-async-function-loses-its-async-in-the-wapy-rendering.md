# 0299 — an `async` function loses its `async` in the wapy rendering, and the round trip cannot see it

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-30
- **Kind:** bug
- **Symptom:** wrong answer — the rendering is a different program, and the test that should catch it agrees

## Reproduction

```wac
import { Pending } from "std/platform.wac";
async i32 twice(Pending<i32> p) { i32 v = await p; return v + v; }
```

    wapyOf →  def twice(p: Pending[i32]) -> i32:
                  v: i32 = await p
                  return v + v

The `async` is gone. What comes back is a function answering `i32` where the source answered
`Pending<i32>` — every caller disagrees with it, and the `await` in the body is now an `await`
outside an `async` function, which is code 211.

## Why nothing caught it

`packages/wacc/test/wac/wapyroundtrip_test.wac` compares the two as **trees printed by `print.wac`**,
and `print.wac`'s `case Func` does not print `isAsync` either:

```wac
w.open("func", d.line, d.col);
w.sp(); w.s(exported ? "export" : "local");
w.sp(); w.tok(nameTok);
```

So both sides lose it and match. **The oracle cannot disagree** — the one property that would fail is
the one neither printer records. Async functions have been in tracked files since `design/lang/0014`
landed and the round trip has been green over them the whole time.

## The two halves, which need each other

1. **`print.wac` prints `isAsync`**, so the comparison can see it. On its own this turns the round
   trip red for every tracked file with an `async` function in it — which is the correct state, not a
   regression.
2. **`wapyprint.wac` emits it, and `wapyparse.wac` reads it.** This is the part that is a decision
   rather than work: `def` is wapy's own declaration syntax and the reader dispatches on the bare
   word, so `async def` has to be added to `wapyparse` *and* to `spec/spec/wapy.md`, which is what
   says how wapy spells things. Python spells it `async def`, which is the obvious answer and is
   worth writing down rather than assuming.

Doing 1 without 2 is a red suite; doing 2 without 1 is unverifiable. They land together.

## What is already fixed

The **lambda** case, in `issues/lang/0294c`. `wapyprint` emits `async` before a lambda's parameter
list and it round-trips, because there the body is an expression rendered in wac's own syntax and the
wac parser already reads `async (…) => …`. Only the `def` form is left, and only because it is wapy's
own spelling.
