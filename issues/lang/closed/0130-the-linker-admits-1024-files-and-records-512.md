# 0130 — the linker admits 1024 files and records where 512 of them start

- **Status:** closed
- **Fixed in:** this commit
- **Reported by:** agent-b
- **Date:** 2026-08-15
- **Kind:** bug
- **Symptom:** wrong answer — a diagnostic or coverage point in the 513th file and beyond names a different file

## Fixed

`starts` and `filePaths` are 1024 at all seven and five of their allocation sites, matching the
1024 the linker actually walks; `Env`'s own `fileFirstLine` and `filePaths` are 1024 too. Those last
two are arguments **#45** and **#73** of the positional `Env(...)` constructor, found by parsing the
struct's fields at brace depth 1 — a first attempt counted local declarations inside `Env`'s methods
as fields and got 103 against 97 arguments, which lines up with nothing.

Widening only the linker's tables moves the reproduction from 511 distinct files to **513**, not
601: `env.filePaths` is the binding constraint for the names, and `env.fileFirstLine` for the lines.
Both had to go. With all four, the 600-file case names all 601.

`packages/wacc/test/manyFiles.test.ts` generates 560 files and asserts every one is named. Canaried:
with the fix reverted it reports "1681 coverage points name 511 distinct files, not 561 — 50 file(s)
got none".

Every emitted module in the repo is byte-identical except wacc's own three, which compile the file
this changes. 196 tests in `packages/wacc`.

## Reproduction


**Built, and it reproduces.** 600 generated files, each with one branching function, and an entry
that imports them all:

```python
N = 600
for i in range(N):
    open(f"f{i}.wac", "w").write(
        f"export i32 v{i}(i32 x) {{\n  if (x > 0) {{ return {i}; }}\n  return 0;\n}}\n")
imports = "\n".join(f'import {{ v{i} }} from "./f{i}.wac";' for i in range(N))
calls = " + ".join(f"v{i}(1)" for i in range(N))
open("main.wac", "w").write(f"{imports}\n\nexport i32 total() {{ return {calls}; }}\n")
```

It builds, `blockedFiles` says `""`, and the module is correct — `total()` answers 179,700, which is
right. **What is wrong is who the code belongs to.** `covTableFiles` reports 1,801 coverage points
across **511 distinct files**, not 601:

| file | points |
|---|---:|
| `f0.wac` | 3 |
| `f100.wac` | 3 |
| `f400.wac` | 3 |
| `f511.wac` | **0** |
| `f512.wac` | **0** |
| `f550.wac` | **0** |
| `f599.wac` | **0** |

Every point past the cut is attributed to some earlier file. A coverage report over this program
would be confidently, silently wrong, and so would any diagnostic whose line lands there.

What the code says:

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

## What blocks the fix

Raising the eight `i32[512]()` / `string[512]()` allocations is not enough on its own, and doing
only that makes things worse rather than better. The loop that loads the table reads

```wac
env.fileFirstLine[env.fileCount] = starts[i];      // no bounds guard
if (env.fileCount < env.filePaths.len() && …) { env.filePaths[env.fileCount] = filePaths[i - 1]; }
```

`env.filePaths` is guarded; `env.fileFirstLine` is not. `Env`'s own `fileFirstLine` is
`i32[512]()` — argument **#45** of a 97-argument positional `Env(...)` constructor, identifiable
because argument #46 is the `0` for `fileCount` beside it. So widening `starts` alone turns a silent
truncation into an out-of-bounds trap at file 513.

The constructor is what makes this awkward rather than mechanical: it is one call with 97 positional
arguments against 103 declared fields, so the two do not line up by counting and the later slots —
`filePaths` among them — cannot be located that way. Somebody widening these tables should either
name the arguments or start by making that constructor legible, and should keep the reproduction
above to check against, because nothing else in the repository reaches this path.

## Notes

**The asymmetry is the bug, more than the number is.** The same function detects and reports the
*other* table overflowing — an `edges` overrun sets `starts[0] = 1` and `blockedLinked` turns it
into "more import edges than the linker was given room for". Two tables, two overflows, one
reported and one silently absorbed. Whatever 512 is changed to, this one should be reported the way
that one is; a limit that announces itself is a different kind of thing from a limit that quietly
changes the answer.

`blockedLinked` (`emit.wac:7640`) is the odd one out with `string[] filePaths = string[1024]()`,
which matches `seen`. It is not a partial fix, though — it hands the table to `linkFiles`, which
fills it, and then calls `emitBlockedOf(blob.toBytes(), declCountOf(…), starts, edges, names)`
without it. The 1024 entries are written and dropped, and the blocked walk is the one path that
never populates `env.filePaths` at all. So the odd size is dead rather than corrective, and
whatever it was reaching for it did not get.

The disagreement between the eight sites is itself worth removing: they are eight copies of one
decision, and this is what happens to the copies.

Found while measuring compile time for `issues/lang/0129`, which wants these eight allocation sites
folded into one shared prefix anyway. Doing 0129 would make this a single place to get right, and
the two are worth doing in that order.
