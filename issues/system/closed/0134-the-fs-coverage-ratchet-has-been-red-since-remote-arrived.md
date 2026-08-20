# 0134 — the `fs` coverage ratchet has been red since `Remote` arrived, and 92 branch points are measured nowhere

- **Status:** closed — 2026-08-12, agent-a
- **Claimed by:** agent-a
- **Reported by:** agent-a
- **Date:** 2026-08-11
- **Kind:** task
- **Symptom:** no error

## Reproduction

```
deno task coverage:fs      # exits 1
```

```
| file                     | points | covered |    % |
| packages/fs/src/fs.wac   |    349 |     228 | 65.3 |
| packages/fs/src/image.wac|     70 |      57 | 81.4 |
| packages/fs/src/path.wac |     17 |      12 | 70.6 |
| packages/fs/src/proc.wac |     49 |      12 | 24.5 |
| packages/fs/src/remote.wac|    92 |       0 |  0.0 |
| packages/fs/src/wire.wac |     20 |      20 |100.0 |
| packages/fs/src/         |    597 |     329 | 55.1 |

268 branch points never executed
238 not accounted for
30 recorded exemptions pinned to lines the code has moved off
```

Expected: exit 0, as it did when `cov.ts` was last edited on 2026-08-07.
Actual: exit 1, and it has since 2026-08-09.

**Now:** exit 0, and the table reads

```
| packages/fs/src/fs.wac     | 360 | 307 |  85.3 |
| packages/fs/src/image.wac  |  70 |  59 |  84.3 |
| packages/fs/src/path.wac   |  17 |  17 | 100.0 |
| packages/fs/src/proc.wac   |  49 |  49 | 100.0 |
| packages/fs/src/remote.wac |  98 |  51 |  52.0 |
| packages/fs/src/wire.wac   |  20 |  20 | 100.0 |
| packages/fs/src/           | 614 | 503 |  81.9 |
```

with every uncovered point either pinned or matched by a category — and commenting out one line of
`cov.ts`'s driver list puts 51 points back into "not accounted for", which is the canary that the
green means something.

## What happened

`src/remote.wac` arrived on 2026-08-09 with the `Remote` backing
([0116](0116-a-spawned-stage-gets-the-hosts-world-not-the-sessions.md)) — 92 branch points
the probe never calls — and `fs.wac` grew the arms that dispatch to it. Nothing said so, because
`deno task coverage:*` is deliberately not in the gate: `tools/coverageAll.ts` explains why, and its
own header is the prediction that came true — "a check nobody runs rots back into the state above".

The whole-repo sweep today, for whoever picks this up:

| | |
|---|---|
| green | bignum, bytes, codec, datetime, fmt, http, json, regex, server, sh, ssh, std, stream, unicode, url, zstd |
| red | **crypto** ([0101](0101-cryptos-coverage-run-has-45-uncovered-branches-and-nobody-sees-it.md)), **fs** (this), **gzip** (one reachable point) |

## The work, and the part that is a decision

Three kinds, and only the first is mechanical:

1. **30 pins have drifted.** Each `NOT_COVERED` entry carries a file, a line and a snippet, and the
   run prints `no longer holds "…" — it holds: …` for each. Moving them is reading.
2. **`proc.wac` at 24.5% and `image.wac` at 81.4%** are ordinary uncovered branches: drive them from
   `test/wac/cov_probe.wac`, or record them.
3. **`remote.wac` at 0.0% is the decision.** A remote mount needs a parent process on the other end
   of a channel, and the probe builds its filesystems itself. It is the same shape as a host mount
   and *not* the same answer: a host mount at least has `test/host.test.ts` comparing it against the
   real filesystem, so recording it as unmeasurable costs nothing. What drives `Remote` today is
   `packages/box/test/sealing.test.ts`, running a sealed session whose stages read and write through
   the channel — a real test, and not a measurement.

   Two options. **Record all 92 with `sealing.test.ts` as the reason**, which is honest and leaves
   the branch coverage of a whole file unknown; or **let the probe be one end of a channel**, feeding
   `remote.wac` encoded requests and decoding its replies without a second process at all — the wire
   is `src/wire.wac`, which is already at 100%. I would do the second: `remote.wac` is a codec with a
   dispatch table, the thing on the other end is a function call, and a file that is 0% measured in a
   package whose own README calls its coverage a ratchet is the exact shape of the three defects that
   ratchet was built to find.

**Do not put `coverage:all` in the gate to fix this.** Two of the three reds are somebody else's, and
a red check in the gate fails every other agent's push for something they did not do. That is
`coverageAll.ts`'s own reasoning and it still holds.

## What was done

All three, and the decision in point 3 went the way this file recommended — with one correction it
did not see.

1. **The 30 pins.** Moved. Six of them had drifted because the code they name had *changed answer*,
   not moved: `FAULT_DENIED` became `FAULT_UNSUPPORTED` in the synthesised backings, `return -1`
   became `NODE_NONE()`, and `image.boot` grew a parameter. A pin that carries a snippet caught each
   one; a pin that carried only a line number would have re-anchored silently onto whatever now sits
   there.
2. **`proc.wac` 24.5 → 100.0**, `path.wac` → 100.0, `image.wac` 81.4 → 84.3, and the rest of `fs.wac`
   65.3 → 85.3. Mostly `permissionOps`: `may(node, 2)` answering *no*, which was the largest single
   group and is the one where a wrong answer matters most. Also `/dev/null` as a stream, `/proc`
   name parsing, `/bin` synthesis, paths through a file, `mkdir -p`'s per-component check, zombies,
   a filesystem with no mount at the root, and an image truncated at each place a directory can stop.
3. **`remote.wac` 0.0 → 52.0**, as the second option: the probe is the wire's own peer for everything
   that needs no *state* to answer — every `encode*`/`decode*` pair round-tripped, the three-way
   listing/null/empty distinction, a broken reader, an answer cut at each place it can stop, and all
   seventeen opcodes pinned by value in `test/wac/fs_test.wac`. The 42 that remain are the `Chan c`
   half: a question written to a handle and a wait for a parent's answer. **The correction:** those
   are not "fed encoded requests and decoded replies" by anything a probe can be, because the peer
   has to *have a filesystem* to answer from — a wac fake has no state, which is exactly what the
   category now says. `packages/box/test/sealing.test.ts` drives them, and that is recorded rather
   than approximated.

Two things in `cov.ts` changed shape to make this hold:

* **Categories**, beside the pins. 116 points are the same fact repeated — "an arm that dispatches to
  a host mount", "a method of `Chan`" — and 116 near-identical pins would bury the reasons that are
  specific. A category matches by what a line, its declaration, or its enclosing `struct` holds, and
  a category that matches nothing fails the run, so it cannot outlive what it explains.
* **The count and the listing come from one set.** They did not: the run said 8 unaccounted and then
  listed 22, because a point named by a pin *and* matched by a category was counted twice. It would
  have gone green with fourteen branches nobody had spoken for — a ratchet reporting the absence of
  the thing it exists to find.

## Notes

`packages/fs/README.md` said 92.7% until today; it now states the table above and points here. The
figure was true of the package that existed on 2026-08-07 — which is the failure mode a percentage in
prose has, and why the four other READMEs corrected in the same commit now date theirs.
