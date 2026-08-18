# 0205 — fifteen of nineteen coverage tasks cannot fail, and the summary said "19/19 passed"

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** missing feature
- **Symptom:** no error

## What is true

`deno task coverage:all` runs nineteen drivers. Sorted by what each one holds you to:

- **two hold a coverage floor** — a branch point nothing reaches must carry an entry saying why, and an
  entry that names a line it no longer matches, or a point it claims is unreached while something
  covers it, fails the run. `packages/crypto/cov.ts` is the worked example.
- **two only check their own exemptions have not drifted.** They fail when an entry points at the wrong
  line; they say nothing about coverage falling. `packages/zstd/cov.ts` ends `if (stale) Deno.exit(1)`.
- **fifteen report and cannot fail.** They end with `report(...)` and exit 0 whatever they measured.

The summary line said `19/19 passed`, and `tools/push.sh` prints underneath it that "a package above is
below its recorded coverage" — a sentence true of two of them. So a package that lost half its coverage
was reported as passing, in a block that reads like a gate.

Fixed as far as it can be without deciding anything: the line now reads

    19/19 ran in 11s (35s of work at 4 workers) — 2 hold a coverage floor, 2 only check their own
    exemptions have not drifted, 15 report and cannot fail

counted from the drivers rather than hardcoded, so it follows them.

## The decision

Should the fifteen hold floors? It is not obviously yes, which is why this is an issue rather than a
commit.

- **For.** A number nobody is held to drifts, and this repository's whole argument for the ledger is that
  a measurement with no consequence is decoration. `crypto` was red for days and the gate printed
  "pushing anyway, and this is not fine" every run — but that at least *said something*; fifteen silent
  reports say nothing at all.
- **Against.** A floor is only meaningful where the driver can reach what the tests reach. `crypto`'s
  could not — all five `mlkem_test.wac` tests take `(Core core, Cli cli)` and it can supply neither, so
  its floor needed `MEASURED_BY_THE_BINARY` to be honest (`issues/system/0200`). Any package whose tests
  need a host has the same problem, and a floor recorded against a driver that cannot run them is a
  number that means "what the probes happened to reach".

So the order that makes sense is: **give the drivers a way to see what the binary sees, then add floors.**
`prog.cov` already holds the per-point table and `native/v8/src/main.rs` reads it out of a temp directory
it then deletes; a flag that wrote it out would let a driver union the binary's measurement with its own.
`0200` records that.

## One trap for whoever does this, measured

**Do not compare the two instruments on generic code.** `packages/std/src/map.wac` reads `56/56` from its
driver and `138/392` from `wac test --coverage`, and the driver is the one answering the useful question.
`Map<K, V>` is monomorphised, so the binary counts every instantiation's copy of each branch separately —
seven instantiations of a 56-point file is 392 points, and exercising one of them fully leaves the rest
untouched. Per-instantiation counters *understate* whether the source is tested. The driver dedupes by
source position, which is what "is this branch tested" means.

The comparison is valid where both denominators agree, and there it found real gaps: on
`packages/sh/src/exec.wac` the driver reaches 1080 of 1942 where the binary reaches 1113, because
`sh`'s host-needing tests do run there. No *false* ledger entry turned up in the audit — the entries
checked were all trap guards, correctly named.
