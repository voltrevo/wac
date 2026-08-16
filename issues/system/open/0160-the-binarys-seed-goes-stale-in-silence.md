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
