# 0386a — a closure made in a loop of an `async` function sees the last iteration's local

- **Status:** closed
- **Fixed in:** bfe509d0f
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-20
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
import { Ticket, Vec } from "core";
struct H { fn<i32()> f; }
Ticket<i32> ready(i32 v) { Ticket<i32> t; t.resolve(v); return t; }
async i32 run(i32[] xs) {
  Vec<H> hs = Vec.create();
  for (i32 x in xs) {
    i32 y = await ready(x);
    hs.push(H(() => x + y));
  }
  return hs.get(0).f() + hs.get(1).f();
}
export i32 f() { return run([1, 2]).wait()!; }
```

Expected: `6` — the first closure sees `x = 1, y = 1`, the second `x = 2, y = 2`.
Actual: `8` — both see the second iteration's values.

## Notes

Outside an `async` function each iteration has locals of its own: a captured local is born in a cell where
it is declared (`emit.wac`, `isPromoted`), and spec case 0583 holds that for a `for … in` variable. Inside
one, a local that lives across a suspension is hoisted into the machine as **one** cell for the whole body
(`asynclower.wac`, `sCellDecl` at the machine's start), and its declaration becomes a write into that cell —
so every closure made in the loop holds the same cell, and reads what the last iteration wrote.

A fix makes the declaration allocate a fresh cell instead of writing into the shared one. Not obviously
simple: a closure captures the machine's *variable* holding the cell, and a variable that is assigned after
being captured is itself promoted to a cell by the emitter, which would share it again. Found while fixing
0381a.

## Resolution

Inside a lambda the machine makes, a hoisted name is read through a local declared just before the
statement — `typeof(x) k = x;` — holding the cell as it is when the lambda is made; and every declaration
of a name some lambda captured makes a new cell, `x = T[].filled(1, v);`, rather than writing into the old
one (`CopyMode.lamDepth` and `freshCellsForCaptures` in `asynclower.wac`). Names no lambda captures keep
writing into their one cell, so a machine with no closures is unchanged. Case 0594.

The worry in the notes did not arise: the machine's variable *is* promoted, since the step assigns it,
but no lambda reads that variable any more — they read the local.

Writing the probes found a second fault, now fixed with it: a lambda handed to a method of a kept local —
`hs.push(() => 3)`, which the machine spells `hs[0].push(…)` — had no target, because the emitter's
pre-pass typed a receiver through a name, a field or an unwrap and not an index. Case 0595.

What remains: a lambda in a place no declaration can go before — a loop's condition — still reads the
shared variable, as every closure did before this.
