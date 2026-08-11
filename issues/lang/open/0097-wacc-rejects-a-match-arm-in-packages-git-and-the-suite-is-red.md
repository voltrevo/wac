# 0097 — wacc rejects a match arm in `packages/git`, and the shared suite is red

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-11
- **Kind:** bug
- **Symptom:** wrong answer

## What is red

`deno task test` fails two of `packages/wacc`'s rungs on master as of `a914f7e3`:

```
rung 3: the repository's own code, checked — no false alarm
  the checker reported 1 working file(s):
  packages/git/src/repo.wac:93:13 code 51 — case Ready(p): { packs.push(p); }

rung 4: the repository corpus, compiled
  1 corpus file(s) produced an invalid module — the emittability walk approved
  something the emitter could not emit
```

Code 51 is `errNoVariant`, "no variant of that name". The file compiles with the TypeScript compiler
— it is in the tree and the rest of the suite passes on it — so this is wacc disagreeing with the
reference about a construct that is legal.

## The shape, as far as I narrowed it

`repo.wac:93` matches on `openPack(...)`, which returns the enum **`Opened`** imported from
`./pack.wac` (`Ready(Pack)` / `Refused(string)`). The same file declares its own enum `RepoAt` whose
**first variant is also called `Opened`** (`repo.wac:51`). So the name `Opened` is both an imported
*type* and a local *variant* in one file, and the arm `case Ready(p)` is checked against something
that has no `Ready`.

That is the mirror of [0095](../closed/0095-a-struct-named-like-a-variant-resolves-to-the-enum.md) —
a struct named like a variant — and a neighbour of
[0096](../closed/0096-an-arm-binding-takes-its-type-from-a-same-named-variant-in-another-enum.md),
closed this morning. Both were about a name resolving to the wrong one of two things that share it.

**I could not reduce it to a two-file case.** An imported enum matched on a call, with a local enum
whose variant spells the imported enum's *type* name, reports nothing:

```wac
// pack.wac
export enum Opened { Ready(i32 handle), Refused(string why) }
export Opened openPack(u8[] idx, u8[] data) { … }

// use.wac
import { Opened, openPack } from "./pack.wac";
export enum Where { Opened(i32 handle), Missing(string why) }
export i32 count(u8[] idx, u8[] data) {
  match (openPack(idx, data)) { case Ready(p): { return p; } case Refused(why): { return -1; } }
  return 0;
}
```

`dumpTypeErrorsFiles` on that pair answers with no codes. So something else in `repo.wac`'s closure
is needed — it imports nine modules, and `Pack` (the payload type) is one of the things imported
alongside the enum. Whoever knows the resolver will see it faster than I bisected it; the reduction
above is where I stopped, not a claim that it is the whole shape.

## Why this is filed rather than fixed

`issues/lang/` is the compiler and somebody else is porting it — `0096` was closed at 08:56 today.
Two of us editing the resolver at once is worse than one of us waiting.

**It blocks pushing**, which is the part that matters to whoever reads this next: `tools/push.sh`
runs the whole suite, so anybody's unrelated work is refused while this is red. Mine is
`98bd2473`, a README correction, waiting on it.
