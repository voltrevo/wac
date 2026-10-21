# 0388a — Two symbols with the same declared spelling name one member in the emitter: `p.[tag]` and `p.[other]` read the same field

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-21
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
// n1.wac and n2.wac each hold only: export symbol tag;
import { tag } from "./n1.wac";
import { tag as other } from "./n2.wac";
struct P { i32 [tag]; i32 [other]; }
export i32 a() { P p = P(1, 2); return p.[tag] * 10 + p.[other]; }
```

Expected: 12, as `§wac-symbol-identity-anh5a8y` says (an independent declaration with the same spelling names a different member).
Actual: 11. Named construction `P { [other]: 5, [tag]: 7 }` checks clean and the emitter declines it as naming a field twice; methods and overrides keyed on the two symbols mix the same way.

## Notes

The parser rewrites an aliased symbol member into a token carrying the declared spelling, and the emitter keys
members by that text (`check.wac` ~4812 says so). Fixing it means keying symbol members by their declaration
across the emitter — a project, which is why the fixer that found it backed out. The repro is
`wac-web/.cache/unfixed/0661-*.wac` in the worktree where it was tried.
