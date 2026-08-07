# Fifty-nine applet flags are accepted and ignored

**Status**: closed
**Filed**: 2026-08-07
**Closed**: 2026-08-07

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

## Closed: 0 ignored, over the same 375 flags and 43 applets

Answer 2 for nearly all of them. `packages/box/src/lib/flags.wac` is the refusal in one place —
`refuseFlags(core, a)` at the top of twenty-eight applets — and it rests on two tables, `implementedFlags`
(what the applet reads) and `gnuFlags` (what the real tool documents), which pick between "not
implemented" and "invalid option". `deno task flags:ignored` now prints **0 accepted and ignored** where
it printed 59.

**The tables are checked rather than trusted.** `packages/box/test/flags.test.ts` reads the installed
tools' `--help` and the applets' own source, and it earned that on the first run: three letters were
missing from `gnuFlags` — `tr -C`, `rm -R`, `split -C` — each of them the *second* spelling on a line GNU
writes as `-r, -R, --recursive`, and each would have produced "invalid option" for a real flag, which is
the one sentence this issue exists to prevent. `rm -R` turned out to be missing from the applet too, and
is an alias now rather than a refusal.

The same blind spot was in `packages/sh/test/gaps.test.ts`, whose sweep is the same idea a package over:
its regex was anchored at the start of the line, so it had never asked about `tr -C` or `rm -R` while
claiming to ask about every option GNU has. Widened, and it still passes.

**Three exceptions, each a fact about the real tool rather than about us:**

- `echo` is not in the sweep at all. It is not a getopt program — `echo -x` prints `-x` — so refusing
  there would invent an error GNU does not have, which is the same blaming-the-caller failure as calling
  `-k` invalid.
- `acceptedFlags` holds `cat -u`, which GNU documents as ignored, and `tar -c`, which names the only mode
  this tar has. `flags:ignored` reads that list and reports them apart from the silent ones.
- `cut -c` and `paste -s` answered with a `usage:` line, which says the caller was wrong. Both are in the
  table now and say which side is unfinished.

What is left is ordinary work rather than an issue: `sort -k`, `uniq -f` and `wc -m` are still not
implemented, and now say so. The three deliberate divergences — `stat`, `diff`, `du` — are written into
`packages/box/README.md` where the sweep that found them is described.
