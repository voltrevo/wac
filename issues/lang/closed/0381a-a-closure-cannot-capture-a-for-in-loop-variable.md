# 0381a — a closure cannot capture a `for … in` loop variable

- **Status:** closed
- **Fixed in:** ff2487f9b
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-19
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
import { Sys } from "std";
import { Vec } from "core";
struct H { fn<i32()> f; }
export i32 main(Sys sys) {
  Vec<H> hs = Vec.create();
  for (i32 x in [10, 20, 30]) { hs.push(H(() => x)); }
  sys.log("\{hs.get(0).f()} \{hs.get(2).f()}");
  return 0;
}
```

Expected: `10 30` — each iteration's own `x`.
Actual: `wacc: cannot emit … — \`x\`, which is read here and is neither a local nor a module constant this
emitter can find`.

## Notes

The indexed form works and gives each closure its own value — `for (i32 j = 0; j < 3; j++) { i32 x =
xs[j]; hs.push(H(() => x)); }` prints `10 30`. So the capture analysis does not see the for-in binding as
a local. That is the shape a list's per-row event handler takes (`design/system/0012`), so it will be
written often.
