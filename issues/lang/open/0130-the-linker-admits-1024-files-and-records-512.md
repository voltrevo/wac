# 0130 — the linker admits 1024 files and records where 512 of them start

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-15
- **Kind:** bug
- **Symptom:** wrong answer — a diagnostic or coverage point in the 513th file and beyond names a different file

## Reproduction

Not built. It needs a program whose import closure exceeds 512 files, and the largest here is
`packages/box` at 170, so nothing in this repo reaches it. **The fix should come with one** — 600
generated single-function files and an entry that imports them would do it.

What the code says, which is why this is filed anyway:

`linkFiles` (`packages/wacc/src/emit.wac:1957`) sizes its own worklist at 1024 and refuses beyond
that — `string[] seen = string[1024]()`, and `if (sn >= seen.len()) { return ""; }`. Its callers
hand it tables half that size. Seven of the eight sites that allocate them use

```wac
i32[] starts = i32[512]();
string[] filePaths = string[512]();
```

and the writes are guarded rather than checked:

```wac
if (starts.len() > sn) { starts[sn] = countLines(out) + 1; }        // emit.wac:1988
if (filePaths.len() > sn - 1) { filePaths[sn - 1] = path; }         // emit.wac:1993
```

So for a 600-file program the link succeeds, and the line offsets of files 513-600 are never
recorded. The consequence is downstream: the loop that loads the file table walks `starts`, so
`env.fileCount` cannot exceed 512 either —

```wac
for (i32 i = 0; i < starts.len(); i++) {                            // emit.wac:2209, 2385, 2551
  if (starts[i] == 0) { continue; }
  env.fileFirstLine[env.fileCount] = starts[i];
  env.fileCount = env.fileCount + 1;
}
```

— and `fileOfLine` picks the last entry whose first line is at or below the line it is given
(`emit.wac:1540`). Every line in the 513th file and beyond therefore resolves to the 512th. That is
a diagnostic pointing at the wrong file, and a coverage point attributed to the wrong file, with
nothing said.

## Notes

**The asymmetry is the bug, more than the number is.** The same function detects and reports the
*other* table overflowing — an `edges` overrun sets `starts[0] = 1` and `blockedLinked` turns it
into "more import edges than the linker was given room for". Two tables, two overflows, one
reported and one silently absorbed. Whatever 512 is changed to, this one should be reported the way
that one is; a limit that announces itself is a different kind of thing from a limit that quietly
changes the answer.

`blockedLinked` (`emit.wac:7640`) is the odd one out with `string[] filePaths = string[1024]()`,
which matches `seen` and looks like someone hitting this from one direction and fixing it locally.
Its `starts` is still 512, so it is half-fixed, and the disagreement between the eight sites is
itself worth removing: they are eight copies of one decision.

Found while measuring compile time for `issues/lang/0129`, which wants these eight allocation sites
folded into one shared prefix anyway. Doing 0129 would make this a single place to get right, and
the two are worth doing in that order.
