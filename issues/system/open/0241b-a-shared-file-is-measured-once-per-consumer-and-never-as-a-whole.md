# 0241b — a shared file is measured once per consumer and never as a whole

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-24
- **Kind:** missing feature
- **Symptom:** wrong answer

## What is true

A coverage ledger names a `PREFIX`, and the prefix is a directory. `packages/tls`'s ledger measures
`packages/tls/`, `packages/quic`'s measures `packages/quic/`. That is the right default and it has one
consequence nobody had looked at: **a file imported across a package boundary is measured separately by
each importer, and never as a whole.**

`packages/tls/src/handshake.wac` is the worked example. It has 108 branch points and two consumers:
`packages/tls` itself and `packages/quic/src/client.wac`. Measured on 2026-08-24:

| exercise | dark | of |
|---|---:|---:|
| `packages/tls/test/cov_exercise.wac` | 36 | 108 |
| `packages/quic/test/cov_exercise.wac` | 33 | 108 |
| **dark to both** | **15** | **108** |

Each driver covers about twenty points the other misses: 21 that `tls` leaves dark are covered by
`quic`, and 18 the other way. So each ledger, read on its own, is overstating the gap in that file by
roughly twenty lines — and the two ledgers together are still not the answer, because nobody computes
the intersection.

## The claim was already wrong when it was written — 2026-08-24

The `tls` ledger's entry originally named **two** consumers, `packages/quic/src/client.wac` and
`packages/webrtc/src/dtls.wac`. The second is false: `webrtc/src/dtls.wac` **declares its own**
`clientHello` and `serverHello`, because DTLS 1.2's handshake is a different wire format from TLS
1.3's, and it imports nothing from `handshake.wac` at all.

That was caught the same day, by accident, when `packages/webrtc`'s driver was pointed at the file to
collect a third term for the table above and reported **zero points** — the file is not in its
compilation graph.

**This is the argument for the whole issue, and it did not need a year to rot.** The entry was written
carefully, by someone who had just read the imports, and it was half wrong within the hour. Nothing in
the ratchet could have said so: a rule that matches uncovered points and gives a reason is checked for
*matching*, never for whether the reason is true. Every other exemption reason in every ledger here is
at least a statement about code the reader can go and look at. "Somebody else covers it" is a
statement about a measurement nobody took.

## Why it matters more than the arithmetic

**A ledger entry cannot tell "nothing reaches this" from "the neighbour reaches this".** Both read as a
line in the uncovered list, and the ledger's whole job is to make somebody write down which one it is.
`packages/tls`'s ledger carries this, and after the correction above it is now true:

> `parseServerHello` and `clientHello`, which this package does not call. […] A ledger's prefix is a
> directory, so a shared helper reads as dead from the side that exports it.

True today, and unverifiable tomorrow. Both checks it has had — quic's, which confirmed the covering
half, and webrtc's, which demolished the other — were hand-run one-offs by somebody who happened to
be curious. If `packages/quic` stopped calling `parseServerHello` next week, both ledgers would stay
green: quic's because it does not measure that file, and tls's because its rule says somebody else
does.

**That is the failure mode this is worth fixing for.** It is not that the numbers are pessimistic. It
is that "covered by a neighbour" is the one exemption reason nothing can verify, and it is currently
the only one available for a shared file.

## What would settle it

`measure` already collects every point the exercise executed, across every file it compiled — the
prefix is applied at `report` and `ratchet`, not at collection. So the data exists and is thrown away.
Two shapes, in increasing order of work:

1. **A second prefix per ledger.** Let a ledger declare files outside its own tree that it also
   accounts for, so `packages/quic`'s ledger can hold entries about `packages/tls/src/handshake.wac`.
   Cheap, and it puts the entry in the wrong place: the file's own package is where a reader looks.
2. **A union pass in `tools/wac/coverageall.wac`.** Every driver already runs there. Collecting each one's
   point set, unioning per file, and reporting files whose union is better than any single driver's
   reading would name exactly the shared files and say by how much. That number — *this file reads 67%
   from its own package and 86% across all of them* — is the one a reader wants, and it is the one
   nothing can produce today.

The second is the real answer and it needs `covdump`'s per-point table to survive the run rather than
being summarised into a percentage. `issues/system/0200` already wanted that for a different reason.

## What it is not

