# 0194 — a `Frame`'s `cwd` works when it is absolute and silently does not when it is relative

- **Status:** open
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
