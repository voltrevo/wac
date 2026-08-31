# 0299 — `find` ignores `-name` and `du` reports bytes where GNU reports blocks

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** wrong answer — a filter that filters nothing, and a size in the wrong unit

## Reproduction

In a directory holding `fields.txt`, `m1.txt` (17 bytes), `m2.txt` and `prose.txt`:

| | GNU | box |
|---|---|---|
| `find . -name m1.txt` | `./m1.txt` | **the entire walk** |
| `du m1.txt` | `4` | **17** |
| `find .` | directory order | sorted |

## The two that are wrong

**`-name` is accepted and ignored.** `find . -name m1.txt` prints every entry, so a filter that
matches nothing and a filter that matches everything are the same command. This is the failure
`lib/flags.wac` exists to prevent — it refuses a flag an applet has not implemented rather than
letting it look supported — and `find` escapes it because `-name` takes a *value*, which the shared
parser reads as an operand rather than as a flag. `flagsChecked(name)` does not list `find`.

**`du` answers in bytes.** GNU's `du` is *disk usage*: 1K blocks by default, so a 17-byte file is `4`
on a filesystem with 4K blocks. box printed `17`, which is the file's size — a different quantity that
happens to be a number in the same column. Every `du` answer this system has given is in the wrong
unit, and the two agree only for a file whose size happens to equal its block count.

`-h`, `-s` and `--block-size` all inherit the same fault, since they scale whatever the base number is.

## The third is a difference, not a defect

`find .` answers in **sorted** order where GNU answers in directory order. Sorting is defensible and
arguably better — it makes output reproducible — but it is a divergence, and this repository's rule is
that a divergence is written down rather than discovered. Worth a decision rather than a fix: if
sorted is deliberate, `packages/sh/README.md` records the other divergences and should record this.

## How they were found, and what to do with them

Lifting `box.test.ts`'s applet-agreement sweep into `appletCases()` — `issues/system/0193`. The 29
other invocations added at the same time all agreed with GNU; these three did not, and they had never
been compared before, because the Deno test asked `find` and `du` only through *shape* assertions
rather than byte-for-byte against the real tool.

**The regression tests are three lines**, and they belong in `packages/box/test/wac/cases.wac`'s
`appletCases()` on the day they pass:

    "find .", "find . -name m1.txt",
    "du m1.txt",

They are not there now because a red vector case is a red suite for everybody. The comment in that
file points here.
