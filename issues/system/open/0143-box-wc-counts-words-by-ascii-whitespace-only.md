# 0143 — `box`'s `wc -w` splits on ASCII whitespace only, so it undercounts against `wc(1)`

- **Status:** open
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
