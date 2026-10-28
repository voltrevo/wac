# 0408a — a core type imported by name loses its text conversion

- **Status:** closed
- **Claimed by:** agent-a
- **Fixed in:** 3a4b7424e
- **Reported by:** agent-a
- **Date:** 2026-10-27
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
import { Stuck } from "core";
string say(Stuck e) { return "\{e}"; }
export i32 main() { return say(Stuck("x")).len(); }
```

Expected: compiles; `Stuck` has a `[toString]` method answering a string, so it converts to text
(`§wac-interp-union-member-m3vq8ke`, and ch23's conversion through core's `toString`).
Actual: *this value has no conversion to text — Stuck has no toString conversion*. Adding `toString` to the import
makes it compile.

## Notes

`convertsToText` (check.wac) finds a type's conversion under the spelling the current file gives core's `toString`,
or under `[toString]` for a type in `c.coreTextTypes`. That list was filled only from **aliased** imports of
`toString`, and core (which declares the symbol) and std (which imports it plainly) have none. So a type declared in a
built-in converted only when the first lookup happened to match, and which import list made it match was an accident
of what else the program reached: importing `Ticket` beside std's faults was enough to lose it.

## Fix

`api.wac` records every `[toString]` type of a built-in file in `coreTextTypes`, since a built-in's `[toString]` can
only be core's. Case 0854.
