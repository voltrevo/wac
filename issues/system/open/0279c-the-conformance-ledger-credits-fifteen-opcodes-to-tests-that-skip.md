# 0279 — the conformance ledger credits fifteen opcodes to tests that skip

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-29
- **Kind:** missing feature
- **Symptom:** wrong answer — a coverage number that counts comparisons which did not happen

## What is wrong

`packages/platform/test/wac/conformance_test.wac` is the ledger of what a second host has to answer
the same way, and it is careful: it derives which hosts each cited test *drives* rather than
believing a hand-written list, and its header names the exact failure that design prevents —

> how `LINK_STAT` and `SET_EXECUTABLE` sat marked covered while the Node host answered a zeroed
> `Stat` and *this filesystem has no mode bits to set*.

It does not know that a cited test can **skip**. Three of the files it cites need the wasmtime host,
which `CLAUDE.md` says is *"not built by default"*, and they skip with a reason when it is absent:

    native_hostfs_test.wac      17 citations   skips — 9 sites
    native_shell_test.wac        7 citations   skips — 3 sites
    native_examples_test.wac     6 citations   skips — 4 sites

For **15 opcodes that is the only comparison there is**:

    LINK_STAT  MKDIR  OPEN_INPUT  OPEN_OUTPUT  READ_CHUNK  SPAWN_SELF  EXIT_CODE
    CLOSE_SEND  CLOSE_FEED  CWD  NOW_MILLIS  SLEEP_MILLIS  RANDOM_BYTES  CONNECT  RECV

The other 17 have a second citation that runs — which is **not** the same as being fine, and
`CLOSE_SOCKET` is the proof. It is cited to `native_hostfs_test.wac` *and* `node_net_test.wac`, so it
counts as doubly covered; the second compares Deno against Node, and the bug was in the **v8** host,
whose only comparison for that opcode was the one that skips. That is `issues/system/0275c`, where
`yes | head -2` hung for twenty seconds.

So the number this issue is about is at least 15 and the real question is per host rather than per
opcode: *which hosts is this opcode actually compared across, on the machine running the suite?*

**The push gate is such a checkout.** Its own output says so, five times a run:

    [w2] native_hostfs: skipped — cargo did not build `native`, so nothing was compared

So on the thing that decides whether code lands, those fifteen are compared against nothing while the
ledger counts them as compared.

## Why this is worth fixing rather than noting

Three of these are bugs found on 2026-08-29, hours before this was written:

- **`OPEN_OUTPUT`** — `issues/system/0277c`. A spawned child's redirect was skipped on both Rust
  hosts, so `box cp README.md out` printed the file to standard output and left `out` empty, exit 0.
- **`SPAWN_SELF`** — `issues/system/0276c`. On a JavaScript host it re-ran the launcher's program
  rather than the child's, so a pipeline stage started `wac` with the stage's argv.
- and **`CLOSE_SOCKET`** — `issues/system/0275c` — through the per-host hole described above.

All three were found by driving `wac app` by hand for `design/system/0009`, not by any test. The
ledger said all three were covered.

`CLAUDE.md` says *"a checkout without one is not quietly short of coverage"*, and for a **reader** of
the test output that is true — the skip prints a reason. It is the ledger that is quiet: the skip is
loud in one place and invisible in the one whose whole job is counting.

## What would fix it

The instrument already derives hosts from what a cited file spawns. The same walk can ask whether the
file *can* run: `nativeHostWhyNot()` in `packages/wactest/src/built.wac` is the single predicate every
one of these skips consults, so an entry citing a file that calls it is an entry whose coverage is
conditional.

The honest report is two numbers rather than one — *compared here* and *compared where every host is
built* — because both are true and they differ. A single number has to pick, and picking the larger
is what this issue is.

Not doing it: making the gate build the wasmtime host. That is `issues/system/0208`'s territory,
which closed deliberately the other way — eleven files skip rather than build a Rust crate nobody
asked for — and 15 minutes of cargo on every push is a large price for a count.

## Notes

Found by asking why four host bugs in one day all had the same shape: a capability implemented
correctly on one host and not another, surviving because nothing exercised the wrong one. The others
were `0275c` (wasmtime right, v8 wrong) and `0278c`.


## The stronger statement: the comparison that *does* run excludes the shipped host

Everything above is about coverage that skips. There is a worse case, found on 2026-08-29 while
sizing `design/system/0009`'s remaining migration.

`native_hostfs_test.wac` is this ledger's most-cited file — seventeen entries. It builds the same
program two ways and compares:

- a **Deno** artefact, from `packages/platform/build.ts`, which is always available;
- the **wasmtime** binary at `native/target/release/wac`, which skips when it is not built.

The **v8 host is not in that comparison at all.** It appears once, as the thing that *builds* the
native side — `cli.exec(root(cli) + "/native/v8/target/release/wac", …)` — and never as a host under
test. `native/` is the wasmtime crate and `native/v8/` is the one the command ships as.

**So the default binary is structurally absent from the tree's most-cited cross-host comparison**,
and that is not a gap in what it covers but in what it compares. `issues/system/0277c` is the proof:
`openOutput` for a spawned child was correct on Deno *and* correct on wasmtime, and wrong on v8. No
number of opcodes and no amount of building the wasmtime host would have surfaced it here.

Five of the nine divergences found that day were v8's.

### What follows

This makes the ledger's number optimistic in a second, independent way. An opcode can be *credited*,
*compared*, and *not compared on the host that ships* — and nothing distinguishes the three.

It also reframes `design/system/0009`'s choice about `build.ts`'s deno target. Keeping it preserves a
comparison with a hole exactly where the bugs are. The successor pattern — one artefact run under
several hosts, which `packages/ts/test/wac/bootstrap_test.wac` demonstrates — puts v8 in the
comparison for the first time, because each host's `wac` runs the same artefact. That was verified by
reintroducing `0277c` and watching it fail.
