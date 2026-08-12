# 0107 — wacc emits a larger module than the reference, and it is now the default

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-12
- **Kind:** performance
- **Symptom:** no error

`a9917736` made wacc the compiler `deno task app:build` reaches for. Building the same source both
ways, the wacc artefact is bigger:

| program | `WAC_APP_FROM=reference` | default (wacc) | |
| --- | --- | --- | --- |
| `packages/box/src/box.wac` | 820 KB | **991 KB** | +21% |
| `packages/platform/example/wc.wac` | 270 KB | **288 KB** | +6.7% |

Same flags either way (`--allow-read --allow-write` for `box`), same source, measured 2026-08-12.

This is not an argument against the flip. The programs *behave* identically — `box`'s `wc` and
`sha256sum` produce byte-identical output from either build, and the hash agrees with coreutils —
which is the property that mattered and it holds. It is that the flip has a price nobody has
priced, and it is now paid by every built program rather than by anyone who opted in.

## Why it is worth a number rather than a shrug

`issues/system/0129` is about the floor every executable carries, and its finding is that the host
bundle dominates: a program that reads standard input and prints three numbers is 266 KiB before
its own code. The two issues pull in opposite directions and the arithmetic decides which matters.
For `box` the gap here is 171 KB against a 149 KB host floor, so on that program this is *larger
than the thing 0129 is about* — which is not what I expected before dividing, and is the reason
this is filed rather than noted.

The percentages also disagree with each other: 21% against 6.7%, on the bigger program. Whatever
this is, it is not a constant overhead per module, so "wacc's prelude is fatter" is a guess that
the two rows already argue against.

## What "done" would mean

1. **A cause, from one program.** Diff the two modules section by section — `box` gives the biggest
   signal. Code, types, elements, data: one of them is where the 171 KB is.
2. **A decision recorded either way.** "wacc emits N% more and that is accepted, because X" is a
   perfectly good outcome and better than the number sitting in a table unexplained.
3. **A regression guard, if the cause is fixable.** `packages/platform` already asserts an
   optimised page is at least 5% smaller than a plain one, so the shape exists.

## What this is not

Not the *demos* getting bigger. `7d25075d` made those 18–29% smaller, and that measurement stands;
it is about a different axis (an optimised page against a plain one) and both can be true.
