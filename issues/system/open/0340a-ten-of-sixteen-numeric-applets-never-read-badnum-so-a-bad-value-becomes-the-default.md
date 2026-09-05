# 0340a — ten of sixteen numeric applets never read `badNum`, so a bad value becomes the default

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** bug
- **Symptom:** wrong answer — a mistake in the command line comes back as an answer, exit 0

## Reproduction

Both run against `./bootstrap.sh --no-install`'s binary on 2026-09-05, not read off the source.

```
$ printf 'aaaa…' | box base64 -w x        # 120 bytes of 'a'
YWFhYWFhYWFh…                             # wrapped at 76 — the default
$ echo $?
0
```

Expected: `base64: invalid wrap size: 'x'`, exit 1 — which is what GNU says and what the parser
already knows, having recorded `x` in `a.badNum`.
Actual: the flag is discarded, the default is used, exit 0.

The control is the same mistake in an applet that *does* read the field:

```
$ printf 'a\nb\nc\n' | box head -n x
head: invalid number of lines: 'x'
$ echo $?
1
```

Same parser, same field, one line of difference in the applet.

And the second half, same cause, different field:

```
$ box uuid -0
01338d5e-48a5-49d9-8caa-1b9afc169b92      # one UUID; nothing was asked for
```

## The count

Measured across `packages/box/src/applets/`:

| | |
|---|---|
| applets reading `a.num` | 16 |
| ...that ever mention `a.badNum` | 6 |
| the guard, spelled identically in all six | `if (a.badNum != "") { core.warn(badNumberMessage(a)); return 1; }` |

The ten without it: `serve`, `nc`, `httpd`, `base64`, `seq`, `get`, `uuid`, `gets`, `wget`,
`base32`. So `httpd -p x` and `serve -p x` listen on 8080, `get -p x` and `wget … x` use 80,
`gets -p x` uses 443, `nc -p x` listens on port 0, and `base32 -w x` wraps at 76.

`missingValue` is worse and smaller: **one** applet in the tree reads it, so `base64 -w` with
nothing after it is the same silent default.

## The second defect, in four of the same files

`Args.hasNum` exists because of this, and its doc comment says so:

> Zero used to mean both "absent" and "the user asked for zero", so `head -0` printed ten lines:
> **every applet** spelled its default as `a.num == 0 ? 10 : a.num`, and there was no way to say
> zero.

Grep says every applet is not every applet. Four still spell it the old way:

    packages/box/src/applets/httpd.wac:28   i32 port = a.num == 0 ? 8080 : a.num;
    packages/box/src/applets/serve.wac:23   i32 port = a.num == 0 ? 8080 : a.num;
    packages/box/src/applets/uuid.wac:13    i32 n    = a.num == 0 ? 1 : a.num;
    packages/box/src/applets/wget.wac:36,38 a.num == 0 ? 80 : a.num

So `httpd -p 0` and `serve -p 0` cannot ask for an ephemeral port, and `uuid -0` prints one. The
parser was fixed and the call sites were not, and all four are inside the ten above — the two
defects have the same set of victims because they have the same cause.

## Notes

**The applets are not careless and that is the point.** `parseArgs(cli)` cannot fail. It answers an
`Args` whose fields all look like answers, so nothing at the call site suggests an obligation was
left open: the applet type-checks, runs, and is wrong only for inputs nobody tries. Five of the
twelve fields — `badNum`, `missingValue`, `longOpt`, `hasNum`, `numSign` — are failures or absences
encoded as ordinary values, and three of them were *added* in response to exactly this bug, twice
with the same sentence in the comment:

> A mistake in the command came back as an answer, which is the worst of the three things it could
> have done.

The fix each time was *add a field and check it*. This issue is that the second half does not
happen, measured at 6 of 16.

**Two fixes, and they are not alternatives.**

1. *Now, mechanically:* add the six-word guard to the ten applets. Cheap, and it is the same fix
   that already failed to stick once.
2. *Actually:* make the parser answer `Result<Args, ArgFault>`. Then the ten cannot compile without
   handling it, `badNum`/`missingValue`/`longOpt` stop being fields, and `hasNum` becomes `i32?`.
   The cost is one `match` per applet in 63 applets, and `packages/box/src/lib/args.wac` is 458
   lines that shrink.

(2) is a redesign of a shared file that 63 applets import, so it is a decision rather than work,
which is why this is an issue and not a commit. `vision/packages/box/src/lib/args.wac` is that
redesign written out, with a `Spec` the applet declares — which also removes `takesValue`'s table of
applet names from inside the shared library.

**A test would catch the class.** Every applet reading `a.num` should refuse a non-numeric value,
and that is one table-driven test over the sixteen rather than sixteen tests. It is not written and
would have failed on ten rows today.
