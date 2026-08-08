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

## The browser terminal, and why it has no `/dev` either

`packages/box/example/term.wac` is `externalSpawnable`, and it was given `mountSystem` — the same
world every other session has — for one tick. Measured in a real browser:

```
ls /bin | wc -l    ->  63        # `ls` is a builtin, on the session's own filesystem
cat /dev/null      ->  fails     # `cat` is spawned, and a spawned instance has Fs.onHost
```

So the shell had a world its programs could not see. Both ways out were tried:

- **stop spawning**, so everything runs in process on the session's filesystem. It works and it is
  worse: a *called* applet's output is captured in memory and capped at 8 MiB, so
  `seq 1 1500000 | wc -c` truncates where a spawned stage streams.
  `platform/test/browser_live.test.ts` compares that number against bash's and caught it in one run. A
  missing `/dev/null` is a visible failure; a silently short byte count is the other kind.
- **keep the half world**, which leaves a system that answers differently depending on which route the
  shell took — the quiet-wrong-answer shape.

So a tab has no `/dev`, `/proc` or `/bin`, the browser test **asserts their absence**, and design/0001's
"the same system in a tab" waits on this issue. When it is decided, those assertions turn positive.


## A second thing that lands with this: `>` has two implementations

Found auditing D4 against what a session actually reaches. A redirection on the last stage of a
pipeline is written **two different ways** depending on which route the pipeline took:

- **sequentially**, `emitTo` writes through `sh.fs` — the session's filesystem;
- **streaming**, `streamPipeline` calls `sh.cli.openOutput(path)` and then relays with `sh.cli.write`
  — the *host's* filesystem.

Today that is latent rather than live: `wacsh` and the browser terminal have the same filesystem both
ways, and a sealed session never takes the streaming route because it does not spawn. It becomes a
leak the moment this issue is fixed — `seq 1 3 > out` in a sealed session would write to the machine.

The cause is a real gap rather than an oversight: **`Fs` has no streaming write.** `openOutput` exists
because a redirection must not buffer — `seq 1 2000000000 > out` used to build twenty gigabytes in the
shell and trap on one wasm array (wac-mono 0070) — and `Fs` offers only `writeFile(path, bytes)`. So
the streaming path had nowhere else to go.

The fix is an `openOut`/`writeOut`/`closeOut` on `Fs`, mount-dispatched like every other operation:
append into the inode for a memory mount, delegate to `cli.openOutput` for a host mount, refuse for a
synthesised one except `/dev/null`. Then `>` means one thing, and this issue's fix does not need to
remember it.