Not an argument against per-package prefixes. A package's own floor is the thing that fails when
somebody deletes a test, and it should stay exactly as it is. This is about the *reason column* — one
class of exemption that is currently a promise rather than a measurement.

## Found by

`issues/system/0205`'s seventh, eighth and ninth drivers — `packages/tls`, `packages/quic` and
`packages/webrtc`. The `tls` ledger raised it as a gap it could not close; the `quic` driver confirmed
the covering half by hand and produced the table; the `webrtc` driver, pointed at the same file for a
third term, reported zero points and disproved the rest.

## Done — `tools/coverageUnion.ts` — agent-b, 2026-08-29

`covreport --points` prints every point as `file<TAB>line<TAB>col<TAB>count`, with **no prefix
filter**. That is the half this issue says is thrown away:

    $ wac run … tools/wac/covreport.wac packages/codec/test/cov_exercise.wac packages/codec/ --points
    packages/codec/src/hex.wac	10	5	180600
    packages/codec/src/hex.wac	10	44	112884
    …                                             255 rows

Keyed by **source position and not by counter index**, which is the thing that makes a union
possible at all: each driver compiles its own graph and numbers its own points, so index 41 in
`tls`'s run and index 41 in `quic`'s are unrelated. `file:line:col` is the key both agree on.

### What is still in the way, which is not the data

The union has to run *every* driver, and a driver is not `covreport` — it is
`packages/<pkg>/test/cov_ledger.wac`, which holds three things the runner would need and which live
nowhere else:

- the exercise path (`EXERCISE`),
- the grants it is built with (`grants()`, five of them for `tls` and `quic`),
- the case exports called after `main` (`cases()`, which `quic` has none of and `tls` has a list of).

So a union runner either duplicates all of that per package, or the ledgers grow a `--points` mode
of their own. The second is right and it is thirty-seven near-identical edits, because **each ledger
parses its own flags inline**:

```wac
  bool verbose = false;
  i32 argc = cli.argCount().wait();
  for (i32 i = 0; i < argc; i++) {
    if (string.fromBytes(cli.arg(i).wait()) == "--verbose") { verbose = true; }
  }
```

That loop is copied into all of them. Factoring it into `covledger.wac` — one call returning the
flags — is the change that makes `--points` a one-line addition per ledger instead of a five-line
one, and it is worth doing first whoever picks this up.

**Not done here** because it is thirty-seven files of the gate's own tooling, and the enabling piece
stands on its own: the per-point table exists and is reachable from a command line, where before it
was computed and discarded inside the report.


## The number, produced — agent-b, 2026-08-29

    $ deno run -A tools/coverageUnion.ts tls quic

    | file                           | owner | points | its own  | across all | gained |
    | packages/tls/src/handshake.wac | tls   |    108 | 80 (74%) |   96 (89%) |    +16 |

Which is this issue's own sentence — *this file reads 67% from its own package and 86% across all of
them* — with the figures it actually has today. `tls`'s ledger reports 28 dark points in that file;
sixteen of them are executed by `quic`'s exercise, and twelve are dark to both.

The 2026-08-24 row above reads 36 dark to `tls` and 15 to both, against 28 and 12 now. Nothing in
`handshake.wac` changed; three commits to `packages/tls/test` did.

### Two things the build turned up, both worth more than the number

**The key is `line:col:kind`, not `line:col`.** The first version keyed on the position and reported
**12** dark where the ledger reports 28 — several counters sit at one position, `handshake.wac` has
108 points over 75 of them, and folding them together hides a dark branch behind a lit one beside it.
What caught it was checking the instrument against the ledger's own row before believing it: 108
points, 80 covered, both sides agreeing exactly. `reportPoints` prints `kind` for that reason.

**And "its own" means nothing where the owner did not run.** Restricted to two packages, the first
run reported forty-six files — most of them in `wactest` and `crypto` — as read 0% by their own
package, which was true and meant nothing, because those packages were not in the run. Files whose
owner has no table in this run are skipped now.

### What is left

Every ledger takes `--points`, so the full sweep is `deno run -A tools/coverageUnion.ts` with no
arguments. It runs the drivers one at a time and is a report somebody asks for rather than something
on the push path: `tools/wac/coverageall.wac` is untouched and a package's own floor still fails exactly when it
did.
