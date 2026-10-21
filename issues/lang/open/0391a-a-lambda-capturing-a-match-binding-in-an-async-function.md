# 0391a — A lambda capturing a match-arm binding inside an `async` function declines with "a type was registered while a body was being emitted … i32[][]"

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-21
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
import { Ticket } from "core";
enum E { A(i32 x), B }
i32 call(fn<i32()> f) { return f(); }
async i32 v(Ticket<i32> t) { E e = E.A(4); i32 w = await t; return match (e) { A(x): call(() => x) + w, B: 0 }; }
```

Expected: 5 for a `t` resolved with 1, as the synchronous form now answers (case 0702).
Actual: the module is declined with a late-registered `i32[][]`.

## Notes

The async lowering wraps a value that is already hoisted into a cell a second time, which names array types the
type pre-pass never registers. The synchronous capture was fixed in dde302829; this is the async half. Repro:
`.cache/bughunt-generics/d4_1.wac`.
