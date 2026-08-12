# 0143 — `box`'s `wc -w` splits on ASCII whitespace only, so it undercounts against `wc(1)`

- **Status:** closed — 2026-08-12, agent-a
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-12
- **Kind:** correctness
- **Symptom:** wrong answer, no error

`box`'s `wc` agrees with GNU `wc` on lines and bytes and disagrees on words, whenever the input
contains a Unicode space. On `spec/tour.wac` — which has 90 lines with a byte over 0x7F — the gap
is 110 words:

```
$ ./box wc tour.wac      933  7064  43752
$ wc tour.wac            933  7174  43752
```

Same line count, same byte count, 110 words missing.

## The repro is one character wide

`wc(1)` in a UTF-8 locale splits on `iswspace`, which is true of several non-ASCII code points.
`box` splits on ASCII whitespace and nothing else:

| input | `box wc -w` | `wc -w` |
| --- | --- | --- |
| `a b` — no-break space | 1 | 2 |
| `a b` — em space | 1 | 2 |
| `a b` — figure space | 1 | 2 |
| `a　b` — ideographic space | 1 | 2 |
| `a b` — line separator | 1 | 1 |

The last row is the one that says this is not simply "handle more spaces": `wc(1)` does *not* split
on U+2028 either, so the rule being implemented is `iswspace` specifically, and a list assembled by
intuition would get that one wrong in the other direction. Every ASCII case — space, tab, newline,
vertical tab, form feed, carriage return, runs of them — already agrees.

## Why it survived

The differential that would have caught this is the one that found it, and it was pointed
elsewhere: the applets are compared *against each other* across compilers, where both halves share
the word-splitting code and agree perfectly. Two implementations cannot see a mistake they both
make. It took running GNU `wc` on the same file — and `sha256sum` on the same run matched coreutils
digit for digit, so the harness was working; there just was no ASCII-only input that could show it.

## What "done" would mean

1. `wc -w` splits on what `iswspace` is true of, decoded as UTF-8 rather than byte by byte.
2. A test with a no-break space in it, asserting the count against a case list that includes
   U+2028 as a *non*-separator — otherwise the fix passes by splitting on everything non-ASCII.
3. Whatever else walks words is checked for the same assumption. `fold`, `cut` and `tr` are the
   candidates; this issue does not claim they are wrong, only that nobody has looked.

The oracle is `wc(1)`, which is installed here.

## Closed 2026-08-12 — and the reproduction was not the bug it names

Both claims in this issue are true, and they are **different rules**. The table of spaces is right.
The 110 words on `spec/tour.wac` are not those spaces: that file contains no Unicode whitespace at
all. Its only characters over 0x7F are `—`, `─` and `😀`, and the gap is exactly the 110
whitespace-delimited runs made entirely of em dash and box-drawing rule. What they run into is the
*other* half of the rule — a run counts as a word only if something **printable** is in it, and
`printable` meant "an ASCII byte between 33 and 126". So fixing the separators alone would have left
the reported number untouched.

The locale is the thing underneath both. `box`'s `wc` implemented the **C locale** exactly:

    $ LC_ALL=C     wc spec/tour.wac      933  7064  43752      <- what box answered
    $ LC_ALL=C.utf8 wc spec/tour.wac     933  7174  43752
    $ echo $LC_ALL                       C.UTF-8

The comment in `wc.wac` defending the ASCII rule said it was measured in the C locale because
"there is no such locale to compare against" for the other one. `locale -a` lists `C.utf8`, and
`LC_ALL` on this machine *is* `C.UTF-8` — so every differential in the repo was already asking the
real `wc` the UTF-8 question, and passing only because no fixture had a byte over 0x7F. The premise
was false, so the decision it justified went the other way.

### The separator list is measured, because no predicate is the rule

Every code point from U+0000 to U+10FFFF, put between two letters and fed to `wc -w`: **23** make
the answer 2. `packages/box/src/lib/words.wac` holds them, and three say why the list is not
derived from anything:

| | `wc` splits | `iswspace` |
| --- | --- | --- |
| U+00A0, U+202F | yes | **no** |
| U+2028, U+2029 | **no** | yes |
| U+2060 word joiner | yes | no, and in no space category |

A list built from `iswspace` gets the first row wrong; a fix that split on "everything non-ASCII"
gets the second row wrong in the other direction. This issue's own table caught U+2028, which is
what made it worth trusting.

### Printability is a table now

`packages/unicode` gained `isPrintable`, generated from the host like the case tables: 733 sorted
ranges, "assigned and not a control, a surrogate, or a line/paragraph separator". Checked against
glibc's `iswprint` under `C.UTF-8` before it was written — they disagree on 5,185 of 1.1 million
code points, every one a character this host knows and that glibc's older Unicode calls unassigned,
and **none** in the other direction. So it is never more permissive than `wc(1)` here.

### What is now true

- `box wc spec/tour.wac` is `933 7174 43752`, byte for byte with `wc`.
- `packages/box/test/box.test.ts` compares against the real `wc` over the 18 code points in the
  table above, each between two words and alone — the second question being the one that separates
  U+200B (a word on its own) from U+2028 (not one). It spawns the real `wc` with the **ambient**
  environment on purpose: pinning `LC_ALL=C` there would make it pass without the fix, which is
  how this survived.
- A character split across a 64 KiB read is held until the next chunk, for each of the three ways a
  sequence can break. Canaried by dropping the held bytes: `em dash broken after 1 byte(s)` fails.
- Item 3 of this issue — `fold`, `cut` and `tr` — **checked and they are right**. GNU's are byte
  oriented here too, so byte oriented is the correct answer for them, and matching `wc` would have
  broken all three. There is now a comparison saying so rather than a sentence.
