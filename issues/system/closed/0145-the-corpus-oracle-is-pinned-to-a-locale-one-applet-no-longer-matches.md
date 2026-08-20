# 0145 — the corpus differential pins bash to `LC_ALL=C`, and since 0143 one applet no longer agrees under it

- **Status:** closed — 2026-08-12, agent-a
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
[0143](0143-box-wc-counts-words-by-ascii-whitespace-only.md), `box`'s `wc -w` splits
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

## Closed 2026-08-12 — moved, and the corpus says nothing else moved with it

`LC_ALL=C.UTF-8` in `packages/box/test/corpus.test.ts` and the five `tools/corpus*.ts` runners.

```
$ deno test packages/box/test/corpus.test.ts     ok, 23s
$ deno task corpus:backings                      842 of 842 scripts agree across memory,
                                                 image and a host mount
```

The per-tool measurement in the section above is not what settles it, because **the oracle here is
bash and not only the tools bash calls**. Bash's own `[[ =~ ]]`, `case` ranges and collation are
locale-sensitive in principle; measured, they are identical under `C` and `C.UTF-8`, for the same
reason `sort` is — glibc's `C.UTF-8` orders by code point. The corpus names no `sed` and no `awk`,
which are the tools that would have made this interesting: `sed`'s `.` is a byte in one locale and a
character in the other. What it does name is `printf` (172 scripts), `tr` (75), `grep` (39), `wc`
(25) and `sort` (7), and all 842 agree either way — with `wc` now agreeing *because* of the move
rather than in spite of it.

**`packages/sh`'s own differential stays on `C`,** deliberately rather than by oversight. It runs no
script that names an external program, so the only locale-sensitive thing in it is bash, which is
identical under both. Two differentials with different oracle locales reads as inconsistent until you
ask what each one compares; changing it would be churn with no measurement behind it.

`packages/box/test/box.test.ts`'s `ls` comparison also stays on `C`, and that one carries its own
argument in place: C collation is what the applet implements, and a locale-aware `ls` is a different
program that is not written.
