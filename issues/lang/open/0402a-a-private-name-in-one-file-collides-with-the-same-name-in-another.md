# 0402a — a private function or struct in one file collides with one of the same name in another

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-24
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
// ---- lib.wac ----
struct Box<U> { U v; }
Box<U> wrap<T, U>(T x, fn<U(T)> f) { Box<U> b = Box<U>(f(x)); return b; }
string shout(i32 n) { return "\{n}!"; }
export i32 libLen() { return wrap(3, shout).v.len(); }
// ---- main.wac ----
import { libLen } from "./lib.wac";
i32[] wrap(i32 n) { i32[] b = [n]; return b; }
export i32 main() { return libLen() + wrap(5)[0]; }
```

Expected: exits 7 — neither `wrap` is exported, so each file's is its own.
Actual: *the exported function `main` is not in the module the emitter produced — a call to libLen, declined: member of an
unknown type*. Without `main.wac`'s `wrap` it exits 2 as it should.

A private **struct** does the same: a `struct Box<U> { U v; }` in `main.wac` beside `lib.wac`'s gives *a construction of
Box<i32> with 1 of 2 fields*.

## Notes

Found because `core/test/ticket_test.wac` had a helper named `hostTicket`, and `std/platform.wac` has a private generic
`hostTicket<T, U>`: every program importing both declined with *a return between related reference types* — the
emitter typed std's `return t;` (a `Ticket<U>`) with the test's local `t`, a `Ticket<i32>`. The checker is fine with
both programs; the emitter's tables key some lookups by the bare name rather than by file (`genericFuncFor` takes the
file; whatever typed the return did not). The test's helper is renamed until this is fixed.

**Again on 2026-10-28**, at scale: `packages/web/src/view.wac`'s private `void flatten(Node, Vec<Node>)` and
`core`'s `flatten`. Once step 5 put `flatten(t.wait())` in `packages/box/src/shrun.wac` and `site/wac/figures.wac`,
every graph that also imported `web` — `box`'s `desk`, `term` and `rasterterm`, and the site build — stopped at the
emitter with *no method void.orElse*, all checking clean. `view.wac`'s helper is `flattenInto` until this is fixed.
