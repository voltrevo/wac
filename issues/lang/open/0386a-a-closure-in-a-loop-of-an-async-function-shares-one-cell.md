# 0386a — a closure made in a loop of an `async` function sees the last iteration's local

- **Status:** open
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
