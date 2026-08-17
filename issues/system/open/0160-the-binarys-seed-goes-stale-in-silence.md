# 0160 — the binary's compiler is whatever you last built, and nothing says when

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-15
- **Kind:** bug
- **Symptom:** wrong answer — a plausible number, 40% short, from a tool that looks like it worked

## Reproduction

`native/v8/seed/` is in `native/v8/.gitignore`, so every agent builds their own and nothing
compares it with anything. Mine was built on 2026-08-13 at 06:11. Between then and 2026-08-15
`packages/wacc/src/emit.wac` took **19 commits**, two of them touching coverage emission.

The binary built from that seed compiles with the older compiler, and says nothing:

```
wac test --coverage packages/std/test/wac/map_test.wac      227 coverage points
deno test packages/std/test/map.test.ts                     367 coverage points
```

Same twelve files, same test file, same compiler *by name*. After
`deno task app:native packages/wacc/example/wacc.wac … -o native/v8/seed/wacc` and a rebuild, both
report 367 and all 16 tests attribute identically.

## Why this is worth a guard rather than a note

Nothing about the smaller number looks wrong. It is a coverage report, it names real files and real
lines, and it is 40% short. I spent an hour treating it as a bug in the profiler I had just written
— the shape of the evidence pointed there, because my per-test sets were a strict *subset* of the
other path's, which is exactly what an attribution bug looks like.

The general form: **a build artefact that is gitignored, produced by a command nobody runs on a
schedule, and consumed by a tool that reports numbers.** There is no step in which the staleness is
visible. `wac test`, `wac build` and `wac run` all use it, so the same trap applies to anything
measured or compiled through the binary — the coverage number is just where it happened to surface.

## What would fix it

A repo-side check, since the binary is meant to be standalone and cannot know where wacc's sources
are. Something in the suite that, **when the seed exists**, fails if it is older than the newest file
under `packages/wacc/src/` — skipped entirely when it does not, because a checkout without a seed is
a perfectly good checkout.

That is cheap, and it is the only thing here that would have said "your compiler is two days old"
before a measurement did.

Worth pairing with the other direction: `wac --version` says nothing about which compiler is inside
it. A seed that carried the commit it was built from would make this diagnosable from outside the
repository too, which matters if the binary is ever handed to anybody.


## A stale seed fails other people's tests, in their names — 2026-08-15

Worth adding because it happened while this issue was still warm, and the symptom pointed somewhere
else entirely.

A full suite run failed **four** tests: this issue's own `seedFresh`, and three in
`harness/nativeTestProfile.test.ts` saying *"the profile has no `skipped` list … Keys present: all,
entry, tests"*. Those three had just been written, so the obvious reading was that they were new and
flaky, or that whatever else was in the tree had broken them.

They were correct and the seed was old. `wac test` writes the profile, `wac test` compiles with the
seed, and the seed predated the commit that added `skipped` — so the binary was producing an older
format and the new test was right to refuse it. Rebuilding the seed made all four pass.

So the failure mode is worse than "plausible numbers from an older compiler": **a stale seed fails
tests belonging to whoever last changed the host**, with a message about their feature and no mention
of the seed. `seedFresh` firing in the same run is the tell, and it is worth reading first when
anything that runs `wac` fails.


## The guard is mtime-based, and that costs a rebuild per canary — 2026-08-15

Not a complaint about the guard, which caught two real staleness bugs for me today. A measurement of
what it costs, from a day of using it.

`seedFresh` compares the newest mtime under `packages/wacc/src` against the seed's. That is the right
*direction* — it can only be over-eager, never miss — and over-eager has a price here, because the
commonest way to touch a wacc source without changing it is the thing this repository does constantly:
canary a check, watch it fail, restore the file. `cp backup file` writes a new mtime with identical
bytes, and the next suite run demands a rebuild that changes nothing.

That happened **four times** in one session, at roughly a minute each. Three agents doing canary work
pay it independently.

### The fix wants a stamp, which is why it is not a two-line change

The seed is a wasm blob and does not record what it was built from, so nothing can compare content
without something writing it down. The shape:

- `deno task seed` writes `native/v8/seed/wacc.sources.sha256` beside the seed — a hash over the same
  file set the test walks, in a stable order.
- `seedFresh` prefers that hash and falls back to mtime when it is absent, so a checkout that has
  never run the new task behaves exactly as it does now.

Both files are gitignored together, so they cannot disagree across a clone.

**Not built**, because the task and the test are both this issue's and it is open. Recorded so the
decision has the cost beside it: mtime is correct and cheap, and it charges a minute to every canary.

## The skip became a failure — 2026-08-17

The half of this that was about a *missing* seed rather than a stale one is done, and it cost an hour
first, which is the argument for it.

A fresh container has no seed — it is gitignored, one per agent — and `seedFresh` skipped on absence
by design, with a comment explaining that a checkout without one is a perfectly good checkout because
the binary is then only a runtime. That was true when it was written. It stopped being true when
tests started driving `wac test`: on a clean pull, `harness/nativeTestProfile.test.ts` failed twice
with

    no profile directory after `wac test --coverage` (exit 1)
    wac: cannot read test.json — No such file or directory (os error 2)

which names an artefact three steps downstream of the missing compiler that explains it, while the
guard built for exactly this reported **ok**.

So `seedFresh` now fails when the seed is absent, with `deno task seed` in the message, and its name
says what it checks — *"the seed inside `wac` is there, and not older than wacc's sources"*. Canaried
by moving the file away and back.

The general shape is worth keeping: **a guard that explains why it is safe to skip is making a claim
about the rest of the tree**, and that claim ages without anyone editing the guard.
