# 0404a — a generic call in a lambda's ternary, or in a lambda held by a local, is not instantiated

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-27
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
import { Ticket } from "core";
Ticket<U> make<T, U>(T x, fn<U(T)> f) {
  Ticket<U> t;
  t.resolve(f(x));
  return t;
}
struct H { fn<Ticket<string>(string)> f; }
string named(bool b) { return b ? "y" : "no"; }
async string later(string p) { return p; }
export i32 main() {
  bool[] shut = bool[].filled(1, false);
  H h = H((string p) => shut[0] ? later(p) : make(true, (bool b) => named(b)));
  return h.f("x").done ? 7 : 0;
}
```

Expected: exits 7.
Actual: *cannot emit — a call to `make`, which this expression is emitted as and which is not in the program*.

| lambda body | result |
|---|---|
| `H((string p) => make(true, (bool b) => named(b)))` | exits 7 |
| `H((string p) => shut[0] ? later(p) : make(true, …))` | declines |
| `H((string p) => shut[0] ? make(false, …) : make(true, …))` | declines |
| `fn<…> go = (string p) => make(true, (bool b) => named(b));` (a local) | declines |
| `Ticket<string> k = make(true, (bool b) => named(b));` (no outer lambda) | runs |

A function reference in place of the inner lambda (`make(true, named)`) runs in every position.

## Notes

Found writing `std/platform.wac`'s file `Output`, whose `write` was
`shut[0] ? writeAfterClose(p) : hostTicket(cli.send(h, b), wait, (bool went) => fileWrittenOf(went, p))`: bootstrap
declined `packages/wac/src/wac.wac` naming `hostTicket`. std now spells it with a named function and an `if`.
