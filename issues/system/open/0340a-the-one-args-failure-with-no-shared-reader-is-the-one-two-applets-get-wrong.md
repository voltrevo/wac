# 0340a — the one `Args` failure with no shared reader is the one two applets get wrong

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** bug
- **Symptom:** wrong answer — a mistake in the command line comes back as an answer, exit 0

> **This issue was filed with a wrong count and corrected the same hour.** The first version said
> *ten of sixteen applets never read `a.badNum`*, which counted every applet reading `a.num` and
> ignored that `badNum` is only ever set by a **valued** flag. Eight of the ten have no valued flag,
> so their `badNum` is unreachable and not reading it is correct. The real number is **2 of 8**, and
> narrowing it made the finding better rather than smaller — see *What the correction showed*.

## Reproduction

Run against the binary from `./bootstrap.sh --no-install`, 2026-09-05.

```
$ printf 'aaaa…' | box base64 -w x        # 120 bytes of 'a'
YWFhYWFhYWFh…                             # three lines: 76, 76, 8 — the default width
$ echo $?
0
```

Expected: `base64: invalid wrap size: 'x'`, exit 1 — which is what GNU says, and the parser already
knows, having recorded `x` in `a.badNum`.
Actual: the flag is discarded, the default 76 is used, exit 0.

`base32 -w x` is the same, and they are the only two.

The control is the same mistake in an applet that reads the field:

```
$ printf 'a\nb\nc\n' | box head -n x
head: invalid number of lines: 'x'
$ echo $?
1
```

Same parser, same field, one line of difference in the applet.

## The count, corrected

`badNum` is set only where `takesValue(name, letter)` says a flag takes a value. Nine applets are in
that table and eight of them read `a.num`:

| applet | reads `a.num` | checks `a.badNum` |
|---|---|---|
| `head` `tail` `shuf` `strings` `fold` `split` | yes | **yes**, one identical copy-pasted line each |
| `base64` `base32` | yes | **no** |

    if (a.badNum != "") { core.warn(badNumberMessage(a)); return 1; }

Six copies, byte for byte, and two absences.

## What the correction showed, which the wrong count hid

`Args` has five fields that carry a failure or an absence — `badNum`, `missingValue`, `longOpt`,
`hasNum`, `numSign`. Checking who reads them:

- **`missingValue` and `longOpt` are read by `lib/flags.wac`'s `refuseFlags`**, which every applet
  calls as its first statement. `base64 -w` with nothing after it says *"option requires an
  argument"* and refuses, correctly, in an applet that never mentions the field.
- **`badNum` has no shared reader.** It is checked in each applet, by hand, six times out of eight.

So within one file set, holding the parser and the authors and the conventions constant:

> **The failures a shared function reads are always handled. The failure each applet must read for
> itself is handled 75% of the time.**

That is the finding, and it is stronger than the one the wrong count supported, because it is a
controlled comparison rather than an assertion about attention.

**And the log says why, to the hour.** All three fields were added on 2026-08-07:

    10:45  d92a7a94c  sh, box: a count that is not a count, and a sign that means something
                      -> `badNum`
    15:41  650e656f3  box: refuse the flag rather than ignoring it, in one place
                      -> `refuseFlags`
    15:59  25b8eb108  box: a long option is one thing, not a run of short ones
                      -> `longOpt`, read by `refuseFlags`
    19:32  03f1da9bc  box: an operand error says what the real tool says
                      -> `missingValue`, read by `refuseFlags`

`badNum` predates the shared reader by five hours. Both failures invented after `refuseFlags`
existed went into it; the one invented before it never moved. So nothing here is about care or
subtlety — it is about which side of 15:41 a field was born on, and 15:41's own commit message is
*"in one place"*.

A shared reader can only read the fields that exist when someone writes it, and nothing goes back
for the older ones. **A convention adopted midway looks, afterwards, exactly like a convention that
is followed** — which is the argument for the three-line fix below being worth more than two edits
to two applets: it is the thing that goes back.

The second defect is the same shape a step further on. `hasNum` exists because of this bug and its
comment says so:

> Zero used to mean both "absent" and "the user asked for zero", so `head -0` printed ten lines:
> **every applet** spelled its default as `a.num == 0 ? 10 : a.num`, and there was no way to say zero.

Four still spell it that way:

    packages/box/src/applets/httpd.wac:28   i32 port = a.num == 0 ? 8080 : a.num;
    packages/box/src/applets/serve.wac:23   i32 port = a.num == 0 ? 8080 : a.num;
    packages/box/src/applets/uuid.wac:13    i32 n    = a.num == 0 ? 1 : a.num;
    packages/box/src/applets/wget.wac:36,38 a.num == 0 ? 80 : a.num

```
$ box uuid -0
01338d5e-48a5-49d9-8caa-1b9afc169b92      # one UUID; none was asked for
```

`httpd -p 0` and `serve -p 0` cannot ask the kernel for an ephemeral port — which `nc -0 -l` can,
and documents doing, in the same tree.

## The fix

**Move the `badNum` check into `refuseFlags`.** Every applet already calls it, the per-applet wording
is already a table in the shared library (`badNumberMessage(a)` switches on `a.name`), and the six
copies then delete. That is the whole of defect one, and it makes the ninth applet impossible to get
wrong.

Not done here because it changes what `base64` and `base32` do — they start refusing where they
silently defaulted — and `test/box.test.ts` compares those two against the installed tools. Whether
that turns a row red is a question for whoever owns that comparison. The change itself is three
lines.

Defect two is four independent one-line edits and no shared change.

## Notes

**The applets are not careless, and that is why the shared reader wins.** `parseArgs(cli)` cannot
fail: it answers an `Args` whose fields all look like answers, so nothing at the call site suggests
an obligation was left open. `refuseFlags` succeeds because it is called, not because anyone
remembered what it checks.

> A function that cannot fail moves its failures into its output, and an output field is a request
> rather than a requirement — unless something shared reads it, which is what `refuseFlags` is and
> what `badNum` never got.

`vision/packages/box/src/lib/args.wac` is the other answer: `parse` returns `Result<Args, ArgFault>`,
`badNum`/`missingValue`/`longOpt` stop being fields, and `hasNum`/`num`/`numSign` become one
`Count?`. That is a redesign of a file 63 applets import, so it is a decision rather than work, which
is why it is in `vision/` and this is an issue.
