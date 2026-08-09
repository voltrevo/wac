# 0116 — a spawned stage gets the host's world, not the session's

- **Status:** closed, 2026-08-09
- **Reported by:** agent-a
- **Date:** 2026-08-08
- **Kind:** missing feature
- **Symptom:** wrong answer
- **Also on GitHub:** [voltrevo/wac-mono#41](https://github.com/voltrevo/wac-mono/issues/41), "Share Wacland filesystem capabilities across spawned processes" — filed independently by the
  owner on 2026-08-06 and describing the same gap from the requirement side. Not mirrored separately: this is that issue. **Discussion belongs there**, per `issues/README.md`.

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

## Fixed, 2026-08-09 — option 4, which was not on the list

**A spawned child does not get a filesystem. It gets a channel to its parent's.**

`packages/fs/src/remote.wac` and `serve.wac`: a fourth `Backing`, whose every operation is a request
on a handle, and a server that applies one to an ordinary `Fs`. `spawnSelf` grew a third stream
(`Child.fsHandle`) and a `serveFs` flag — a promise to answer, not a grant — and `packages/sh` serves
its children with `waitAny` alongside their output, because a stage blocked on `readFile` writes
nothing and a parent that waited for output first would be waiting for a child waiting for it.

What that buys over each of the three options below: nothing is duplicated, so there is no second
filesystem to diverge, no copy to write back, and no permission check to reimplement. A child's writes
are its parent's writes. A question is answered **as the process that asked it**, which is what
`/proc/self` means — `cat /proc/self/cmdline` in a spawned `cat` prints `cat\0/proc/self/cmdline\0`,
as bash does, and printed the session's command line until the server set `procs.current`.

The two lines in the reproduction now answer `inimage` and "No such file or directory".

### What it unblocked

- **design/0001 step 3's criterion**, which this cost: `seq 1 200000 | ps` over ssh on an image lists
  the session, `seq` and `ps`. `packages/ssh/test/server.test.ts`.
- **Sealed sessions spawn.** `sealedsh`, `imaged` and `sshd -i` are all `externalSpawnable` now, so a
  pipeline streams instead of running a stage at a time. `imaged`'s "a redirection lands in the image"
  is a property of the code rather than of which grants it was built with.
- **`&` in a sealed session**, including a background job that reads the session's files — served at
  the shell's own check points, so it makes progress before anything waits for it.
- **The browser terminal is the same system in a tab.** `term.wac` mounts `/dev`, `/proc` and `/bin`;
  it deliberately mounted none of them because the shell would have had a world its programs could
  not see. `browser_live.test.ts` asks a real Chromium `ls /bin | wc -l` **through a pipe** and gets
  63.

### What checked it

The 817-script shell corpus, through memory, image and a host mount, with the memory and image ends
spawning every stage over the channel: 817 of 817 agree (`deno task corpus:backings`). That is the
differential for the eighteen `case Remote` arms, and it was the reason not to write a hand-made list
of them — `fs.wac`'s matches all end in `else`, so a forgotten arm compiles and answers out of an
empty local tree.

Two live regressions it caught, both in `ps`: a stage's parent was the shell rather than the running
frame, and `/proc/self` was the session.

### Not fixed by this

A signal to a stage of a running pipeline. The stages are real children with handles now, so one
*could* arrive; `kill` reaches the row this shell keeps, and a child has a process table of its own.

## Why this was filed rather than fixed (the state before the above)

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

Option 3 was the behaviour for a year and is *safe*; the criterion it failed is real. Choosing between
1 and 2 is a change to the capability layer, which is `packages/platform` and shared.

What the list got wrong, worth keeping: all three treat the filesystem as a **thing to be handed
over**, and argue about the form. The answer was that it does not have to move at all.

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

So a tab had no `/dev`, `/proc` or `/bin` and the browser test **asserted their absence**. Those
assertions are positive now, and asked through a pipe — which is the spawning route, and the only way
to ask the question that was broken.


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

**Done, 2026-08-08.** `Fs.openOut`/`writeOut`/`closeOut`, mount-dispatched like every other
operation: append into the inode for a memory mount, and for a host mount delegate to
`cli.openOutput`, which is what the shell was doing directly. `streamPipeline` uses them, so `>`
means one thing and this issue's fix does not have to remember it. `packages/fs/test/stream.test.ts`.

There is one thing to know when this issue *is* fixed: a spawned stage writes to its parent through a
queue, and the parent relays into the file, so the file is still the parent's filesystem's. That is
the right shape — it is the parent that knows which world the redirection belongs to.
