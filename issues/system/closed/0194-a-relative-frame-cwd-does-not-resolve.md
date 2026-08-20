# 0194 — a `Frame`'s `cwd` works when it is absolute and silently does not when it is relative

- **Status:** closed
- **Fixed in:** this commit
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** bug
- **Symptom:** wrong answer — a write that fails with "No such file or directory" in a directory that exists

`packages/platform/src/frame.wac`'s `Frame.cwd` is documented as "where its relative paths resolve
from". Given a *relative* directory it does not resolve: a child writing `f` is told there is no such
file, in a directory that exists and is writable.

## Reproduction

```wac
cli.mkdir(".cache/probe", true).wait();

// Relative frame cwd — fails.
Frame f = Frame.of(string[]("sh", "-c", "echo hi > f; cat f"), u8[0](), ".cache/probe", false);
// => "sh: f: No such file or directory"

// The same frame with an absolute cwd — writes the file and reads it back.
Frame g = Frame.of(string[]("sh", "-c", "echo hi > f; cat f"), u8[0](),
                   cli.cwd().wait() + "/.cache/probe", false);
// => "hi"
```

A third case passes and narrows it: with **no** frame cwd and the path spelled out
(`echo hi > .cache/probe/g`), the write succeeds. So the failure is in how a relative `cwd` is joined,
not in writing through a frame.

## Where it was found

Replaying the shell corpus in-process (`issues/system/0193`). Two scripts of 645 failed —
`[ b > a ]; echo $?` and one that runs `mkdir -p lsd; cd lsd; …` — both of them cases that *write* in
the working directory, and both passing once the case directory was made absolute. Everything else
about the frame behaved.

Worth fixing rather than documenting, because the failure is silent in the direction that matters: a
caller who passes a relative cwd gets a child that cannot write, and the child's message names the
file rather than the frame.

## Related

`issues/system/0166` — a child inside a frame loses its `openOutput` redirection — is the same layer and
may be the same cause. Whoever takes either should read both.

## Fixed — 2026-08-20, and it was not where the reproduction pointed

The reproduction says a relative frame cwd fails and an absolute one works, which reads as a bug in how
the frame *joins* paths. It is not: `joinPath` is correct and `Frame.path("f")` answers
`.cache/probe/f` for a relative cwd, which is right. A probe driving `childCli` directly — `openOutput`,
write, read back — **passes**.

The fault is one line up. `childCli`'s capability table had

```wac
() => f.cwd == "" ? parent.cwd() : ready(f.cwd),
```

so `cwd()` handed the frame's string back **verbatim**. A real `Cli.cwd()` is always absolute, and this
one was not — and the consumer that noticed is `packages/sh`, whose own `cwd` is documented *"Always
absolute and never with a trailing slash"*, is seeded from `cli.cwd()`, and resolves every path it
touches against it. Given a relative one, every resolved path came out relative to nothing in
particular, so a child writing `f` was told there was no such file in a directory that existed. That is
why the issue's failing cases were the two that *write* — `resolve` is what breaks, and reads happened to
land.

Now joined onto the parent's, which is the only thing a relative frame cwd can mean. `joinPath` returns
an absolute path unchanged, so the absolute case costs nothing, and `f.cwd == ""` still means "the
parent's" — a third answer that absolutising unconditionally would have lost.

**Why the existing tests missed it:** every one of them passes an absolute `workDir`. The fault was in
the single input none of them used, which is the whole of it.

`test_a_frames_cwd_is_absolute_however_it_was_given` covers all three inputs plus the write from the
report, and is canaried by reverting the line. Verified: `packages/platform/test/wac/` 34 of 34,
`packages/sh` 2 of 2, `packages/box` 17 of 17, and the Deno-side `platform.test.ts` and
`pipeUngranted.test.ts` green — the latter because it is the test that pins what a frame does with `""`.

`issues/system/0166` is named here as possibly the same cause. It is not this line, since a frame's
`openOutput` redirection works in the probe above; whoever takes it should not assume this fix touched
it.