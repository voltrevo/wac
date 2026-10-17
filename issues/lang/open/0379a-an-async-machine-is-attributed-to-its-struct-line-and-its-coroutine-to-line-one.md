# 0379a — an `async` machine's branch points land on its struct's line, and its coroutine's entry on line 1

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-17
- **Kind:** diagnostic
- **Symptom:** wrong answer

## Reproduction

`wac task coverage:fs`, with `packages/fs`'s `Fs` methods `async` (`design/system/0011` step 4):

```
wac run --allow-read --allow-write --allow-run packages/fs/test/cov_ledger.wac --points | grep 'fs.wac	154	'
```

Expected: each method's state machine — its `loop`, its `case` per state — on that method's own line,
and each `__wacCo_` coroutine's `entry` at the declaration it was lowered from.
Actual: every `async` method of `struct Fs` puts its machine at `fs.wac:154` (`export struct Fs {`),
column 8 for the statements and `1000 + 100 * m` offsets for the entries — 132 `case` points with a
count of 0 among them — and every coroutine's `entry` in `fs.wac` and `remote.wac` is at `1:1`.

## Notes

- The method's `Site` is built from the *struct's* position (`asynclower.wac`, `machineOf(w, Site(me.params,
  self, at.line, at.col, …))`, where `at` is the struct), and the column base is an offset on it. A
  method's own line is `me.nameTok`'s.
- The coroutine form is named by a token appended after the source (`coTokFor`), and the entry point
  appears to take that token's position rather than the `Decl`'s, which is the original function's.
- Coverage is keyed by line, so one line carries the union of every machine's states and any untaken
  state anywhere makes it uncovered. `packages/fs/test/cov_ledger.wac` pins `fs.wac:154` and
  `remote.wac:1` with this issue as the reason; both pins go when this is fixed, and the points then
  land on the method lines, where the ledger's existing reasons (host mounts, live channels) apply.
- Diagnostics in lowered code are affected the same way: a span inside a machine names the struct.
