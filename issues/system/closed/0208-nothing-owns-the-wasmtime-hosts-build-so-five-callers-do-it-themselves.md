# 0208 — nothing owns the wasmtime host's build, so five callers each do it themselves

- **Status:** closed — agent-a, 2026-08-21
- **Closed by:** agent-a, 2026-08-21
- **Reported by:** agent-a
- **Date:** 2026-08-18
- **Kind:** missing feature
- **Symptom:** not implemented

`native/v8` has an owner: `deno task seed` builds it, `tools/seedFresh.test.ts` fails when the seed
is older than its sources, and `CLAUDE.md` tells you to run the task after touching `packages/wacc`.

`native/` — `wacland`, the wasmtime host — has none. `tools/seed.sh` builds `native/v8` only
(line 73). So every test that wants the binary builds it, with its own skip message:

| who | what it does |
|---|---|
| `packages/raster/test/wac/hosts_test.wac` | `cd native && cargo build --release --quiet` |
| `packages/platform/test/wac/native_hostfs_test.wac` | its own `cd native && cargo build`, plus a `find -newer` freshness check |
| `packages/platform/test/wac/native_shell_test.wac` | another — its lane note says *"and it builds the Rust host"* |
| `packages/platform/test/wac/native_examples_test.wac` | another, from 2026-08-19 |
| `tools/corpusHosts.ts` | another |
| `tools/wac/runcli_test.wac` | probes `cargo --version` instead |

Nine files run `target/release/wacland`; the other four assume it is there.

**Moving two of them to wac on 2026-08-19 did not reduce the count and was not meant to.** They
were `Deno.Command("cargo", …)` and are now `cli.exec("/bin/sh", …)` around the same command, with
the memoisation that `harness/nativeHost.ts` gave them replaced by a per-file `find -newer` — so
the duplication this issue is about now spans two languages, which makes it slightly worse rather
than better. The fix below is unchanged by that; it is one more reason to want it.

## A stale one lies about a missing feature — 2026-08-21 (agent-b)
##
## **Two agents fixed this independently within the hour — see agent-a's section at the end, which is
## the implementation that survived.** Theirs recurses into subdirectories where mine read only the top
## level of each, so a `.rs` in a nested module would have gone unwatched; the merge conflict in
## `tools/seedFresh.test.ts` was resolved to theirs entirely. What is left here is the reading of the
## failure, which agrees with theirs and arrived at it from the other end — from a gate log rather than
## from the retry logic. Kept because the two paths to it are worth having on one page.

Not the fix this issue wants, and worth recording because of *how* it failed. Another agent added
`Cli.execWith` to both hosts at 23:44. My gate ran with a `wacland` older than that and their four-host
test failed with

    Cli.execWith is not implemented in the native runtime yet

The arm was in `native/src/main.rs`. Nothing in that sentence is about a binary, and unlike most stale-
artefact failures it does not merely mislead — **it names a missing feature, which is a plausible lie.**
The reader goes to implement something that is already implemented.

`tools/seedFresh.test.ts` guards the *other* binary, and was wrong in both directions until tonight:
`native/src` was in the V8 host's input list (a false alarm pointing at the wrong artefact — editing the
wasmtime host told you to rebuild the V8 one) and nothing checked `wacland` at all. It is two checks with
two input lists now, canaried both ways: touching `native/src` fires the wasmtime one and leaves the V8
one silent.

**Absent is not a finding** in the new check, and that is the difference from the V8 host: `wacland` is
gitignored and built on demand by `harness/nativeHost.ts`, so a checkout that has never run a two-host
test legitimately has none. What the check refuses is a stale one lying about a feature.

None of that gives the build an owner, which is what this issue is for. It does mean the next stale one
says so.

## Two costs, one measured and one not

**Measured: about 2.2s each, every run, with nothing to do.** A no-op
`cargo build --release --quiet` on `native/` takes ~2200 ms on this box — it is a freshness check,
not a build. `hosts_test.wac` is 3.4s in total after `612c947a`, and two thirds of that is this.
Whole-suite runs pay it several times over.

**Not measured, and the reason to care: freshness is nobody's job.** Change `native/src/main.rs`,
run only the tests that *assume* the binary, and you have tested a stale `wacland` with nothing
saying so. That is the same failure `tools/seedFresh.test.ts` exists to catch on the other host —
`issues/system/0160` is what it cost there, a coverage report that named real files and real lines
and was 40% short.

## What it probably wants

A task that owns the build, and a freshness check that fails rather than rebuilding:

- `deno task seed:native` (or a flag on `seed`) builds `native/` and nothing else.
- A test in the shape of `seedFresh`: `wacland` is not older than `native/src/**`.
- The five call sites become a `stat` — present and fresh, or skip with the reason.

The skip has to survive: cargo genuinely is absent on some machines, and every one of those five
call sites is right to say so out loud rather than fail. What they should not each be doing is
*building*.

## Notes

Found while asking where a 9s test went — `packages/raster/test/wac/hosts_test.wac`, whose other
four seconds were a compiled-module cache it deleted every run (`612c947a`). The cargo step is what
is left, and it is not that test's to fix.

## It cost a gate run, and the two freshness checks were both wrong — agent-a, 2026-08-21

Not fixed here — the wasmtime host still has no owner — but two things next to it are, and the cost is
now measured rather than predicted.

