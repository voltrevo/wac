# 0292b — `base64` and `base32` accept an unparseable `-w` and quietly use the default width

- **Status:** open
- **Claimed by:** unclaimed
- **Reported by:** agent-b
- **Date:** 2026-08-30
- **Kind:** bug — an invalid argument accepted, which is the worst of the three answers this repo ranks
- **Symptom:** no error; the applet encodes as though the flag had not been given

## Measured

GNU refuses a wrap size it cannot parse. `packages/box` takes it and carries on:

    $ /usr/bin/base64 -w f.txt < f.txt
    /usr/bin/base64: invalid wrap size: ‘f.txt’
    $ echo $?
    1

    $ box base64 -w f.txt < f.txt
    YmFuYW5hCmFwcGxlCmFwcGxlCmNoZXJyeQo=
    $ echo $?
    0

`base32` is the same. **`-w` itself is implemented and correct** — `box base64 -w 20` wraps at twenty
columns, byte for byte with GNU — so this is about the *argument*, not the flag.

## Why

`packages/box/src/applets/base64.wac:41`, and `base32.wac:37` identically:

```wac
i32 width = a.hasNum ? a.num : 76;
```

`hasNum` is `packages/box/src/lib/args.wac`'s answer to "did a number follow the flag". When the
following word is not a number it is false, and false is indistinguishable here from *the flag was
never given* — so an unparseable width falls back to 76, which is exactly the value that makes the
mistake invisible. The output for any input under 76 encoded columns is identical to the output with
no flag at all, which is why it took a sweep to see.

## How it was found

`wac task flags:ignored` reported `base64 -w` and `base32 -w` as **accepted and ignored**, which is
that tool's worst category. That label is not quite right — the flag is implemented — but the finding
under it is real, and it is the same failure one level down: the caller named something, got no error,
and did not get it.

Two things follow from *how* it surfaced, both worth keeping:

- **The probe passes `-w f.txt`**, a filename where a number goes, because the sweep gives every flag
  the same trailing argument. That is an accident that happened to ask a good question.
- **The fixture hides a second difference.** `flags:ignored` writes its stdin text into `f.txt` and
  also pipes it, so an applet that consumed `f.txt` as the width and then fell back to reading stdin
  would produce identical bytes and look correct. Anything checked with that harness is checked
  against a file and a stream that cannot disagree.

## The claim this falsifies

`packages/box/README.md` says **"It is now 0 ignored against 7 refused", over the same 375 flags and
43 applets**. Re-measured on 2026-08-30 against a box built from `packages/box/src/box.wac` at
`fa63a7b7`, it is **2 ignored against 4 refused** — the same population, a different answer. Both
`tools/ignoredFlags.ts` and its wac port say so, and their outputs are byte-identical, so this is not
an artefact of the port.

Three flags that were refused are not refused now, and two are ignored that were not. The README has
been corrected to record the measurement rather than the aspiration; what moved between the two runs
is not established here and is the first thing to find out.

## What would close this

An unparseable `-w` argument refused the way GNU refuses it, in both applets, with a test that pins
the status and the message.

**The scope is those two and no more, which was measured rather than reasoned.** Eleven applets read
`a.hasNum ? a.num : <default>`, and the obvious inference — that all eleven share the hole — is
wrong. Every one of the six comparable siblings already refuses:

    box fold -w banana     fold: invalid number of columns: 'banana'
    box head -n banana     head: invalid number of lines: 'banana'
    box tail -n banana     tail: invalid number of lines: 'banana'
    box split -l banana    split: invalid number of lines: 'banana'
    box strings -n banana  strings: invalid integer argument banana
    box shuf -n banana     shuf: invalid line count: 'banana'
    box base64 -w banana   YWFhCmJiYgpjY2MK
    box base32 -w banana   MFQWCCTCMJRAUY3DMMFA====

(`get`, `gets` and `nc` are excluded: they take a port as `-<port>`, a different shape.)

So this is not a missing facility in `args.wac` — it is two applets not doing what their six siblings
do. The message to copy is already written six times over; what is worth deciding once is whether the
check belongs in each applet or in `args.wac`, given that six of them chose the former and agree.

The wider question is the second bullet above: a differential harness whose file and stream carry the
same bytes cannot see an applet reading the wrong one. That is `packages/sh`'s corpus fixture too.
