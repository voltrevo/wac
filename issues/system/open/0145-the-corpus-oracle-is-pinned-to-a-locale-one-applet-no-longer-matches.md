# 0145 — the corpus differential pins bash to `LC_ALL=C`, and since 0143 one applet no longer agrees under it

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-12
- **Kind:** decision
- **Symptom:** no error

## Reproduction

Nothing is red. This is a trap laid for whoever adds the next corpus script, filed because the
failure it produces will look like a shell bug and will not be one.

```
$ printf 'a\xc2\xa0b' > f          # a, U+00A0, b

$ LC_ALL=C     wc -w < f           1      <- what the corpus differential's bash sees
$ LC_ALL=C.UTF-8 wc -w < f         2      <- the ambient environment, and what box now answers
```

`packages/box/test/corpus.test.ts` runs every script twice — once through bash, once through a
shell built from the applets — with `env: { LC_ALL: "C", … }, clearEnv: true`. Since
[0143](../closed/0143-box-wc-counts-words-by-ascii-whitespace-only.md), `box`'s `wc -w` splits
words and judges printability by **code point**, which matches `wc(1)` under this machine's ambient
`C.UTF-8` and not under the pinned `C`. So a corpus script that feeds a non-ASCII byte to `wc`
disagrees on the locale rather than on the shell.

No script does today: of 842 entries exactly one has a byte over 0x7F, and it does not run `wc`.

## Why the pin is there, and why it is not obviously wrong

It came from `packages/sh`'s differential, whose README explained it as making GNU `sort` compare
bytes as ours does. That argument has moved: `packages/sh` gave up every external program (0103), so
of the 554 scripts it still runs, none names `sort`, `wc`, `tr` or `cut`. They all run here now, and
the pin's real value is that a run does not depend on whoever's `LANG` started it.

## The choice

- **Move the pin to `C.UTF-8`.** The oracle then matches the environment the repo actually runs in,
  and matches what `box`'s `wc` was measured against. Checked before proposing: of the tools `box`
  implements, `tr`, `cut`, `fold`, `grep`, `head`, `sort` and `uniq` produce identical bytes under
  both locales on non-ASCII input, and `sort` orders identically because glibc's `C.UTF-8` collates
  by code point. The only tool that moves is `wc`, in the direction that makes it agree. `sed`
  differs between the locales — its `.` is a byte in `C` and a character in `C.UTF-8` — but `box`
  has no `sed`.

  What it costs is a corpus run to confirm none of the 842 scripts' bash output moves, which is the
  reason this is filed rather than done: the measurement above is per tool, not per script.

- **Keep `C` and make `wc` locale-aware.** Then `box` would need a locale, which it does not have
  and which is a larger thing than this. Rejected unless someone wants that for its own sake.

- **Keep `C` and leave the trap**, with the comment in `corpus.test.ts` that is there now. Cheapest,
  and fine until somebody writes the script that hits it.

**What I would do:** the first. The pin's purpose is reproducibility, not C semantics, and `C.UTF-8`
is as fixed as `C` while also being what the machine has. Whoever does it should run
`deno task corpus:backings` either side and compare, rather than trusting the per-tool check above.

## Why it matters

The differential is the thing that says the applets are right, and it now asks its oracle a question
in a locale nobody works in. That is the shape 0143 was: a comment insisting there was no UTF-8
locale to compare against while `LC_ALL` was `C.UTF-8`, and every fixture ASCII, so nothing asked.