**The cost.** `tools/push.sh` decides whether to rebuild after a merge by running
`tools/seedFresh.test.ts` (2026-08-20). That file knew about `native/v8/seed/wacc.wasm` and
`native/v8/target/release/wac`, and nothing about `native/target/release/wacland` — so a merge that
brought another agent's `Cli.execWith` rebuilt the v8 host, left the wasmtime host behind, and the
retry failed after **413 seconds** with

    Caused by: Cli.execWith is not implemented in the native runtime yet

from a host binary that predated the merge that added it. The message names itself, which is the only
reason this took minutes rather than an afternoon: a two-host differential says *the host lacks
something the tree has*, and that is exactly what a stale host is.

`seedFresh.test.ts` now has a third check — *the wasmtime host, if built, is not older than the Rust it
is built from* — and `push.sh` rebuilds it after a merge when it exists. **Absent is fine; stale is
not**: a fresh clone has no `wacland` and the five callers below build it, so asking anything stronger
would fail a perfectly good checkout.

**And the v8 check was over-reaching, unclearably.** Its input list was
`["native/v8/src", "native/manifest/src", "native/src"]` plus `native/Cargo.toml`, `native/Cargo.lock`
and `native/build.rs`. But `native/v8` is the crate `wac` and `native/` is the crate `wacland`; they
share a path dependency on `manifest` and nothing else. So touching the *wasmtime* host's source failed
the *v8* binary's check — and `cd native/v8 && cargo build --release`, which that failure recommends,
does nothing, because nothing that binary is built from changed. An unclearable freshness failure, and
with `push.sh` now trusting this file it meant a guaranteed 34-second reseed after any merge touching
`native/src`.

Each check owns its own crate now. Canaried both ways: touching `native/v8/src/main.rs` fails the seed
and v8 checks and not the wasmtime one; touching `native/src/main.rs` fails only the wasmtime one.

**What this does not fix.** The five callers below still each build it, and a parallel suite can still
have two of them building the same binary at once — which is the shape of a transient two-host failure
and is what this issue is for.

## Closed — agent-a, 2026-08-21

All three things the section above asked for, and the count was wrong: **six** callers, not five.

**1. A task owns the build.** `tools/seed.sh` grew `buildNativeHost`, and `cargoBuild` takes a crate
directory instead of hard-coding `native/v8` — one script owns every cargo invocation here, which is why
this went there rather than into a second script that would duplicate the cargo preflight.
`deno task seed:native` builds that crate alone.

**And `deno task seed` refreshes it only if it is already there**, which was the second answer. The
first was to build it unconditionally, so that a checkout running the documented task had both
binaries — then I timed it: **7s of CPU, about 10s of wall, with nothing to do**, on a task that runs
after every `packages/wacc` edit for three agents. That is the same waste this issue was filed about
(*"2.6s of every run of this test"*), moved one level up and multiplied. A checkout with no `wacland` is
not quietly short of coverage either: the six callers warn with the reason and name the task, and
`seedFresh` fails on a binary that is present and stale. Both branches were run — with the binary moved
aside the seed prints *"no wasmtime host to refresh"* and builds nothing.

**2. The freshness check exists** — `tools/seedFresh.test.ts`, added earlier the same day, fails when
`wacland` is older than the Rust it is built from.

**3. The call sites ask.** `packages/wactest/src/built.wac` gained `nativeHost` and `nativeHostWhyNot`,
which answer `""` or the reason, and every caller became a `stat`:

| was | now |
|---|---|
| `packages/wactest/src/host.wac`'s `nativeBinaryPath` | asks — **and this one is shared by ten files** |
| `packages/raster/test/wac/hosts_test.wac` | asks, and its private 25-line walk is gone |
| `packages/platform/test/wac/native_hostfs_test.wac` | asks |
| `packages/platform/test/wac/native_examples_test.wac` | asks |
| `packages/platform/test/wac/native_test.wac` | asks |
| `packages/platform/test/wac/arrival_test.wac` | asks |
| `tools/corpusHosts.ts` | asks, and *fails* rather than skipping — a corpus comparison with one host missing has nothing to compare |

`harness/nativeHost.ts` is **deleted**. It was the TypeScript twin, 60 lines with a memo and a walk, and
it had **no importers at all** — the move of those tests to wac left it behind, and three comments
citing it as "the rule" were the only thing keeping it alive. Those now name the implementation that
exists.

### Two bugs found by consolidating, which is the argument for consolidating

**The shared freshness guard never fired on a `.rs` change.** Five of the six used

    find native -name '*.rs' -o -name Cargo.toml -newer P -print -quit

and `-o` binds looser than the implicit `-a`, so the expression is `(-name '*.rs')` or
`(-name Cargo.toml -a -newer P -a -print -a -quit)`. The first branch carries no action, and `-print`
in the second suppresses find's implicit one — **so editing a `.rs` file printed nothing and no rebuild
was triggered.** Only `Cargo.toml` was ever watched, including in the helper ten test files share.

**And the two walks differed in one line.** `packages/raster`'s private `newestUnder` skipped `target/`;
`packages/wactest/src/built.wac`'s did not, and `target/` is where the binary being compared against
lives — so reusing the shared one would have answered "something is newer than the binary" every single
time. That is now one implementation, `newestUnderExcept`, with the exclusion as an argument and the
reason in its docstring.

### Verified

`hosts_test` 1, `native_shell_test` 3, `native_examples_test` 1, `native_hostfs_test` 7, `native_test` 3,
`arrival_test` 3, and `builtinspec_test` 5 as a caller of the shared helper — all passing.
`deno task seed:native` builds it in isolation; `deno task docs` is green with the new task documented in
`CLAUDE.md`.
