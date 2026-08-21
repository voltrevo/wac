# 0231a — two declarations of one compiler API, and only one of them had a `Res`

- **Status:** closed
- **Closed by:** agent-a, 2026-08-21 — one declaration, and `harness/waccApi.test.ts` guards the pairs
- **Fixed in:** `harness/waccBuild.ts` and `harness/wacBind.ts`, with `harness/waccApi.test.ts`
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

## Closed — one declaration and a guard, 2026-08-21

Option 1 then option 3, as recommended. **And the measurement corrected the recommendation's own framing
on the way**, which is the part worth keeping.

### "20 members and 7" was wrong about the relationship

Counted properly — and the first count was wrong too, because a member whose signature spans lines puts
`paths:` and `entry:` at brace depth zero, so counting braces alone read parameter names as members:

    harness/waccBuild.ts   23 members
    harness/wacBind.ts      8 members
    in the narrow, not in the wide:  2 — `blockedFilesIn`, `emitFilesIn`
    in the wide, not in the narrow: 17

So it was never a 20-member type against a 7-member subset. The wide one already had six of the narrow
one's eight — `0229a`'s morning fix put them there — and the narrow one had exactly **two** it lacked.
Option 1 cost "add two members, delete the duplicate, drop the alias", not "make `wacBind` depend on
twenty to use seven". The objection recorded above as the reason this was a decision does not survive its
own numbers.

`waccRes`'s structural parameter — `{ Res: WaccApi["Res"] }`, which said in its comment that it was this
issue's workaround — is `api: WaccApi` now.

**The argument on the deleted declaration was moved, not dropped.** It said the `In` variants are what a
bind must call because a bind resolves a real graph; that is a fact about `wacBind.ts`, so it stays there,
attached to the cache that holds the api. Which methods *exist* is a fact about `api.wac`, so it lives
with the type.

### The guard asks the narrow question, and that is a choice

`harness/waccApi.test.ts` asserts that for every entry point `api.wac` exports **both ways**, `WaccApi`
names both halves — and, weakly, that it names nothing `api.wac` no longer exports. Canaried both ways:
removing `emitFilesIn` fails the first, planting an `emitFilesNope` fails the second.

The broad question — does `WaccApi` name everything `api.wac` exports — is **49 exports against 25
members**, and it is not asked. Most of the 24 missing are single-file entry points (`dump`, `emit`,
`names`, `blocked`, `dumpTypeErrors`) that a graph-shaped caller has no use for, so asking it means 24
exemption lines, each a judgement about whether a build should want that call. That is the remaining risk
and it is now priced rather than described. The pair check needs no exemptions and catches the failure
that actually happened.

Both extractors are text scans, so a declaration written in a shape the regex does not expect is invisible
to them — the same caveat `tools/benchCompile.test.ts` carries, and the reason option 2 (generate the
declaration from the wire) is still the honest end state.
