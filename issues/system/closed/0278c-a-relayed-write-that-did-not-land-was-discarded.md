# 0278 — a relayed write that did not land was discarded, so a closed reader never stopped the program

- **Status:** closed — fixed 2026-08-29
- **Reported by:** agent-c
- **Date:** 2026-08-29
- **Kind:** bug
- **Symptom:** trap — no: correct output, then no exit

## Reproduction

```
$ wac app packages/box/src/box.wac -o box --allow-read --allow-write
$ ./box yes | ./box head -2
y
y
                    ...and it never returns
```

Expected: `head` takes two lines, the pipe closes, `yes` stops.
Actual: both lines arrive and the producer runs for ever.

The same program built by `packages/platform/build.ts` exits at once, which is what made this look
like a difference between artefacts rather than a defect in one of them.

## The cause

A `wac app` artefact runs its program as a **child** and relays the child's two streams —
`relay` in `packages/wac/src/runprog.wac`. It called `cli.write(bytes)` and threw the answer away.

`write` returns false when the far end has gone. That is the whole of what a broken pipe means here
and the only signal there is: there is no SIGPIPE, and `packages/box`'s `kill` says why — *"the only
thing that can end a process is the process itself"*. So a program stops by *noticing its own write
failed*, and this one relayed on regardless.

The child never found out either, because a child writes into a queue that always accepts. So the
reader was gone, the relay was writing into a closed pipe, and the producer was writing into a queue
— three layers, and the failure at the outermost reached none of the others.

## The fix

A write that does not land stops the child, with `closeSocket` — the same capability
`packages/sh/src/exec.wac` uses for a pipeline stage with nowhere left to write, and the same one
`issues/system/0275c` taught the native host to honour.

    ./box yes | ./box head -2     before: y y, then never returns
                                  after:  y y, exit 0, 0s

Ordinary relaying is unchanged: a whole file still arrives whole, stderr still interleaves, and the
child's exit code still comes back.

## Why it was not caught

Three routes reach a pipeline and this was the only broken one, so the symptom pointed everywhere
else. The shell's own pipelines have their own stopping rule and are correct; the browser and Deno
hosts relay differently; the native binary's `run` does not relay at all — it instantiates the module
in its own process, so the program writes to the real descriptor and the kernel does this for it.
`relay`'s own header says so: *"it is the one place the two implementations differ in kind rather
than in code"*.

`packages/wac/test/wac/app_test.wac` covers it now, through `/bin/sh` so that the pipe is the
operating system's — a case written with the shell's own pipelines passes while this is broken, which
is how it stayed hidden. Verified by reverting the fix: the new case fails with *the program never
stopped writing into a closed pipe*.

## Notes

Found while explaining why `packages/box/test/` failed when migrated from `build.ts` to `wac app` for
`design/system/0009`. Two of those failures were `issues/system/0277c`; this is the hang.
