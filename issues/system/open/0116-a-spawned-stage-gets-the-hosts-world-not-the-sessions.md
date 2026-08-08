# 0116 — a spawned stage gets the host's world, not the session's

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-08-08
- **Kind:** missing feature
- **Symptom:** wrong answer

## What

`packages/box/src/shrun.wac`'s `boxApplet` — the multi-call entry a spawned applet re-enters — builds
its filesystem as `Fs.onHost(cli, 0)`, and says so:

> `boxApplet` is the multi-call entry — this program run *as* an applet — so the filesystem is the
> host's, exactly as it is for `box` itself. A shell hands its own in through `boxRun` above.

That is right for `box` run as a program and right for `packages/box/src/bin/sh.wac`, whose world *is*
the host's. It is wrong for every session whose filesystem is the system's own, and the consequence is
that **such a session cannot spawn its stages at all**.

## Reproduction

Make `packages/ssh`'s server a multi-call binary (three lines: `boxApplet` first, as `sealedsh` does)
and set `sh.externalSpawnable = true` in `sessionShell`. Then, over ssh, in a session booted on an image:

```
echo inimage > /f; cat /f        ->  cat: /f: No such file or directory
cat /etc/hostname                ->  13f160bf57e5
```

Expected: the image's own `/f`, and no such file for `/etc/hostname`.
Actual: a stage read the machine the server is running on.

The pipeline works; the answers come from the wrong disk; nothing says so.

## Why this is filed rather than fixed

The fix is a decision about what `spawnSelf` means, and there are at least three answers:

1. **A child inherits its parent's world.** The parent would have to hand the image over — as bytes, or
   as a capability the child rebuilds from. `Cli` has no way to say "here is a filesystem"; a spawned
   child gets a world the *host* builds.
2. **The shell hands each stage its own `Fs` through a different route**, as `boxRun` already does for
   the in-process case. That is what `pushChild` is, and it is why the in-process route is correct
   today — so the question is whether a spawned stage can have something equivalent.
3. **Sealed sessions do not spawn**, which is what happens now. The cost is design/0001 step 3's
   criterion: `ps` in the ssh demo shows the session and itself and never the pipeline, because the
   stages ran one at a time.

Option 3 is the current behaviour and is *safe*; the criterion it fails is real. Choosing between 1 and
2 is a change to the capability layer, which is `packages/platform` and shared.

## Notes

`packages/box/test/sealing.test.ts` pins the property from the outside: a sealed or image session reads
its own filesystem through a pipe and cannot read the machine by any route, and `wacsh` — the exception
— still can. That test is what makes option 3 safe to leave in place; before it, the only thing holding
the line was a comment.

**The browser terminal is a smaller instance of the same split.** `packages/box/example/term.wac` is
`externalSpawnable` and its shell now mounts `/dev`, `/proc` and `/bin`; a spawned stage there gets
`Fs.onHost`, which in a tab is the same OPFS *files* but without those three. So `cat /proc/self/cmdline`
works called and fails spawned. Same cause, no data leak, and it wants the same decision.
