# Fifty-nine applet flags are accepted and ignored

**Status**: open
**Filed**: 2026-08-07

## What

`deno task flags:ignored <box-binary>` asks, for every flag the real tool documents: does the applet
implement it, refuse it, or **ignore** it? Ignoring is the bug. `packages/sh/test/gaps.test.ts` states
this repo's ranking of the three — doing something plausible is worst, refusing is better, saying which
side is incomplete is best — and a flag accepted and ignored is the first of those, handed to a caller
who asked for it by name.

On 2026-08-07, across 43 applets and 375 documented flags: **64 ignored, 5 refused**. Five are now fixed
and **59 remain**:

| applet | flags |
| --- | --- |
| `sort` | `-C -R -S -c -k -m -o -t -z` |
| `strings` | `-U -e -f -o -s -t -w` |
| `nl` | `-b -f -i -l -n -s -w` |
| `du` | `-B -X -b -c -d -m -t` |
| `uniq` | `-D -f -s -w -z` |
| `sha256sum`, `sha512sum` | `-b -c -w -z` each |
| `stat` | `-c -f -t` |
| `wc` | `-L -m` |
| `tac`, `grep`, `basename` | 2 each |
| `tar`, `tail` | 1 each |

`deno task flags:ignored` prints the current list. **The real tool decides what counts**: "changed
nothing" proves nothing on its own — `cat -T` on a file with no tabs is a no-op for GNU too — so a flag
is only judged when the real tool's own output changes for that input. That check took a first run of 213
findings down to 64 true ones.

## Fixed already, and why these five first

- **`base64 -d` and `base32 -d`** re-encoded their input. The caller asked for the opposite of what they
  got, and base64 output looks like base64 either way. `packages/codec` has had `decode` all along, so
  the flag was one import from working.
- **`uniq -d` and `-u`** printed every line. Two flags whose entire purpose is to filter, filtering
  nothing.
- **`echo -n`** printed the newline it exists to suppress — and `-e` is implemented in the same pass
  rather than left in this list.

## The two answers, and which to take per flag

Not all 59 want implementing. Each wants one of:

1. **implement it** — where the applet is close and the flag is common (`sort -k`, `uniq -f`, `wc -m`);
2. **refuse it by name** — `packages/sh`'s `optionRefusal` is the model: a letter GNU has and we do not
   gets "not implemented", and a letter GNU does not have gets GNU's own "invalid option". `cat` and `tr`
   both do this now.

What none of them wants is to stay silent. Refusing is a day's work for the lot of them and would move
every one of these out of the worst category, which is worth more than implementing any three.

## Also found by the same sweep, and not in the list above

Three deliberate divergences, which are not "ignored" and should be *documented* rather than fixed:
`stat` prints a one-line summary where GNU prints a block, `diff` defaults to unified output where GNU
defaults to normal, and `du` counts bytes where GNU counts blocks. Each is defensible; none is written
down.

And two honest refusals that could name the gap better: `cut -c` and `paste -s` answer with a `usage:`
line, which says the caller was wrong rather than that the tool is unfinished.
