# 0421c — a static method through a verbatim import alias is not found

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-10-29
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
// ---- p.wac ----
export struct P { i32 n; P make(i32 v) { return P(v); } }
// ---- main.wac ----
import { P as Q } from "./p.wac";
import { P as @"$q" } from "./p.wac";

export i32 g() { return Q.make(1).n; }        // checks
export i32 h() { return @"$q".make(1).n; }    // error: no such static method
```

Expected: both check — an alias is the declaration it names (spec ch01), whatever spelling the alias has.
Actual: `h` is refused with *"no such static method"* at `@"$q".make`. The same alias in a type position resolves
(`@"$q" x = …`); only a static reached through it does not.

## Notes

Met while the program adapter learned to import std's `Host` and `Sys` under names of its own (`@"$wacHost"`,
`@"$wacSys"`), so a program declaring its own `Host` cannot clash with them. The adapter calls two free functions
instead, `__wacHostOf` and `__wacSysOn` in `std/platform.wac`, which go once this is fixed.
