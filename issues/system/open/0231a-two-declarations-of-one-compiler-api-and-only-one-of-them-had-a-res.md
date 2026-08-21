# 0231a — two declarations of one compiler API, and only one of them had a `Res`

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** decision
- **Symptom:** no error — each is correct about the calls it names, and neither says what it omits

## Measured

`type WaccApi` is declared twice, in two files that import each other's other exports:

    harness/waccBuild.ts:20   export type WaccApi   — 20 members
    harness/wacBind.ts:175           type WaccApi   —  7 members

Both describe the same object: what `wacBind("packages/wacc/src/api.wac")` returns. Neither is wrong.
The narrow one names the seven calls a *bind* makes and the wide one the twenty a *build* makes, and
they were written at different times by whoever needed a call next.

## What it cost, which is why this is filed rather than shrugged at

`issues/system/0229a` threaded the project roots through the Deno host so a `@/` import resolves. It
found the `In` entry points — `diagnoseGraphIn`, `emitFilesIn` and the rest — were **already exported
by `api.wac` and already in the generated glue**, and the reason nobody called them is that neither
type mentioned them. A host reading `WaccApi` could not see there was a choice.

So the fix had to be applied twice, to two lists, on two days: `waccBuild.ts` in the morning and
`wacBind.ts` in the afternoon, after filing the second one as leftover work. And `waccRes`, the helper
that builds a `Res` from a roots map, had to be given a structural parameter type —
`{ Res: WaccApi["Res"] }` — because naming either declaration makes it uncallable from the other file.
That signature is a workaround for this issue, and says so.

**The general shape:** a type that lists a subset of an interface is a *filter*, and a filter with no
statement of what it filters reads as the whole interface. Both of these read that way. The
resolution-context family is exactly the kind of thing that hides behind such a list, because a caller
who does not know a variant exists cannot miss it.

## Options

1. **One declaration, in `waccBuild.ts`, imported by `wacBind.ts`.** Simplest, and 13 members
   `wacBind` does not use become visible to it — which is the point rather than the cost, since the
   last three times somebody needed one they added it to whichever list was in front of them.
2. **Generate it.** `api.wac`'s exported signatures are what `exportSigsFiles` answers, and
   `packages/wacc/tools/waccBindgen.ts` already turns that wire into TypeScript. A generated
   declaration cannot omit an entry point, which is the failure mode here. Costs a build step in a
   place that currently has none, and the generated glue is per-program while this type is about one
   specific program.
3. **Keep both and add a guard** — a test asserting the narrow one is a subset of the wide one, and
   that every `api.*` call in each file is declared in the type it uses. That is `benchCompile.test.ts`'s
   pattern, which already catches "a build makes a call nothing times or exempts" and caught the
   `In` switch within seconds of it landing.

## Recommendation

**Option 1, then option 3 for the remaining risk.** One declaration removes the drift; a guard is still
worth having, because the surviving list can go stale against `api.wac` itself — which is what happened
here and what neither type could report. Option 2 is the honest end state and is a bigger change than
the problem currently justifies.

Worth doing while `0229a` is fresh: the reason it is a decision rather than a chore is that option 1
makes `wacBind.ts` depend on a 20-member type to use 7, and somebody deliberately did the opposite.
