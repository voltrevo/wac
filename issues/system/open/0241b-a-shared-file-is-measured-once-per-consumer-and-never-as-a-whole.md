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

`packages/tls/src/handshake.wac` is the worked example. It has 108 branch points and three consumers:
`packages/tls` itself, `packages/quic/src/client.wac`, and `packages/webrtc/src/dtls.wac`. Measured on
2026-08-24 with two of the three drivers that exist:

| exercise | dark | of |
|---|---:|---:|
| `packages/tls/test/cov_exercise.wac` | 36 | 108 |
| `packages/quic/test/cov_exercise.wac` | 33 | 108 |
| **dark to both** | **15** | **108** |

Each driver covers about twenty points the other misses: 21 that `tls` leaves dark are covered by
`quic`, and 18 the other way. So each ledger, read on its own, is overstating the gap in that file by
roughly twenty lines — and the two ledgers together are still not the answer, because nobody computes
the intersection.

## Why it matters more than the arithmetic

**A ledger entry cannot tell "nothing reaches this" from "the neighbour reaches this".** Both read as a
line in the uncovered list, and the ledger's whole job is to make somebody write down which one it is.
`packages/tls`'s ledger currently carries this, honestly and unverifiably:

> `parseServerHello` and `clientHello`, which this package does not call. […] Tested elsewhere again,
> and this is the third kind of elsewhere this package has turned up […] A ledger's prefix is a
> directory, so a shared helper reads as dead from the side that exports it.

That entry is *true* — checking it was the first thing `packages/quic`'s driver did, by pointing its
own prefix at `handshake.wac` — but the check was a hand-run one-off, and there is nothing to stop the
claim rotting. If `packages/quic` stopped calling `parseServerHello` tomorrow, both ledgers would stay
green: `quic`'s because it does not measure that file, and `tls`'s because its rule says somebody else
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
2. **A union pass in `tools/coverageAll.ts`.** Every driver already runs there. Collecting each one's
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

`issues/system/0205`'s seventh and eighth drivers, `packages/tls` and `packages/quic`. The `tls` ledger
raised it as a gap it could not close; the `quic` ledger confirmed the specific claim by hand and
produced the table above.
