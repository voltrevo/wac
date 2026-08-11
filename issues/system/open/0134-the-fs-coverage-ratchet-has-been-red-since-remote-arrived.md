# 0134 — the `fs` coverage ratchet has been red since `Remote` arrived, and 92 branch points are measured nowhere

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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

## What happened

`src/remote.wac` arrived on 2026-08-09 with the `Remote` backing
([0116](../closed/0116-a-spawned-stage-gets-the-hosts-world-not-the-sessions.md)) — 92 branch points
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

## Notes

`packages/fs/README.md` said 92.7% until today; it now states the table above and points here. The
figure was true of the package that existed on 2026-08-07 — which is the failure mode a percentage in
prose has, and why the four other READMEs corrected in the same commit now date theirs.
