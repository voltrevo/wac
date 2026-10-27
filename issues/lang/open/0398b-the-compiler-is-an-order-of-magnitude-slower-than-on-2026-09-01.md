# 0398b — the compiler is 11–16× slower than on 2026-09-01, at every input size, and `./bootstrap.sh` takes ten minutes

- **Status:** open
- **Claimed by:** agent-b
- **Reported by:** agent-b
- **Date:** 2026-10-26
- **Kind:** performance
- **Symptom:** no error — every build is an order of magnitude slower

## Reproduction

`./bootstrap.sh` at `bd041f640` took **10m05s** (611s user): about 4m20s for the ladder to compile the
seed, then two fixed-point rounds of about 150s each. The last recorded run was **36s**, with a seed
half today's size (1.85 MB against 3.72 MB). agent-a's ladder step in `wac-async`, running at the same
time, also took about 4m20s, and load was 2.3 on 5 cores, so it is not one checkout or a busy machine.

Compare the binary built from `bd041f640` with one built on 2026-09-01. Both compile this
to the same 2,638 bytes:

```wac
export i32 fib(i32 n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); }
```

| command | 2026-09-01 binary | `bd041f640` |
|---|---:|---:|
| `wac --version` | 39 ms | 43 ms |
| `wac check fib.wac` | 30 ms | 405 ms |
| `wac compile fib.wac` | 63 ms | 1,001 ms |
| `wac build fib.wac --no-cache` | 112 ms | 1,036 ms |
| `wac check two.wac` (`export i32 two() { return 2; }`) | — | 381 ms |
| ...the same, plus `import { Result } from "core";` | — | 623 ms |

And at the large end, against the figure in `issues/lang/0153` from 2026-08-18:

| `wac build packages/box/src/bin/sh.wac --no-cache` | output | time | per KB of output |
|---|---:|---:|---:|
| 2026-08-18 (0153) | 910 KB | 5,994 ms | ~6.6 ms |
| `bd041f640` | 2,025 KB | 66,156–70,452 ms | ~33–35 ms |

Expected: within a small factor of the September figures.
Actual: 11–16× on a one-line file and about 11× on the shell — about 5× per byte of output even after
allowing for the output having doubled.

## Notes

**It is not startup.** `--version` and an unknown command are 40 ms on both binaries, so loading the
host is unchanged. The cost starts when the compiler runs.

**It is a factor, not an overhead.** A fixed cost would swamp the one-line file and vanish into the
shell's 66s. Instead both are about an order of magnitude slower, so the compiler's own work got
slower across the board. Possible causes, none checked: whole-graph work that now scales with the
embedded `core`/`std` text (a file importing nothing already costs 381 ms to *check*), the seed's code
section doubling to 2.27 MB, or a tiering change in the host. The seed has no coverage or trace custom
section — just `name`, `producers` and `wac.manifest`.

**Nobody has bisected it.** Old binaries cannot compile today's sources (the 2026-09-01 one fails on
`"std"` and on newer syntax), so the comparison above is limited to programs that both binaries accept.
Bisecting means one bootstrap per step, about 10 minutes at the slow end.

**What it costs.** Every agent's bootstrap, every `wac build`, and the gate. `issues/system/0275b`
breaks down where the gate's twelve minutes go and may already contain part of this.

**A neighbour in `bootstrap.sh`, same session.** The `gen:core --check` guard runs whatever binary is
already in `native/v8/target/release/`. A binary too old to compile today's `tools/wac/gencore.wac`
fails that check, and the script reports *"coretext.wac is out of step with core/ and std/"* on a tree
where it is not. The way out is to move the stale binary aside, which makes the script take the
fresh-clone path. The guard should tell "the check could not run" apart from "the check said no".

## Findings (agent-b, 2026-10-27)

Profiled with V8's `--prof` on the native host and `node --prof-process`. There are three causes, and
the two big-program ones are separate from the small-file one.

**1. Fixed: the `core`/`std` embedding was rebuilt quadratically on every call.** Since
`8c3d8b190` (2026-10-03), `gencore.wac`'s `asWac` emitted `for (...) { s = s + lines[i]; }`, so
`stdSource()` copied the text built so far once per line: about 3,400 lines and 350 MB for a 177 KB
text. Lowering, pruning and checking each call it, and it was **73%** of `wac compile fib.wac`. It now
measures the total and copies each line once into one buffer. A/B on the same machine, with the
old-seed arm measured both before and after the new one:

| command | old seed | new seed |
|---|---:|---:|
| `wac check two.wac` | 372 ms | 98 ms |
| `wac check` with `import { Result } from "core"` | 555 ms | 208 ms |
| `wac compile fib.wac` | 988 ms | 143 ms |

`tools/wac/gencore_test.wac`'s `test_the_embedding_is_built_in_linear_time` compares one call with a
single copy of the same bytes. It failed against the old seed (158,051 µs against 109 µs) and passes
on the new one.

**This does not touch the large end.** `wac build packages/box/src/bin/sh.wac --no-cache` still takes
65.7 s, and `./bootstrap.sh` still took 593 s. Profile of that build (59,370 ticks):

**2. `namesTypeDeclC` → `exportsTypeNamed`: about 34%** (`check.wac:1313`, `:1342`). While
`c.viewLater` is set, *every* named type runs `exportsTypeNamed`, which runs `indexOf("export type "
+ name)` over the full text of every source in the graph (179 files for `sh.wac`). The upgrade
happens only for a name that some file really declares as a `type`, so for every other name the scan
repeats until the end of checking. It came in with `6d0bb8e79` (2026-10-14). Likely fix: collect the
`export type` names once per `ViewInputs` and look names up in that.

**3. `registerNamed` → `Env.enumOf`: about 19%** (`emit.wac:543`, `:3611`). For every generic
instance type named by any expression (`collectArrayTypesOfExpr`), the loop runs over every field
in the program and calls `enumOf`, a linear scan of every variant. That is fields × variants per
named type, repeated for types already handled. Likely fix: skip a `t` already processed, or give
`enumOf` an index.

Together that is about 53% of the build. Removing it would bring the shell to about 28 s, still
roughly 4.5× the 2026-08-18 figure, so there is more after these two. Neither is fixed yet.

**Profiling recipe.** Add `if let Ok(f) = std::env::var("WAC_V8_FLAGS") {
v8::V8::set_flags_from_string(&f); }` before `new_default_platform` in `native/v8/src/main.rs`'s
`start_v8`. Then run `WAC_V8_FLAGS=--prof wac …` in an empty directory and process the large
`isolate-*.log` with `node --prof-process`. `build` does its work in a second isolate, so a single
`--logfile` comes out empty. This change was not committed.
